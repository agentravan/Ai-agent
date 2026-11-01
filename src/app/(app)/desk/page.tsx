import Link from "next/link";
import { CheckCircle2, Circle, Lock, LockOpen, MessageCircle, Phone, ShoppingCart, Users, Wrench, CalendarClock, type LucideIcon } from "lucide-react";
import { Badge, Card, Empty, Field, Flash, PageHeader, Select, Stat, type SearchParams } from "@/components/ui";
import { SubmitButton } from "@/components/ui/submit-button";
import { can } from "@/lib/permissions";
import { formatDateTime, formatInr } from "@/lib/utilities/format";
import { requireContext } from "@/modules/auth/session";
import { growthStage, MILESTONES, upgradeUnlocked } from "@/modules/cockpit/metrics";
import { addFounderTaskAction, setFounderTaskStatusAction, updateGoalsAction } from "@/modules/desk/actions";
import { companySnapshot } from "@/modules/orchestration/engine";
import { whatsappLink } from "@/modules/sales/logic";
import { FOUNDER_TASK_TYPES, PRIORITIES, type Task } from "@/types/domain";

export const metadata = { title: "My Desk" };

const TYPE_ICON: Record<string, LucideIcon> = { call: Phone, meeting: CalendarClock, order: ShoppingCart, physical: Wrench, other: Circle };
const RANK = { critical: 0, high: 1, medium: 2, low: 3 } as const;
type Contact = { id: string; name: string; category: string; city: string | null; country: string | null; phone: string | null; email: string | null; status: string; outcome_note: string | null; ai_reason: string | null; updated_at: string };
type DeskTask = Task & { leads: { name: string; phone: string | null; email: string | null; country: string | null } | null; updated_at: string };

export default async function DeskPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireContext();
  const org = ctx.organisation.id;
  const [params, company, { data: mine }, counts, { data: contacts }] = await Promise.all([
    searchParams,
    companySnapshot(ctx),
    ctx.db.from("tasks").select("*, leads(name, phone, email, country)").eq("organisation_id", org).eq("owner", "founder").order("created_at", { ascending: false }).limit(200).returns<DeskTask[]>(),
    Promise.all([
      ctx.db.from("financial_records").select("amount_cents").eq("organisation_id", org).eq("kind", "income").returns<{ amount_cents: number }[]>(),
      ctx.db.from("clients").select("id", { count: "exact", head: true }).eq("organisation_id", org).eq("status", "active"),
      ctx.db.from("leads").select("id", { count: "exact", head: true }).eq("organisation_id", org).not("status", "in", "(disqualified,lost)"),
      ctx.db.from("tasks").select("id", { count: "exact", head: true }).eq("organisation_id", org).eq("owner", "agent").eq("status", "done"),
      ctx.db.from("projects").select("id", { count: "exact", head: true }).eq("organisation_id", org).eq("status", "active"),
    ]),
    // People who need a human: replied or won (call/meet), and approved leads reachable only by phone.
    ctx.db.from("leads").select("id, name, category, city, country, phone, email, status, outcome_note, ai_reason, updated_at").eq("organisation_id", org)
      .or("status.in.(replied,won),and(status.eq.approved,email.is.null,phone.not.is.null)").order("updated_at", { ascending: false }).limit(30)
      .returns<Contact[]>(),
  ]);
  const people = contacts ?? [];
  const [income, clients, leads, aiDone, activeProjects] = counts;
  const revenue = (income.data ?? []).reduce((s, r) => s + Number(r.amount_cents), 0);
  const stage = growthStage(company.netProfitCents, company.northStarCents);
  const unlocked = upgradeUnlocked(company.netProfitCents, company.gateCents);
  const all = mine ?? [];
  const open = all.filter((t) => ["todo", "in_progress", "blocked"].includes(t.status))
    .sort((a, b) => (a.status === "in_progress" ? -1 : 0) - (b.status === "in_progress" ? -1 : 0) || RANK[a.priority] - RANK[b.priority] || (a.due_date ?? "9").localeCompare(b.due_date ?? "9"));
  const done = all.filter((t) => t.status === "done").slice(0, 8);
  const today = new Date().toISOString().slice(0, 10);
  const isFounder = can(ctx.profile.role, "own");

  return (
    <>
      <PageHeader eyebrow="Founder" title="My Desk" subtitle="The things only you can do — calls, meetings, placing orders, physical work — plus where the empire stands today." />
      <Flash params={params} />

      {/* Empire progress */}
      <section className="relative mb-6 overflow-hidden rounded-2xl border border-line bg-gradient-to-b from-panel-2/80 to-panel/80 p-5 sm:p-6">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-gold/50 to-transparent" aria-hidden />
        <div className="flex flex-col gap-6 lg:flex-row">
          <div className="flex-1">
            <p className="text-[11px] font-semibold tracking-[0.18em] text-gold uppercase">Road to ₹1,00,000 crore</p>
            <div className="num mt-3 text-3xl font-semibold text-zinc-50">{formatInr(company.netProfitCents)}</div>
            <p className="text-sm text-zinc-400">net profit earned so far</p>
            {stage.next && (
              <div className="mt-5">
                <div className="flex justify-between text-xs text-zinc-400"><span>Next milestone: <span className="text-zinc-100">{stage.next.label}</span></span><span className="num">{stage.pctToNext}%</span></div>
                <div className="mt-1.5 h-2 rounded-full bg-line"><div className="h-2 rounded-full bg-gradient-to-r from-[#b8904a] to-gold" style={{ width: `${Math.max(stage.pctToNext, 1)}%` }} /></div>
                <p className="mt-1.5 text-xs text-zinc-500">{formatInr(Math.max(0, stage.next.cents - Math.max(0, company.netProfitCents)))} to go</p>
              </div>
            )}
            <div className={`mt-5 flex items-start gap-2.5 rounded-lg border p-3 text-sm ${unlocked ? "border-emerald-500/30 bg-emerald-500/[0.06] text-emerald-200" : "border-line bg-panel-2/50 text-zinc-300"}`}>
              {unlocked ? <LockOpen className="mt-0.5 h-4 w-4 shrink-0" /> : <Lock className="mt-0.5 h-4 w-4 shrink-0 text-gold" />}
              <span>{unlocked ? `System upgrades unlocked — Ledger (CFO) may now request funding for upgrades, with expected return, through Approvals.` : `System upgrades locked: everything runs on free tools until net profit reaches ${formatInr(company.gateCents)}. Funding requests are blocked automatically until then.`}</span>
            </div>
          </div>
          <ol className="w-full space-y-1.5 lg:w-80">
            {MILESTONES.filter((m) => m.cents <= company.northStarCents).map((m, i) => {
              const reached = i <= stage.reached;
              const current = i === stage.reached + 1;
              return (
                <li key={m.label} className={`flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm ${current ? "bg-gold/10 text-zinc-50" : reached ? "text-emerald-300" : "text-zinc-500"}`}>
                  {reached ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <Circle className={`h-4 w-4 shrink-0 ${current ? "text-gold" : ""}`} />}{m.label}
                </li>
              );
            })}
          </ol>
        </div>
      </section>

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="Revenue (all time)" value={formatInr(revenue)} />
        <Stat label="Net profit" value={formatInr(company.netProfitCents)} tone={company.netProfitCents < 0 ? "bad" : undefined} />
        <Stat icon={Users} label="Active clients" value={clients.count ?? 0} />
        <Stat label="Leads in pipeline" value={leads.count ?? 0} />
        <Stat label="Active projects" value={activeProjects.count ?? 0} />
        <Stat label="Tasks done by AI team" value={aiDone.count ?? 0} />
      </div>

      <Card title={`People to call (${people.length})`} description="Clients who replied or were won, and approved leads reachable only by phone. Tap the number to call." className="mb-6">
        {people.length ? (
          <ul className="divide-y divide-line">
            {people.map((c) => {
              const wa = whatsappLink(c.phone, c.country, `Hi ${c.name}, this is Teamwork HR Solutions — thanks for your time.`);
              return (
                <li key={c.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2"><span className="font-medium text-zinc-100">{c.name}</span><Badge>{c.status}</Badge><span className="text-xs text-zinc-500">{[c.category, c.city].filter(Boolean).join(" · ")}</span></div>
                    {c.outcome_note && <p className="mt-0.5 line-clamp-2 text-xs text-zinc-400">{c.outcome_note}</p>}
                    {!c.outcome_note && c.ai_reason && <p className="mt-0.5 line-clamp-2 text-xs text-zinc-500">Why: {c.ai_reason}</p>}
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-2 text-sm">
                    {c.phone ? <a href={`tel:${c.phone}`} className="btn-gold"><Phone className="h-4 w-4" />{c.phone}</a> : <span className="text-xs text-zinc-500">No phone listed</span>}
                    {wa && <a href={wa} target="_blank" rel="noreferrer" className="btn-ghost"><MessageCircle className="h-4 w-4" />WhatsApp</a>}
                    {c.email && <a href={`mailto:${c.email}`} className="btn-ghost">{c.email}</a>}
                  </div>
                </li>
              );
            })}
          </ul>
        ) : <Empty icon={Phone}>No one to call yet. Approve pitches in the Sales Engine — when someone replies, they appear here with their number.</Empty>}
      </Card>

      <div className="grid gap-6 xl:grid-cols-3">
        <Card title={`My tasks (${open.length})`} description="Calls, meetings, orders and physical work — created by Atlas, by the Sales Engine when a client replies, or by you" className="xl:col-span-2">
          {open.length ? (
            <ul className="divide-y divide-line">
              {open.map((t) => {
                const Icon = TYPE_ICON[t.task_type ?? "other"] ?? Circle;
                const wa = t.leads ? whatsappLink(t.leads.phone, t.leads.country, `Hi ${t.leads.name}, thanks for your reply — this is Teamwork HR Solutions.`) : null;
                const overdue = t.due_date && t.due_date < today;
                return (
                  <li key={t.id} className="flex flex-col gap-3 py-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="flex min-w-0 gap-3">
                      <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-md border border-line bg-ink"><Icon className="h-4 w-4 text-gold" /></span>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2"><span className="font-medium text-zinc-100">{t.title}</span><Badge>{t.priority}</Badge>{t.status === "in_progress" && <Badge>in_progress</Badge>}</div>
                        {t.description && <p className="mt-0.5 line-clamp-3 text-xs whitespace-pre-wrap text-zinc-400">{t.description}</p>}
                        {!t.lead_id && (t.task_type === "call" || t.task_type === "meeting") && (
                          <div className="mt-2 rounded-md border border-line bg-panel-2/40 p-2 text-xs">
                            {people.length ? (<><p className="mb-1 text-zinc-500">Who to call:</p>{people.slice(0, 5).map((c) => <div key={c.id} className="flex flex-wrap gap-x-2"><span className="text-zinc-200">{c.name}</span>{c.phone ? <a href={`tel:${c.phone}`} className="font-medium text-gold underline underline-offset-2">{c.phone}</a> : <span className="text-zinc-500">no phone</span>}</div>)}</>)
                              : <p className="text-zinc-500">Nobody to call yet. When a lead replies, their name and number appear here automatically.</p>}
                          </div>
                        )}
                        {/lead/i.test(t.title) && !/call|meet/i.test(t.title) && <Link href="/sales" className="mt-1.5 inline-block text-xs text-gold underline underline-offset-2">Open Sales Engine → approve leads</Link>}
                        <div className="mt-1.5 flex flex-wrap gap-2 text-xs">
                          {t.due_date && <span className={overdue ? "text-rose-300" : "text-zinc-500"}>Due {t.due_date}</span>}
                          {t.leads?.phone && <a href={`tel:${t.leads.phone}`} className="inline-flex items-center gap-1 font-medium text-zinc-100 underline decoration-zinc-600 underline-offset-2"><Phone className="h-3 w-3" />{t.leads.phone}</a>}
                          {wa && <a href={wa} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-zinc-300 underline decoration-zinc-600 underline-offset-2"><MessageCircle className="h-3 w-3" />WhatsApp</a>}
                          {t.leads?.email && <a href={`mailto:${t.leads.email}`} className="text-zinc-300 underline decoration-zinc-600 underline-offset-2">Email</a>}
                        </div>
                      </div>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      {t.status !== "in_progress" && <form action={setFounderTaskStatusAction}><input type="hidden" name="id" value={t.id} /><input type="hidden" name="status" value="in_progress" /><button className="btn-ghost">Start</button></form>}
                      <form action={setFounderTaskStatusAction}><input type="hidden" name="id" value={t.id} /><input type="hidden" name="status" value="done" /><SubmitButton pendingText="…">Done</SubmitButton></form>
                      <form action={setFounderTaskStatusAction}><input type="hidden" name="id" value={t.id} /><input type="hidden" name="status" value="cancelled" /><button className="btn-ghost text-zinc-400" title="Not needed">Skip</button></form>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : <Empty icon={CheckCircle2}>Nothing on your desk. When a client replies, Iris puts a call task here automatically.</Empty>}
        </Card>

        <div className="space-y-6">
          <Card title="Add a task for myself">
            <form action={addFounderTaskAction} className="grid gap-3">
              <Field label="What"><input name="title" required maxLength={200} className="input" placeholder="Call Glow Salon owner" /></Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Type"><Select name="task_type" options={FOUNDER_TASK_TYPES} defaultValue="call" /></Field>
                <Field label="Priority"><Select name="priority" options={PRIORITIES} defaultValue="medium" /></Field>
              </div>
              <Field label="Due"><input name="due_date" type="date" className="input" /></Field>
              <Field label="Notes"><textarea name="description" rows={2} maxLength={2000} className="input" /></Field>
              <div><SubmitButton>Add</SubmitButton></div>
            </form>
          </Card>
          <Card title="Recently completed">
            {done.length ? <ul className="space-y-1.5 text-sm">{done.map((t) => <li key={t.id} className="flex justify-between gap-2"><span className="truncate text-zinc-300">✓ {t.title}</span><span className="shrink-0 text-xs text-zinc-500">{formatDateTime(t.updated_at)}</span></li>)}</ul> : <p className="text-sm text-muted">Nothing yet.</p>}
          </Card>
          {isFounder && (
            <Card title="Company goals" description="Every AI employee plans against these">
              <form action={updateGoalsAction} className="grid gap-3">
                <Field label="North Star (₹ crore)"><input name="north_star_crore" type="number" min="1" step="any" defaultValue={company.northStarCents / 1e9} className="input" /></Field>
                <Field label="Profit before paid upgrades (₹)"><input name="gate_inr" type="number" min="0" step="1" defaultValue={company.gateCents / 100} className="input" /></Field>
                <div><SubmitButton variant="ghost">Save goals</SubmitButton></div>
              </form>
            </Card>
          )}
        </div>
      </div>
      <p className="mt-6 text-xs text-zinc-500">Tip: tell Atlas “mujhe kal 3 salon owners ko call karna hai” — he can put tasks on your desk too. <Link href="/ceo" className="underline">CEO Office →</Link></p>
    </>
  );
}
