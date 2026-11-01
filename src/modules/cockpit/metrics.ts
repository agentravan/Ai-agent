import type { Budget, FinancialRecord, Kpi, Task } from "@/types/domain";

/** Pure cockpit calculations (no I/O) — deterministic and unit-tested. */

const DAY = 86_400_000;
const isoDate = (d: Date) => d.toISOString().slice(0, 10);

export interface FinanceSummary {
  inboundCents: number;
  outboundCents: number;
  netCents: number;
  inbound30Cents: number;
  burn30Cents: number;
  net30Cents: number;
  budgetPoolCents: number;
  budgetRemainingCents: number;
  overspentBudgets: string[];
}

export function financeSummary(records: FinancialRecord[], budgets: Budget[], now = new Date()): FinanceSummary {
  const since = isoDate(new Date(now.getTime() - 30 * DAY));
  const today = isoDate(now);
  const sum = (rs: FinancialRecord[]) => rs.reduce((s, r) => s + Number(r.amount_cents), 0);
  const income = records.filter((r) => r.kind === "income");
  const expense = records.filter((r) => r.kind === "expense");
  const recent = (rs: FinancialRecord[]) => rs.filter((r) => r.occurred_on >= since && r.occurred_on <= today);

  const active = budgets.filter((b) => b.period_start <= today && b.period_end >= today);
  const spentIn = (b: Budget) => sum(expense.filter((r) => r.budget_id === b.id && r.occurred_on >= b.period_start && r.occurred_on <= b.period_end));
  const pool = active.reduce((s, b) => s + Number(b.amount_cents), 0);
  const spent = active.reduce((s, b) => s + spentIn(b), 0);

  return {
    inboundCents: sum(income),
    outboundCents: sum(expense),
    netCents: sum(income) - sum(expense),
    inbound30Cents: sum(recent(income)),
    burn30Cents: sum(recent(expense)),
    net30Cents: sum(recent(income)) - sum(recent(expense)),
    budgetPoolCents: pool,
    budgetRemainingCents: pool - spent,
    overspentBudgets: active.filter((b) => spentIn(b) > Number(b.amount_cents)).map((b) => b.name),
  };
}

/** Margin as a percentage of income, or null when there is no income to measure against. */
export function marginPct(records: FinancialRecord[]): number | null {
  const income = records.filter((r) => r.kind === "income").reduce((s, r) => s + Number(r.amount_cents), 0);
  if (income <= 0) return null;
  const expense = records.filter((r) => r.kind === "expense").reduce((s, r) => s + Number(r.amount_cents), 0);
  return Math.round(((income - expense) / income) * 100);
}

export function kpiProgress(kpi: Pick<Kpi, "target" | "current_value">): number {
  const target = Number(kpi.target);
  if (!(target > 0)) return 0;
  return Math.min(100, Math.round((Number(kpi.current_value) / target) * 100));
}

const PRIORITY_RANK: Record<Task["priority"], number> = { critical: 0, high: 1, medium: 2, low: 3 };

export interface DeskEntry {
  current: Pick<Task, "id" | "title" | "status"> | null;
  progressPct: number;
  open: number;
  done: number;
  blocked: number;
}

/** "Who is doing what": current focus = in-progress task, else highest-priority open task. */
export function deskEntry(tasks: Pick<Task, "id" | "title" | "status" | "priority" | "created_at">[]): DeskEntry {
  const relevant = tasks.filter((t) => t.status !== "cancelled");
  const done = relevant.filter((t) => t.status === "done").length;
  const open = relevant.filter((t) => ["todo", "in_progress", "blocked", "failed"].includes(t.status));
  const current =
    open.find((t) => t.status === "in_progress") ??
    [...open].sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || a.created_at.localeCompare(b.created_at))[0] ??
    null;
  return {
    current: current ? { id: current.id, title: current.title, status: current.status } : null,
    progressPct: relevant.length ? Math.round((done / relevant.length) * 100) : 0,
    open: open.length,
    done,
    blocked: relevant.filter((t) => t.status === "blocked").length,
  };
}

export const withinHours = (iso: string, hours: number, now = new Date()) => now.getTime() - new Date(iso).getTime() <= hours * 3_600_000;

export interface InvoiceLite { amount_cents: number; status: "draft" | "sent" | "paid" | "void"; due_on: string; paid_on: string | null; issued_on: string }

/** CFO desk: outstanding dues = sent & unpaid; overdue = past due date. */
export function invoiceSummary(invoices: InvoiceLite[], now = new Date()) {
  const today = now.toISOString().slice(0, 10);
  const open = invoices.filter((i) => i.status === "sent");
  const sum = (xs: InvoiceLite[]) => xs.reduce((s, i) => s + Number(i.amount_cents), 0);
  return {
    outstandingCents: sum(open),
    outstandingCount: open.length,
    overdueCents: sum(open.filter((i) => i.due_on < today)),
    overdueCount: open.filter((i) => i.due_on < today).length,
    receivedTodayCents: sum(invoices.filter((i) => i.status === "paid" && i.paid_on === today)),
    invoicedTodayCents: sum(invoices.filter((i) => i.status !== "void" && i.issued_on === today)),
  };
}
