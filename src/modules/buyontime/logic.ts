import { z } from "zod";
import { AiError } from "@/lib/ai/types";
import type { BuyontimeOrderToFulfil } from "@/lib/integrations/buyontime";

/** Pure Buyontime helpers (tested). */

export const orderRef = (orderNumber: string) => `buyontime:${orderNumber}`;

/** Founder desk task for an order that must be placed with the supplier (Meesho). */
export function orderTask(o: BuyontimeOrderToFulfil): { title: string; description: string; external_ref: string; priority: "high" | "critical" } {
  const ageHours = (Date.now() - new Date(o.placedAt).getTime()) / 3_600_000;
  const lines = o.items.map((i) => `• ${i.quantity} × ${i.name}${i.variant ? ` (${i.variant})` : ""}${i.supplierLink ? ` — ${i.supplier ?? "supplier"}: ${i.supplierLink}` : " — supplier link missing"}`);
  return {
    title: `Place Meesho order for Buyontime #${o.orderNumber}`.slice(0, 200),
    description: [`Ship to: ${o.shipTo}`, `Payment: ${o.paymentMethod} · Total ₹${(o.totalPaise / 100).toFixed(0)}`, ...lines, "Then mark the order Processing/Shipped in Buyontime admin."].join("\n").slice(0, 2000),
    external_ref: orderRef(o.orderNumber),
    priority: ageHours > 24 ? "critical" : "high",
  };
}

export const meeshoSearch = (q: string) => `https://www.meesho.com/search?q=${encodeURIComponent(q)}`;

const idea = z.object({
  product: z.string().trim().min(3).max(120),
  why: z.string().trim().min(5).max(400),
  meesho_query: z.string().trim().min(2).max(80),
  category: z.string().trim().max(60).optional().default(""),
});
export type ProductIdea = z.infer<typeof idea>;

export const IDEAS_FORMAT = `Respond with ONLY JSON: {"ideas":[{"product":"specific product to sell","why":"1 sentence linking it to a trend or season (no invented numbers)","meesho_query":"search words to find it on Meesho","category":"fashion|home|beauty|kids|electronics|other"}]} — 5 to 8 ideas.`;

export function parseIdeas(text: string): ProductIdea[] {
  const unfenced = text.replace(/```(?:json)?/gi, "");
  const start = unfenced.indexOf("{");
  const end = unfenced.lastIndexOf("}");
  if (start < 0 || end <= start) throw new AiError("AI response contained no JSON ideas", true);
  let raw: unknown;
  try { raw = JSON.parse(unfenced.slice(start, end + 1)); } catch { throw new AiError("AI response contained malformed JSON", true); }
  const parsed = z.object({ ideas: z.array(idea).min(1).max(10) }).safeParse(raw);
  if (!parsed.success) throw new AiError(`Ideas failed validation: ${parsed.error.issues[0]?.message ?? "invalid"}`, true);
  return parsed.data.ideas;
}
