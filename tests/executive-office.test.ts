import { describe, expect, it } from "vitest";
import { deskEntry, financeSummary, kpiProgress, marginPct } from "@/modules/cockpit/metrics";
import { decideStep, isFounderDomain, resolveKra } from "@/modules/orchestration/policy";
import type { PlanStep } from "@/modules/orchestration/plan";
import { budgetSchema, financialRecordSchema, kpiSchema, parseForm } from "@/lib/validation/forms";
import type { Budget, FinancialRecord, Kra } from "@/types/domain";

const step = (o: Partial<PlanStep> = {}): PlanStep => ({ action: "create_task", title: "T", description: "", priority: "medium", risk: "low", ...o });
const ALL = ["ai.execute", "tasks.create", "tasks.delegate", "projects.create", "opportunities.create", "approvals.request"];

describe("escalation ladder", () => {
  it("low risk executes inside the team without review", () => expect(decideStep(step(), ALL, false)).toEqual({ kind: "execute" }));
  it("medium risk executes with manager review — Founder is not involved", () => expect(decideStep(step({ risk: "medium" }), ALL, false)).toEqual({ kind: "execute", review: "manager" }));
  it("high risk reaches the Founder", () => expect(decideStep(step({ risk: "high" }), ALL, false).kind).toBe("approval"));
  it("money / external / legal / policy always reach the Founder, even at low risk", () => {
    for (const a of ["finance.spend", "budget.increase", "external.contact", "legal.sign", "policy.change"])
      expect(decideStep(step({ approval_action: a }), ALL, false).kind).toBe("approval");
    expect(isFounderDomain("tasks.create")).toBe(false);
  });
});

describe("resolveKra", () => {
  const kras: Kra[] = [
    { id: "g", name: "Strategic growth", description: null, business_unit_id: null },
    { id: "w", name: "Client acquisition", description: null, business_unit_id: "web" },
  ];
  it("uses the named KRA (case-insensitive)", () => expect(resolveKra({ kra: "client ACQUISITION" }, { business_unit_id: null }, kras)?.id).toBe("w"));
  it("falls back to the assignee's unit KRA", () => expect(resolveKra({}, { business_unit_id: "web" }, kras)?.id).toBe("w"));
  it("falls back to Strategic growth so every action is tied to a KRA", () => expect(resolveKra({ kra: "unknown" }, { business_unit_id: null }, kras)?.id).toBe("g"));
});

const rec = (o: Partial<FinancialRecord>): FinancialRecord => ({ id: Math.random().toString(), kind: "income", amount_cents: 0, currency: "INR", occurred_on: "2026-11-01", description: null, business_unit_id: null, budget_id: null, client_id: null, created_at: "", ...o });
const budget: Budget = { id: "b1", name: "Ads Nov", department_id: null, period_start: "2026-11-01", period_end: "2026-11-30", amount_cents: 50_000, currency: "INR" };
const NOW = new Date("2026-11-15T10:00:00Z");

describe("financeSummary", () => {
  it("computes inbound, outbound, net, 30-day burn and budget pool", () => {
    const f = financeSummary([
      rec({ kind: "income", amount_cents: 200_000, occurred_on: "2026-11-10" }),
      rec({ kind: "income", amount_cents: 100_000, occurred_on: "2026-09-01" }),
      rec({ kind: "expense", amount_cents: 30_000, occurred_on: "2026-11-12", budget_id: "b1" }),
    ], [budget], NOW);
    expect(f).toMatchObject({ inboundCents: 300_000, outboundCents: 30_000, netCents: 270_000, inbound30Cents: 200_000, burn30Cents: 30_000, net30Cents: 170_000, budgetPoolCents: 50_000, budgetRemainingCents: 20_000, overspentBudgets: [] });
  });
  it("flags overspent budgets (financial limit breach)", () => {
    expect(financeSummary([rec({ kind: "expense", amount_cents: 60_000, occurred_on: "2026-11-05", budget_id: "b1" })], [budget], NOW).overspentBudgets).toEqual(["Ads Nov"]);
  });
  it("is all zeros with no data (never invents numbers)", () => expect(financeSummary([], [], NOW)).toMatchObject({ inboundCents: 0, netCents: 0, budgetPoolCents: 0 }));
});

describe("metrics", () => {
  it("margin is null without income", () => {
    expect(marginPct([])).toBeNull();
    expect(marginPct([rec({ amount_cents: 1000 }), rec({ kind: "expense", amount_cents: 250 })])).toBe(75);
  });
  it("kpiProgress caps at 100 and guards zero targets", () => {
    expect(kpiProgress({ target: 10, current_value: 4 })).toBe(40);
    expect(kpiProgress({ target: 10, current_value: 25 })).toBe(100);
    expect(kpiProgress({ target: 0, current_value: 5 })).toBe(0);
  });
  it("desk shows in-progress work first, else highest priority, with progress %", () => {
    const t = (id: string, status: string, priority: string, created_at = "2026-11-01") => ({ id, title: id, status, priority, created_at }) as never;
    expect(deskEntry([t("a", "todo", "low"), t("b", "todo", "critical"), t("c", "done", "low")])).toMatchObject({ current: { id: "b" }, progressPct: 33, open: 2, done: 1 });
    expect(deskEntry([t("a", "todo", "critical"), t("b", "in_progress", "low")]).current?.id).toBe("b");
    expect(deskEntry([])).toMatchObject({ current: null, progressPct: 0 });
  });
});

describe("finance & KPI validation", () => {
  const form = (o: Record<string, string>) => { const f = new FormData(); Object.entries(o).forEach(([k, v]) => f.append(k, v)); return f; };
  it("converts rupees to integer cents and rejects non-positive amounts", () => {
    expect(parseForm(financialRecordSchema, form({ kind: "income", amount_inr: "1499.99", occurred_on: "2026-11-01", description: "", business_unit_id: "", budget_id: "" }))).toMatchObject({ amount_cents: 149999, business_unit_id: null });
    expect(() => parseForm(financialRecordSchema, form({ kind: "expense", amount_inr: "0", occurred_on: "2026-11-01", description: "" }))).toThrow(/greater than 0/);
  });
  it("rejects budgets that end before they start", () => {
    expect(() => parseForm(budgetSchema, form({ name: "X", amount_inr: "100", period_start: "2026-11-30", period_end: "2026-11-01" }))).toThrow(/End date/);
  });
  it("requires a positive KPI target", () => {
    expect(() => parseForm(kpiSchema, form({ kra_id: "3f1c2a52-6b0e-4c55-9d43-2a7c1e0b9f10", name: "Clients", unit: "", target: "0" }))).toThrow(/Target/);
  });
});
