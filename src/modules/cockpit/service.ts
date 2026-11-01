import "server-only";
import { formatInr } from "@/lib/utilities/format";
import type { AppContext } from "@/modules/auth/session";
import type { BuyontimeSummary } from "@/lib/integrations/buyontime";
import { listAgents } from "@/modules/orchestration/engine";
import type { AgentWithPermissions, Approval, AuditLog, Budget, BusinessUnit, Client, Execution, FinancialRecord, Kpi, Kra, Opportunity, Project, Task } from "@/types/domain";
import { deskEntry, financeSummary, invoiceSummary, kpiProgress, marginPct, withinHours, type DeskEntry, type FinanceSummary, type InvoiceLite } from "./metrics";

export interface UnitOverview {
  unit: BusinessUnit;
  manager: AgentWithPermissions | null;
  activeProjects: number;
  blockedTasks: number;
  openTasks: number;
  activeClients: number;
  revenue30Cents: number;
  marginPct: number | null;
  kpis: { name: string; pct: number }[];
}

export interface Cockpit {
  agents: AgentWithPermissions[];
  last24h: { tasksDone: number; tasksCreated: number; runsOk: number; runsFailed: number; decisions: number; opportunities: number };
  units: UnitOverview[];
  finance: FinanceSummary;
  desk: { agent: AgentWithPermissions; entry: DeskEntry; pendingFinanceApprovals?: number }[];
  thinkTank: Opportunity[];
  risks: string[];
  approvals: Approval[];
  latestBriefing: Execution | null;
  kras: Kra[];
  wall: {
    activeProjects: number; pipelineProjects: number; newClients30: number; retainedClients: number;
    revenueTodayCents: number; receivedTodayCents: number; outstandingCents: number; overdueCents: number; outstandingCount: number;
  };
  sales: { newLeads: number; awaitingApproval: number; readyToSend: number; contacted: number; positive: number; won: number; leadsFound24h: number };
}

const THIRTY_DAYS_AGO = () => new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);

export async function loadCockpit(ctx: AppContext): Promise<Cockpit> {
  const since24 = new Date(Date.now() - 86_400_000).toISOString();
  const org = ctx.organisation.id;
  const [agents, units, projects, tasks, clients, records, budgets, kras, kpis, approvals, opps, runs, audit24, briefing, invoices, leads] = await Promise.all([
    listAgents(ctx),
    ctx.db.from("business_units").select("id, name, description, department_id, manager_agent_id").eq("organisation_id", org).order("name").returns<BusinessUnit[]>(),
    ctx.db.from("projects").select("*").eq("organisation_id", org).in("status", ["planned", "active", "on_hold"]).returns<Project[]>(),
    ctx.db.from("tasks").select("id, title, status, priority, assigned_agent_id, project_id, kra_id, created_at, updated_at").eq("organisation_id", org).limit(5000).returns<(Task & { updated_at: string })[]>(),
    ctx.db.from("clients").select("id, name, status, business_unit_id, created_at").eq("organisation_id", org).returns<(Client & { created_at: string })[]>(),
    ctx.db.from("financial_records").select("*").eq("organisation_id", org).limit(10000).returns<FinancialRecord[]>(),
    ctx.db.from("budgets").select("*").eq("organisation_id", org).returns<Budget[]>(),
    ctx.db.from("kras").select("id, name, description, business_unit_id").eq("organisation_id", org).order("name").returns<Kra[]>(),
    ctx.db.from("kpis").select("*").eq("organisation_id", org).returns<Kpi[]>(),
    ctx.db.from("approvals").select("*").eq("organisation_id", org).eq("status", "pending").order("created_at").returns<Approval[]>(),
    ctx.db.from("opportunities").select("*").eq("organisation_id", org).in("status", ["proposed", "evaluating"]).order("created_at", { ascending: false }).limit(5).returns<Opportunity[]>(),
    ctx.db.from("agent_executions").select("id, status, created_at").eq("organisation_id", org).gte("created_at", since24).returns<Pick<Execution, "id" | "status" | "created_at">[]>(),
    ctx.db.from("audit_logs").select("action, entity, created_at").eq("organisation_id", org).gte("created_at", since24).limit(2000).returns<Pick<AuditLog, "action" | "entity" | "created_at">[]>(),
    ctx.db.from("agent_executions").select("*").eq("organisation_id", org).eq("kind", "chat").like("input", "[BRIEFING]%").order("created_at", { ascending: false }).limit(1).returns<Execution[]>(),
    ctx.db.from("invoices").select("amount_cents, status, due_on, paid_on, issued_on").eq("organisation_id", org).returns<InvoiceLite[]>(),
    ctx.db.from("leads").select("status, created_at").eq("organisation_id", org).limit(10000).returns<{ status: string; created_at: string }[]>(),
  ]);

  const T = tasks.data ?? [];
  const P = projects.data ?? [];
  const R = records.data ?? [];
  const K = kras.data ?? [];
  const KP = kpis.data ?? [];
  const since30 = THIRTY_DAYS_AGO();
  const projectUnit = new Map(P.map((p) => [p.id, p.business_unit_id]));
  const agentUnit = new Map(agents.map((a) => [a.id, a.business_unit_id]));
  const taskUnit = (t: Task) => (t.project_id && projectUnit.get(t.project_id)) || (t.assigned_agent_id && agentUnit.get(t.assigned_agent_id)) || null;
  const audit = audit24.data ?? [];

  const unitOverviews: UnitOverview[] = (units.data ?? []).map((unit) => {
    const unitTasks = T.filter((t) => taskUnit(t) === unit.id);
    const unitRecords30 = R.filter((r) => r.business_unit_id === unit.id && r.occurred_on >= since30);
    const unitKras = new Set(K.filter((k) => k.business_unit_id === unit.id).map((k) => k.id));
    return {
      unit,
      manager: agents.find((a) => a.id === unit.manager_agent_id) ?? null,
      activeProjects: P.filter((p) => p.business_unit_id === unit.id).length,
      blockedTasks: unitTasks.filter((t) => t.status === "blocked").length,
      openTasks: unitTasks.filter((t) => ["todo", "in_progress", "blocked"].includes(t.status)).length,
      activeClients: (clients.data ?? []).filter((c) => c.business_unit_id === unit.id && c.status === "active").length,
      revenue30Cents: unitRecords30.filter((r) => r.kind === "income").reduce((s, r) => s + Number(r.amount_cents), 0),
      marginPct: marginPct(unitRecords30),
      kpis: KP.filter((k) => unitKras.has(k.kra_id)).map((k) => ({ name: k.name, pct: kpiProgress(k) })),
    };
  });

  const finance = financeSummary(R, budgets.data ?? []);
  const pending = approvals.data ?? [];
  const deskAgents = agents.filter((a) => a.status === "active" && ["manager", "executive", "coo"].includes(a.tier));
  const desk = deskAgents.map((agent) => ({
    agent,
    entry: deskEntry(T.filter((t) => t.assigned_agent_id === agent.id)),
    ...(agent.designation.toLowerCase().includes("finance") ? { pendingFinanceApprovals: pending.filter((p) => /^(finance|budget)\./.test(p.action_type)).length } : {}),
  }));

  const risks: string[] = [];
  const blocked = T.filter((t) => t.status === "blocked").length;
  const failed = T.filter((t) => t.status === "failed").length;
  if (blocked) risks.push(`${blocked} task(s) blocked`);
  if (failed) risks.push(`${failed} task(s) failed and need a re-run or reassignment`);
  finance.overspentBudgets.forEach((b) => risks.push(`Budget overspent: ${b}`));
  KP.filter((k) => kpiProgress(k) < 50).forEach((k) => risks.push(`KPI behind target: ${k.name} (${kpiProgress(k)}%)`));
  const unassigned = T.filter((t) => !t.assigned_agent_id && ["todo", "blocked"].includes(t.status)).length;
  if (unassigned) risks.push(`${unassigned} open task(s) have no assignee`);

  const today = new Date().toISOString().slice(0, 10);
  const since30Iso = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const activeClients = (clients.data ?? []).filter((x) => x.status === "active");
  const dues = invoiceSummary(invoices.data ?? []);
  const LD = leads.data ?? [];
  const leadCount = (...st: string[]) => LD.filter((l) => st.includes(l.status)).length;

  return {
    wall: {
      activeProjects: P.filter((p) => p.status === "active").length,
      pipelineProjects: P.filter((p) => p.status === "planned" || p.status === "on_hold").length,
      newClients30: activeClients.filter((x) => x.created_at >= since30Iso).length,
      retainedClients: activeClients.filter((x) => x.created_at < since30Iso).length,
      revenueTodayCents: dues.invoicedTodayCents,
      receivedTodayCents: R.filter((r) => r.kind === "income" && r.occurred_on === today).reduce((s2, r) => s2 + Number(r.amount_cents), 0),
      outstandingCents: dues.outstandingCents,
      overdueCents: dues.overdueCents,
      outstandingCount: dues.outstandingCount,
    },
    sales: {
      newLeads: leadCount("new"), awaitingApproval: leadCount("pitch_ready"), readyToSend: leadCount("approved"),
      contacted: leadCount("contacted", "replied", "won", "lost"), positive: leadCount("replied", "won"), won: leadCount("won"),
      leadsFound24h: LD.filter((l) => withinHours(l.created_at, 24)).length,
    },
    agents,
    last24h: {
      tasksDone: T.filter((t) => t.status === "done" && withinHours(t.updated_at, 24)).length,
      tasksCreated: T.filter((t) => withinHours(t.created_at, 24)).length,
      runsOk: (runs.data ?? []).filter((r) => r.status === "succeeded").length,
      runsFailed: (runs.data ?? []).filter((r) => r.status === "failed").length,
      decisions: audit.filter((a) => a.action === "approval.approved" || a.action === "approval.rejected").length,
      opportunities: audit.filter((a) => a.entity === "opportunities" && a.action === "insert").length,
    },
    units: unitOverviews,
    finance,
    desk,
    thinkTank: opps.data ?? [],
    risks,
    approvals: pending,
    latestBriefing: briefing.data?.[0] ?? null,
    kras: K,
  };
}

/** Plain-text fact sheet fed to the AI so reports are grounded in data and never invented. */
export function cockpitFacts(ctx: AppContext, c: Cockpit, store?: BuyontimeSummary | null): string {
  const f = c.finance;
  const lines = [
    `Organisation: ${ctx.organisation.name}. Report time: ${new Date().toISOString()}.`,
    `Last 24h: ${c.last24h.tasksDone} tasks completed, ${c.last24h.tasksCreated} tasks created, ${c.last24h.runsOk} agent runs succeeded, ${c.last24h.runsFailed} failed, ${c.last24h.decisions} founder decisions, ${c.last24h.opportunities} new opportunities.`,
    `Finance (all time): inbound ${formatInr(f.inboundCents)}, outbound ${formatInr(f.outboundCents)}, net ${formatInr(f.netCents)}. Last 30 days: inbound ${formatInr(f.inbound30Cents)}, burn ${formatInr(f.burn30Cents)}, net ${formatInr(f.net30Cents)}. Active budget pool ${formatInr(f.budgetPoolCents)}, remaining ${formatInr(f.budgetRemainingCents)}.`,
    ...c.units.map((u) => `Unit ${u.unit.name} (manager ${u.manager?.name ?? "none"}): ${u.activeProjects} active projects, ${u.openTasks} open tasks, ${u.blockedTasks} blocked, ${u.activeClients} active clients, 30-day revenue ${formatInr(u.revenue30Cents)}, margin ${u.marginPct == null ? "n/a" : `${u.marginPct}%`}, KPIs: ${u.kpis.map((k) => `${k.name} ${k.pct}%`).join(", ") || "none set"}.`),
    ...c.desk.map((d) => `Desk ${d.agent.name} (${d.agent.designation}): focus "${d.entry.current?.title ?? "idle"}", ${d.entry.open} open, ${d.entry.done} done, progress ${d.entry.progressPct}%.`),
    `Main wall: ${c.wall.activeProjects} active projects, ${c.wall.pipelineProjects} in pipeline; clients: ${c.wall.newClients30} new (30d), ${c.wall.retainedClients} retained; today: invoiced ${formatInr(c.wall.revenueTodayCents)}, received ${formatInr(c.wall.receivedTodayCents)}; outstanding dues ${formatInr(c.wall.outstandingCents)} (${c.wall.outstandingCount} invoices, overdue ${formatInr(c.wall.overdueCents)}). ${store ? `Buyontime (24h): ${store.orders} orders, revenue ${formatInr(store.revenuePaise)}, est. profit ${formatInr(store.estimatedProfitPaise)}, ${store.newCustomers} new customers, ${store.repeatCustomers} repeat, voucher conversion ${store.voucherConversionPct}%, ${store.toFulfil.length} orders waiting to be placed on Meesho.` : "Buyontime: not connected."}`,
    `Sales engine: ${c.sales.leadsFound24h} leads found in 24h, ${c.sales.newLeads} awaiting AI review, ${c.sales.awaitingApproval} pitches awaiting founder approval, ${c.sales.readyToSend} approved & ready to send, ${c.sales.contacted} contacted, ${c.sales.positive} positive replies, ${c.sales.won} won.`,
    `Pending founder approvals: ${c.approvals.length}${c.approvals.length ? ` (${c.approvals.map((a) => `${a.title} [${a.risk}]`).join("; ")})` : ""}.`,
    `Opportunities under evaluation: ${c.thinkTank.map((o) => o.title).join("; ") || "none"}.`,
    `Risks: ${c.risks.join("; ") || "none detected"}.`,
    `KRAs: ${c.kras.map((k) => k.name).join(", ")}.`,
  ];
  return lines.join("\n");
}
