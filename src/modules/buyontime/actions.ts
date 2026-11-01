"use server";

import { z } from "zod";
import { buyontimeDraftProduct } from "@/lib/integrations/buyontime";
import { parseForm } from "@/lib/validation/forms";
import { runAction, UserFacingError } from "@/lib/utilities/action";
import { requireContext } from "@/modules/auth/session";
import { logEvent } from "@/modules/audit/service";
import { generateProductIdeas, storeSummary, syncOrderTasks } from "./service";

const PATH = "/buyontime";
const rupees = (label: string, min = 0) => z.coerce.number({ message: `${label} must be a number` }).min(min, `${label} is too low`).max(1_000_000);
const blank = (v: unknown) => (v === "" || v == null ? undefined : v);

const productSchema = z.object({
  name: z.string().trim().min(3, "Product name is required").max(160),
  description: z.string().trim().min(10, "Write at least a short description (10+ characters)").max(10000),
  supplierLink: z.url("Paste the Meesho product link").max(300),
  cost: rupees("Meesho price", 1),
  shipping: z.preprocess(blank, rupees("Shipping").optional()),
  other: z.preprocess(blank, rupees("Other cost").optional()),
  gstRate: z.preprocess(blank, z.coerce.number().int().min(0).max(28).optional()),
  mrp: z.preprocess(blank, rupees("MRP").optional()),
  targetProfit: z.preprocess(blank, rupees("Target profit").optional()),
  variants: z.string().trim().max(400).optional(),
  imageUrls: z.string().trim().max(4000).optional(),
  category: z.string().trim().max(70).optional(),
  intent: z.enum(["price", "create"]).default("price"),
});

const paise = (r?: number) => (r === undefined ? undefined : Math.round(r * 100));
const inr = (p: number) => `₹${(p / 100).toLocaleString("en-IN")}`;

/** "Calculate price" (dry run) or "Create draft in Buyontime" — drafts only; publishing stays in Buyontime admin. */
export async function productAction(form: FormData) {
  await runAction(PATH, "Done", async () => {
    const ctx = await requireContext("govern");
    const p = parseForm(productSchema, form);
    const variants = p.variants?.split(",").map((v) => v.trim()).filter(Boolean);
    const imageUrls = p.imageUrls?.split(/\s+/).map((u) => u.trim()).filter((u) => /^https:\/\//.test(u)).slice(0, 12);
    let r;
    try {
      r = await buyontimeDraftProduct({
        name: p.name, description: p.description, supplierLink: p.supplierLink, costPrice: paise(p.cost)!,
        shippingCost: paise(p.shipping), otherCost: paise(p.other), gstRate: p.gstRate, mrp: paise(p.mrp), targetProfit: paise(p.targetProfit),
        category: p.category || undefined, variants: variants?.length ? variants : undefined, imageUrls, dryRun: p.intent === "price",
      });
    } catch (err) {
      throw new UserFacingError((err as Error).message);
    }
    const priceLine = `Sell at ${inr(r.pricePaise)} (MRP ${inr(r.mrpPaise)}) → profit ${inr(r.unitProfitPaise)} per unit, worst case`;
    if (r.status === "priced") return `${priceLine}. Press "Create draft" to add it.`;
    if (r.status === "skipped") throw new UserFacingError(r.message ?? "Already in the store");
    await logEvent(ctx, { action: "buyontime.draft_created", entity: "buyontime_products", entityId: r.productId ?? null, metadata: { name: p.name, sku: r.sku, price: r.pricePaise } });
    return `Draft created (${r.sku}). ${priceLine}. Review photos and publish it in Buyontime admin.${r.message ? ` ${r.message}.` : ""}`;
  });
}

export async function ideasAction() {
  await runAction(PATH, "Ideas ready", async () => {
    const ctx = await requireContext("operate");
    const n = await generateProductIdeas(ctx);
    return `Mercury added ${n} trending product ideas`;
  });
}

export async function syncOrdersAction() {
  await runAction(PATH, "Orders synced", async () => {
    const ctx = await requireContext("operate");
    const s = await storeSummary(24);
    if (!s.data) throw new UserFacingError(s.error ?? "Buyontime unavailable");
    const r = await syncOrderTasks(ctx, s.data);
    return `${r.created} new order task(s) on your desk${r.closed ? `, ${r.closed} closed` : ""}`;
  });
}
