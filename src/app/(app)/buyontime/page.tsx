import Link from "next/link";
import { ExternalLink, Lightbulb, PackageCheck, ShoppingBag, TrendingUp, Users } from "lucide-react";
import { Badge, Card, Empty, Field, Flash, PageHeader, Stat, type SearchParams } from "@/components/ui";
import { SubmitButton } from "@/components/ui/submit-button";
import { aiStatus } from "@/lib/ai/registry";
import { can } from "@/lib/permissions";
import { formatDateTime, formatInr } from "@/lib/utilities/format";
import { requireContext } from "@/modules/auth/session";
import { ideasAction, productAction, syncOrdersAction } from "@/modules/buyontime/actions";
import { storeSummary, syncOrderTasks } from "@/modules/buyontime/service";
import type { Opportunity } from "@/types/domain";

export const metadata = { title: "Buyontime" };
export const maxDuration = 300;

export default async function BuyontimePage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireContext();
  const [params, ai, store, { data: ideas }] = await Promise.all([
    searchParams,
    aiStatus(),
    storeSummary(24),
    ctx.db.from("opportunities").select("*").eq("organisation_id", ctx.organisation.id).like("title", "Buyontime: %").in("status", ["proposed", "evaluating"]).order("created_at", { ascending: false }).limit(12).returns<Opportunity[]>(),
  ]);
  const s = store.data;
  // Keep the founder desk in step with the store whenever this page is opened.
  if (s && can(ctx.profile.role, "operate")) await syncOrderTasks(ctx, s).catch(() => undefined);
  const canGovern = can(ctx.profile.role, "govern");

  return (
    <>
      <PageHeader eyebrow="Cabin C · E-Commerce" title="Buyontime"
        subtitle="Live store numbers, orders to place on Meesho, trend-based product ideas and ₹120-profit pricing. New products are created as drafts — you publish them." />
      <Flash params={params} />

      {!s ? (
        <Card><p className="text-sm text-amber-200">Store link: {store.error}.</p><p className="mt-1 text-xs text-muted">The Buyontime update with the AI Empire link must be published first (waiting for your approval).</p></Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
            <Stat icon={ShoppingBag} label="Orders (24h)" value={s.orders} hint={`${s.onlineOrders} online · ${s.codOrders} COD`} />
            <Stat label="Revenue (24h)" value={formatInr(s.revenuePaise)} />
            <Stat label="Est. profit (24h)" value={formatInr(s.estimatedProfitPaise)} tone={s.estimatedProfitPaise < 0 ? "bad" : undefined} />
            <Stat icon={Users} label="New customers" value={s.newCustomers} hint={`${s.repeatCustomers} repeat buyers`} />
            <Stat label="Voucher conversion" value={`${s.voucherConversionPct}%`} hint={`${s.voucherOrders} orders used a code`} />
            <Stat icon={PackageCheck} label="To place on Meesho" value={s.toFulfil.length} tone={s.toFulfil.length ? "bad" : "good"} />
          </div>

          <Card title={`Orders to place on Meesho (${s.toFulfil.length})`} description="Each one is also on My Desk. Tasks close automatically once the order moves to shipped." className="mt-6"
            action={<form action={syncOrdersAction}><SubmitButton variant="ghost" pendingText="Syncing…">Sync now</SubmitButton></form>}>
            {s.toFulfil.length ? (
              <ul className="divide-y divide-line">
                {s.toFulfil.map((o) => (
                  <li key={o.orderNumber} className="py-3 text-sm">
                    <div className="flex flex-wrap items-center gap-2"><span className="font-medium text-zinc-100">#{o.orderNumber}</span><Badge>{o.status.toLowerCase()}</Badge><span className="text-xs text-zinc-500">{formatDateTime(o.placedAt)} · {o.paymentMethod} · {formatInr(o.totalPaise)} · {o.shipTo}</span></div>
                    <ul className="mt-1.5 space-y-1">
                      {o.items.map((i, n) => (
                        <li key={n} className="flex flex-wrap items-center gap-2 text-xs text-zinc-300">
                          {i.quantity} × {i.name}{i.variant ? ` (${i.variant})` : ""}
                          {i.supplierLink ? <a href={i.supplierLink} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-gold underline underline-offset-2">Open on {i.supplier ?? "supplier"}<ExternalLink className="h-3 w-3" /></a> : <span className="text-amber-300">no supplier link</span>}
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            ) : <Empty icon={PackageCheck}>No orders waiting. 🎉</Empty>}
          </Card>
        </>
      )}

      <div className="mt-6 grid gap-6 xl:grid-cols-5">
        <Card title="Trending product ideas" description="Mercury reads today's Google Trends (India) and suggests products you can source on Meesho" className="xl:col-span-2"
          action={ai.available && <form action={ideasAction}><SubmitButton variant="ghost" pendingText="Mercury is researching…"><TrendingUp className="h-4 w-4" />Find ideas</SubmitButton></form>}>
          {ideas?.length ? (
            <ul className="space-y-3">
              {ideas.map((i) => {
                const [why, ...rest] = (i.summary ?? "").split("\n");
                const link = rest.find((l) => l.startsWith("Find on Meesho: "))?.replace("Find on Meesho: ", "");
                return (
                  <li key={i.id} className="rounded-lg border border-line bg-panel-2/40 p-3 text-sm">
                    <div className="flex items-start justify-between gap-2"><span className="font-medium text-zinc-100">{i.title.replace("Buyontime: ", "")}</span><Lightbulb className="h-4 w-4 shrink-0 text-gold" /></div>
                    <p className="mt-1 text-xs text-zinc-400">{why}</p>
                    {link && <a href={link} target="_blank" rel="noreferrer" className="mt-1.5 inline-flex items-center gap-1 text-xs text-gold underline underline-offset-2">Search on Meesho <ExternalLink className="h-3 w-3" /></a>}
                  </li>
                );
              })}
            </ul>
          ) : <Empty icon={Lightbulb}>No ideas yet — press “Find ideas”.</Empty>}
          <p className="mt-3 text-xs text-zinc-500">Google Trends shows what India is searching today — a signal, not exact sales numbers.</p>
        </Card>

        <Card title="Add a Meesho product" description="Calculate first: the price is set so you earn at least ₹120 per unit after GST, Razorpay/COD charges and packaging" className="xl:col-span-3">
          {canGovern ? (
            <form action={productAction} className="grid gap-3 sm:grid-cols-6">
              <Field label="Meesho product link" className="sm:col-span-6"><input name="supplierLink" type="url" required className="input" placeholder="https://www.meesho.com/..." /></Field>
              <Field label="Product name (for Buyontime)" className="sm:col-span-4"><input name="name" required maxLength={160} className="input" /></Field>
              <Field label="Category slug" className="sm:col-span-2" hint="optional"><input name="category" maxLength={70} className="input" placeholder="women" /></Field>
              <Field label="Description" className="sm:col-span-6"><textarea name="description" required minLength={10} rows={3} maxLength={10000} className="input" placeholder="Paste Meesho's details (fabric, size, etc.)" /></Field>
              <Field label="Meesho price (₹)" className="sm:col-span-2"><input name="cost" type="number" min="1" step="0.01" required className="input" /></Field>
              <Field label="Meesho MRP (₹)" className="sm:col-span-2" hint="optional — never invented"><input name="mrp" type="number" min="1" step="0.01" className="input" /></Field>
              <Field label="Min profit (₹)" className="sm:col-span-2"><input name="targetProfit" type="number" min="0" step="1" defaultValue={120} className="input" /></Field>
              <Field label="Extra shipping (₹)" className="sm:col-span-2" hint="0 if Meesho delivers free"><input name="shipping" type="number" min="0" step="0.01" defaultValue={0} className="input" /></Field>
              <Field label="GST rate (%)" className="sm:col-span-2"><input name="gstRate" type="number" min="0" max="28" step="1" defaultValue={5} className="input" /></Field>
              <Field label="Sizes / variants" className="sm:col-span-2" hint="comma separated"><input name="variants" maxLength={400} className="input" placeholder="S, M, L, XL" /></Field>
              <Field label="Meesho image links" className="sm:col-span-6" hint="optional, one per line (images.meesho.com)"><textarea name="imageUrls" rows={2} maxLength={4000} className="input" /></Field>
              <div className="flex flex-wrap gap-2 sm:col-span-6">
                <SubmitButton name="intent" value="price" variant="ghost" pendingText="Calculating…">Calculate price</SubmitButton>
                <SubmitButton name="intent" value="create" pendingText="Creating draft…">Create draft in Buyontime</SubmitButton>
              </div>
            </form>
          ) : <p className="text-sm text-muted">Only the Founder or an admin can add products.</p>}
        </Card>
      </div>
      <p className="mt-6 text-xs text-zinc-500">Store: <Link href="https://buyontime-psi.vercel.app" className="underline" target="_blank">buyontime-psi.vercel.app</Link> · Publish drafts in Buyontime admin → Products.</p>
    </>
  );
}
