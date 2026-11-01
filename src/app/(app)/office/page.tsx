import Link from "next/link";
import type { ReactNode } from "react";
import { Briefcase, Crown, HeartHandshake, Landmark, Megaphone, ShoppingBag, Code2, type LucideIcon } from "lucide-react";
import { Badge, PageHeader } from "@/components/ui";
import { formatInr, truncate } from "@/lib/utilities/format";
import { requireContext } from "@/modules/auth/session";
import { loadCockpit, type UnitOverview } from "@/modules/cockpit/service";
import type { DeskEntry } from "@/modules/cockpit/metrics";
import type { AgentWithPermissions } from "@/types/domain";

export const metadata = { title: "Virtual Office" };

function WallMetric({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] font-medium tracking-wide text-zinc-500 uppercase">{label}</div>
      <div className="num mt-1 truncate text-2xl font-semibold text-zinc-50">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-zinc-500">{sub}</div>}
    </div>
  );
}

function Cabin({ code, title, icon: Icon, manager, entry, href, children }: {
  code: string; title: string; icon: LucideIcon; manager?: AgentWithPermissions | null; entry?: DeskEntry; href?: string; children?: ReactNode;
}) {
  return (
    <section className="relative flex flex-col overflow-hidden rounded-xl border border-line bg-panel/80">
      <div className="flex items-center justify-between gap-2 border-b border-line bg-panel-2/40 px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md border border-line bg-ink"><Icon className="h-3.5 w-3.5 text-gold" /></span>
          <div className="min-w-0">
            <div className="text-[10.5px] font-medium tracking-[0.14em] text-zinc-500 uppercase">{code}</div>
            <h2 className="truncate text-[13px] font-semibold text-zinc-100">{title}</h2>
          </div>
        </div>
        {href && <Link href={href} className="shrink-0 text-xs font-medium text-zinc-400 hover:text-zinc-100">Enter →</Link>}
      </div>
      <div className="flex-1 space-y-3 p-4 text-sm">
        {manager !== undefined && (
          <div className="flex items-center gap-2.5">
            <span className={`h-2 w-2 shrink-0 rounded-full ${entry?.current ? "bg-emerald-400 shadow-[0_0_0_3px_rgb(52_211_153/0.15)]" : "bg-zinc-600"}`} aria-hidden />
            <div className="min-w-0 text-xs">
              <div className="text-zinc-200">{manager ? `${manager.name} · ${manager.designation}` : "No manager assigned"}</div>
              <div className="truncate text-zinc-500">{entry?.current ? `Working on: ${truncate(entry.current.title, 60)}` : "At desk · no open tasks"}</div>
            </div>
          </div>
        )}
        {entry && (
          <div>
            <div className="flex justify-between text-xs text-zinc-500"><span>{entry.open} open · {entry.blocked} blocked</span><span className="num">{entry.progressPct}%</span></div>
            <div className="mt-1 h-1 rounded-full bg-line"><div className="h-1 rounded-full bg-gold" style={{ width: `${entry.progressPct}%` }} /></div>
          </div>
        )}
        {children}
      </div>
    </section>
  );
}

const Row = ({ k, v, tone }: { k: string; v: ReactNode; tone?: string }) => (
  <div className="flex justify-between gap-2 text-xs"><span className="text-zinc-500">{k}</span><span className={`num text-right ${tone ?? "text-zinc-200"}`}>{v}</span></div>
);

export default async function OfficePage() {
  const ctx = await requireContext();
  const c = await loadCockpit(ctx);
  const deskOf = (id?: string) => c.desk.find((d) => d.agent.id === id)?.entry;
  const agent = (pred: (a: AgentWithPermissions) => boolean) => c.agents.find(pred) ?? null;
  const unit = (prefix: string): UnitOverview | undefined => c.units.find((u) => u.unit.name.startsWith(prefix));
  const ceo = agent((a) => a.tier === "ceo");
  const coo = agent((a) => a.tier === "coo");
  const cfo = agent((a) => a.designation.toLowerCase().includes("finance"));
  const w = c.wall;
  const f = c.finance;
  const web = unit("Web"), hr = unit("HR"), ecom = unit("Buyontime"), sales = unit("Sales");

  return (
    <>
      <PageHeader eyebrow="AI Empire HQ" title="Virtual Office" subtitle="Every cabin, live. Figures come from your records — nothing is simulated." />

      {/* Main wall display */}
      <section className="relative mb-6 overflow-hidden rounded-2xl border border-line bg-gradient-to-b from-panel-2/80 to-panel/80 p-5 sm:p-6">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-gold/50 to-transparent" aria-hidden />
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-[11px] font-semibold tracking-[0.18em] text-gold uppercase">Main wall · central metrics</h2>
          <span className="flex items-center gap-1.5 text-[11px] text-zinc-500"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />live</span>
        </div>
        <div className="grid grid-cols-2 gap-x-6 gap-y-6 md:grid-cols-4">
          <WallMetric label="Active projects" value={w.activeProjects} sub={`${w.pipelineProjects} upcoming / pipeline`} />
          <WallMetric label="Client acquisition" value={`${w.newClients30} new`} sub={`${w.retainedClients} retained clients`} />
          <WallMetric label="Buyontime today" value={<span className="text-base text-amber-300">Not connected</span>} sub="New / repeat customers & voucher conversion appear once integrated" />
          <WallMetric label="Daily tally" value={formatInr(w.receivedTodayCents)} sub={<>Received today · invoiced {formatInr(w.revenueTodayCents)} · <span className={w.overdueCents ? "text-rose-300" : ""}>dues {formatInr(w.outstandingCents)}</span></>} />
        </div>
      </section>

      {/* C-suite */}
      <div className="mb-6 grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Cabin code="Executive suite" title="CEO & COO Suite" icon={Crown} href="/ceo">
            <div className="grid gap-4 sm:grid-cols-2">
              {[ceo, coo].map((a) => a && (
                <div key={a.id} className="rounded-lg border border-line bg-panel-2/40 p-3">
                  <div className="text-xs font-medium text-zinc-200">{a.name} · {a.designation}</div>
                  <div className="mt-1 truncate text-xs text-zinc-500">{deskOf(a.id)?.current ? `Focus: ${truncate(deskOf(a.id)!.current!.title, 50)}` : "Monitoring teams"}</div>
                </div>
              ))}
            </div>
            <div>
              <div className="mb-1.5 text-[11px] font-medium tracking-wide text-zinc-500 uppercase">Strategic roadmap · under evaluation</div>
              {c.thinkTank.length ? c.thinkTank.slice(0, 3).map((o) => <div key={o.id} className="flex justify-between gap-2 py-0.5 text-xs"><span className="truncate text-zinc-300">{o.title}</span><Badge>{o.status}</Badge></div>)
                : <p className="text-xs text-zinc-500">No initiatives yet — use Empire Command.</p>}
            </div>
            <div className="text-xs text-zinc-500">Cross-team: {c.last24h.tasksDone} tasks done in 24h · {c.approvals.length} decisions awaiting you · {c.risks.length} risk(s)</div>
          </Cabin>
        </div>
        <Cabin code="CFO desk" title="Finance & Accounts" icon={Landmark} manager={cfo} entry={deskOf(cfo?.id)} href="/finance">
          <Row k="Net cash flow (30d)" v={formatInr(f.net30Cents)} tone={f.net30Cents < 0 ? "text-rose-300" : undefined} />
          <Row k="Pending invoices" v={`${w.outstandingCount} · ${formatInr(w.outstandingCents)}`} />
          <Row k="Overdue" v={formatInr(w.overdueCents)} tone={w.overdueCents ? "text-rose-300" : undefined} />
          <Row k="Revenue (all time)" v={formatInr(f.inboundCents)} />
          <Row k="Operational budget left" v={formatInr(f.budgetRemainingCents)} />
        </Cabin>
      </div>

      {/* Department cabins */}
      <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-4">
        <Cabin code="Cabin A" title="Web Development Agency" icon={Code2} manager={web?.manager ?? null} entry={deskOf(web?.manager?.id)} href="/projects">
          <Row k="Active builds" v={web?.activeProjects ?? 0} />
          <Row k="Open tasks" v={web?.openTasks ?? 0} />
          <Row k="Active clients" v={web?.activeClients ?? 0} />
          <Row k="Revenue (30d)" v={formatInr(web?.revenue30Cents ?? 0)} />
        </Cabin>
        <Cabin code="Cabin B" title="HR Services & Consulting" icon={HeartHandshake} manager={hr?.manager ?? null} entry={deskOf(hr?.manager?.id)} href="/projects">
          <Row k="Active contracts" v={hr?.activeClients ?? 0} />
          <Row k="Open filings / tasks" v={hr?.openTasks ?? 0} />
          <Row k="Compliance KPIs" v={hr?.kpis.length ? `${Math.round(hr.kpis.reduce((s, k) => s + k.pct, 0) / hr.kpis.length)}% avg` : "not set"} />
          <Row k="Revenue (30d)" v={formatInr(hr?.revenue30Cents ?? 0)} />
        </Cabin>
        <Cabin code="Cabin C" title="Buyontime E-Commerce Ops" icon={ShoppingBag} manager={ecom?.manager ?? null} entry={deskOf(ecom?.manager?.id)}>
          <Row k="Open ops tasks" v={ecom?.openTasks ?? 0} />
          <Row k="Revenue (30d, recorded)" v={formatInr(ecom?.revenue30Cents ?? 0)} />
          <Row k="Margin health" v={ecom?.marginPct == null ? "no data" : `${ecom.marginPct}%`} />
          <Row k="Orders / subscribers" v="integration pending" tone="text-amber-300" />
        </Cabin>
        <Cabin code="Cabin D" title="Sales & Social Media Engine" icon={Megaphone} manager={sales?.manager ?? null} entry={deskOf(sales?.manager?.id)} href="/sales">
          <Row k="Leads found (24h)" v={c.sales.leadsFound24h} />
          <Row k="Awaiting your approval" v={c.sales.awaitingApproval} tone={c.sales.awaitingApproval ? "text-amber-300" : undefined} />
          <Row k="Ready to send" v={c.sales.readyToSend} />
          <Row k="Contacted → positive" v={`${c.sales.contacted} → ${c.sales.positive}`} />
          <Row k="Won" v={c.sales.won} tone={c.sales.won ? "text-emerald-300" : undefined} />
        </Cabin>
      </div>

      <p className="mt-6 flex items-center gap-2 text-xs text-zinc-500"><Briefcase className="h-3.5 w-3.5" />Green dot = a manager is actively working on a task. Progress bars show each cabin manager's completed vs. assigned work.</p>
    </>
  );
}
