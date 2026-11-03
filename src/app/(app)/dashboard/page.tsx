import Link from "next/link";
import { BadgeCheck, CheckCircle2, Cpu, TrendingDown, TrendingUp, Wallet } from "lucide-react";
import type { ReactNode } from "react";
import { AiStatusPanel } from "@/components/dashboard/ai-status";
import { Badge, Card, Empty, Flash, PageHeader, Stat, type SearchParams } from "@/components/ui";
import { SubmitButton } from "@/components/ui/submit-button";
import { aiStatus } from "@/lib/ai/registry";
import { can } from "@/lib/permissions";
import { formatDateTime, formatInr, truncate } from "@/lib/utilities/format";
import { decideApprovalAction } from "@/modules/approvals/actions";
import { requireContext } from "@/modules/auth/session";
import { emailReportNowAction, executiveReportAction } from "@/modules/ceo/actions";
import { emailConfigured } from "@/lib/integrations/email";
import { loadCockpit } from "@/modules/cockpit/service";

export const metadata = { title: "CEO Executive Cockpit" };
export const maxDuration = 300;

function Progress({ pct }: { pct: number }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-24 rounded-full bg-line"><div className="h-1.5 rounded-full bg-gold" style={{ width: `${pct}%` }} /></div>
      <span className="text-xs text-muted">{pct}%</span>
    </div>
  );
}

const Section = ({ n, title, children, action, className }: { n: number; title: string; children: ReactNode; action?: ReactNode; className?: string }) => (
  <Card title={<span className="flex items-center gap-2.5"><span className="num grid h-5 w-5 place-items-center rounded bg-gold/10 text-[11px] font-semibold text-gold">{n}</span>{title}</span>} action={action} className={className}>{children}</Card>
);
const ViewLink = ({ href, children }: { href: string; children: ReactNode }) => (
  <Link href={href} className="text-xs font-medium text-zinc-400 transition hover:text-zinc-100">{children} →</Link>
);

/** "3 h ago" — so old failures (from before a fix) are not mistaken for a problem right now. */
function ago(iso: string | null): string {
  if (!iso) return "—";
  const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  return min < 60 ? `${min} min ago` : `${Math.round(min / 60)} h ago`;
}

export default async function CockpitPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireContext();
  const [params, ai, c] = await Promise.all([searchParams, aiStatus(), loadCockpit(ctx)]);
  const ceo = c.agents.find((a) => a.tier === "ceo");
  const canOperate = can(ctx.profile.role, "operate");
  const canGovern = can(ctx.profile.role, "govern");
  const f = c.finance;
  const d = c.last24h;

  return (
    <>
      <PageHeader
        eyebrow="CEO Executive Cockpit"
        title="Founder Dashboard"
        subtitle={`${ctx.organisation.name} · ${formatDateTime(new Date().toISOString())}`}
        action={<div className="max-w-xs"><AiStatusPanel status={ai} /></div>}
      />
      <Flash params={params} />

      <div className="grid gap-6 xl:grid-cols-3">
        {/* 1. Executive summary */}
        <Section n={1} title="Executive summary · last 24h" className="xl:col-span-2"
          action={ceo && canOperate && ai.available && (
            <form action={executiveReportAction}>
              <input type="hidden" name="agent_id" value={ceo.id} />
              <input type="hidden" name="report" value="briefing" />
              <input type="hidden" name="return_to" value="/dashboard" />
              <SubmitButton variant="ghost" pendingText="Atlas is briefing…">Generate morning briefing</SubmitButton>
            </form>
          )}>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Stat icon={CheckCircle2} label="Tasks completed" value={d.tasksDone} hint={`${d.tasksCreated} created`} />
            <Stat icon={Cpu} label="Agent runs succeeded" value={d.runsOk}
              hint={d.runsFailed ? `${d.runsFailed} failed · last failure ${ago(d.lastFailureAt)}${d.lastSuccessAt && d.lastFailureAt && d.lastSuccessAt > d.lastFailureAt ? " · working since" : ""}` : "no failures"} />
            <Stat icon={BadgeCheck} label="Awaiting you" value={c.approvals.length} hint={`${d.decisions} decided in 24h`} />
          </div>
          {c.latestBriefing?.output ? (
            <details className="mt-4 rounded-lg border border-line bg-panel-2/40 p-4" open>
              <summary className="cursor-pointer text-xs text-muted">Latest AI briefing by {ceo?.name ?? "CEO"} · {formatDateTime(c.latestBriefing.created_at)}</summary>
              <div className="mt-2 max-h-96 overflow-y-auto text-sm whitespace-pre-wrap text-zinc-200">{c.latestBriefing.output}</div>
            </details>
          ) : (
            <p className="mt-4 text-xs text-muted">{ai.available ? "No briefing yet — generate one to get an AI narrative grounded in these numbers." : "AI briefing unavailable until an AI provider is connected. All figures above are live."}</p>
          )}
          {canOperate && (
            <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-4">
              <span className="mr-auto text-xs text-muted">{emailConfigured() ? "Daily emails: 09:00 briefing · 19:00 wrap-up (IST)" : "Email reports: connect your mailbox to enable"}</span>
              {emailConfigured() && (["morning", "evening"] as const).map((slot) => (
                <form key={slot} action={emailReportNowAction}>
                  <input type="hidden" name="slot" value={slot} />
                  <SubmitButton variant="ghost" pendingText="Sending…">{slot === "morning" ? "Email briefing now" : "Email wrap-up now"}</SubmitButton>
                </form>
              ))}
            </div>
          )}
        </Section>

        {/* 3. Financial headline */}
        <Section n={3} title="Financial headline & budget" action={<ViewLink href="/finance">Finance</ViewLink>}>
          <div className="mb-4 flex items-center justify-between rounded-lg bg-panel-2/60 p-3">
            <div><div className="text-xs text-muted">Net profit · 30 days</div><div className={`num mt-0.5 text-2xl font-semibold ${f.net30Cents < 0 ? "text-rose-300" : "text-zinc-50"}`}>{formatInr(f.net30Cents)}</div></div>
            {f.net30Cents < 0 ? <TrendingDown className="h-5 w-5 text-rose-400" /> : f.net30Cents > 0 ? <TrendingUp className="h-5 w-5 text-emerald-400" /> : <Wallet className="h-5 w-5 text-zinc-500" />}
          </div>
          <dl className="num grid grid-cols-2 gap-x-3 gap-y-2.5 text-sm">
            <dt className="text-muted">Total inbound</dt><dd className="text-right text-emerald-300">{formatInr(f.inboundCents)}</dd>
            <dt className="text-muted">Total outbound</dt><dd className="text-right text-amber-300">{formatInr(f.outboundCents)}</dd>
            <dt className="text-muted">Budget pool</dt><dd className="text-right">{formatInr(f.budgetPoolCents)}</dd>
            <dt className="text-muted">Budget remaining</dt><dd className="text-right">{formatInr(f.budgetRemainingCents)}</dd>
            <dt className="text-muted">Burn (30 days)</dt><dd className="text-right">{formatInr(f.burn30Cents)}</dd>
          </dl>
          {f.inboundCents === 0 && f.outboundCents === 0 && <p className="mt-3 text-xs text-muted">No transactions recorded yet.</p>}
        </Section>

        {/* 2. Business units */}
        <Section n={2} title="Business units overview" className="xl:col-span-3">
          <div className="grid gap-3 md:grid-cols-3">
            {c.units.map((u) => {
              const isHr = u.unit.name.startsWith("HR");
              const isEcom = u.unit.name.includes("Buyontime");
              return (
                <div key={u.unit.id} className="rounded-lg border border-line bg-panel-2/40 p-4 text-sm">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="font-medium text-zinc-50">{u.unit.name}</h3>
                    <Badge tone={u.blockedTasks ? "warn" : "good"}>{u.blockedTasks ? `${u.blockedTasks} blocked` : "on track"}</Badge>
                  </div>
                  <p className="text-xs text-muted">Manager: {u.manager ? `${u.manager.name} · ${u.manager.designation}` : "unassigned"}</p>
                  <dl className="mt-2 grid grid-cols-2 gap-y-1 text-xs">
                    <dt className="text-muted">Active projects</dt><dd className="text-right">{u.activeProjects}</dd>
                    <dt className="text-muted">Open tasks</dt><dd className="text-right">{u.openTasks}</dd>
                    {isHr && (<><dt className="text-muted">Active contracts</dt><dd className="text-right">{u.activeClients}</dd></>)}
                    {!isHr && !isEcom && (<><dt className="text-muted">Active clients</dt><dd className="text-right">{u.activeClients}</dd></>)}
                    <dt className="text-muted">Revenue (30d)</dt><dd className="text-right">{formatInr(u.revenue30Cents)}</dd>
                    {isEcom && (<><dt className="text-muted">Margin health</dt><dd className="text-right">{u.marginPct == null ? "no sales data" : `${u.marginPct}%`}</dd></>)}
                    {isEcom && (<><dt className="text-muted">Orders</dt><dd className="text-right text-amber-300">integration pending</dd></>)}
                  </dl>
                  <div className="mt-2 border-t border-line pt-2">
                    {u.kpis.length ? u.kpis.slice(0, 3).map((k) => <div key={k.name} className="flex items-center justify-between gap-2 text-xs"><span className="truncate">{k.name}</span><Progress pct={k.pct} /></div>)
                      : <p className="text-xs text-muted">{isHr ? "Compliance status: no KPI set" : "No KPIs set"} · <Link href="/kpis" className="text-zinc-300 underline decoration-zinc-600 underline-offset-2 hover:text-white">set targets</Link></p>}
                  </div>
                </div>
              );
            })}
          </div>
        </Section>

        {/* 4. Virtual desk */}
        <Section n={4} title="Real-time office · who is doing what" className="xl:col-span-2" action={<ViewLink href="/coo">COO Office</ViewLink>}>
          <ul className="divide-y divide-line">
            {c.desk.map(({ agent, entry, pendingFinanceApprovals }) => (
              <li key={agent.id} className="flex flex-col gap-1 py-2.5 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="text-sm"><span className="text-zinc-50">{agent.name}</span> <span className="text-muted">· {agent.designation}</span></div>
                  <div className="truncate text-xs text-muted">
                    {entry.current ? <>Working on: <span className="text-zinc-300">{truncate(entry.current.title, 70)}</span> ({entry.current.status.replace("_", " ")})</> : "Idle — no open tasks"}
                    {pendingFinanceApprovals !== undefined && ` · ${pendingFinanceApprovals} finance approval(s) pending`}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-3"><span className="text-xs text-muted">{entry.done}/{entry.done + entry.open}</span><Progress pct={entry.progressPct} /></div>
              </li>
            ))}
          </ul>
        </Section>

        {/* 5. Think tank */}
        <Section n={5} title="Strategic think-tank" action={<ViewLink href="/opportunities">All ideas</ViewLink>}>
          <h3 className="text-xs tracking-wide text-muted uppercase">Growth ideas under evaluation</h3>
          {c.thinkTank.length ? (
            <ul className="mt-1 space-y-1 text-sm">{c.thinkTank.map((o) => <li key={o.id} className="flex justify-between gap-2"><span className="truncate">{o.title}</span><Badge>{o.status}</Badge></li>)}</ul>
          ) : <p className="mt-1 text-xs text-muted">None yet — ask Atlas in the CEO Office or use Empire Command.</p>}
          <h3 className="mt-4 text-xs tracking-wide text-muted uppercase">Risks</h3>
          {c.risks.length ? <ul className="mt-1 space-y-1 text-sm text-amber-200">{c.risks.map((r) => <li key={r}>• {r}</li>)}</ul> : <p className="mt-1 text-xs text-muted">No risks detected.</p>}
        </Section>

        {/* 6. Approval matrix */}
        <Section n={6} title="Approval matrix · pending Founder sign-off" className="xl:col-span-3" action={<ViewLink href="/approvals">Full matrix & Modify</ViewLink>}>
          {c.approvals.length ? (
            <ul className="divide-y divide-line">
              {c.approvals.map((a) => (
                <li key={a.id} className="flex flex-col gap-2 py-2.5 md:flex-row md:items-center md:justify-between">
                  <div className="min-w-0 text-sm">
                    <span className="text-zinc-50">{a.title}</span>
                    <span className="ml-2 inline-flex gap-1.5 align-middle"><Badge>{a.risk}</Badge><Badge tone="neutral">{a.action_type}</Badge></span>
                  </div>
                  {canGovern && (
                    <form action={decideApprovalAction} className="flex shrink-0 gap-2">
                      <input type="hidden" name="id" value={a.id} />
                      <input type="hidden" name="note" value="" />
                      <input type="hidden" name="return_to" value="/dashboard" />
                      <SubmitButton name="decision" value="approved">Approve</SubmitButton>
                      <SubmitButton name="decision" value="rejected" variant="danger">Reject</SubmitButton>
                      <Link href="/approvals" className="btn-ghost">Modify</Link>
                    </form>
                  )}
                </li>
              ))}
            </ul>
          ) : <Empty>Nothing needs your sign-off. Routine and mid-tier work is being handled by managers.</Empty>}
        </Section>
      </div>
    </>
  );
}
