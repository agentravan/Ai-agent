import { describe, expect, it } from "vitest";
import { checkAgentCanRun, checkCostLimit, checkTaskRunnable, decideStep, monthStartIso } from "@/modules/orchestration/policy";
import type { PlanStep } from "@/modules/orchestration/plan";

const step = (over: Partial<PlanStep> = {}): PlanStep => ({ action: "create_task", title: "T", description: "", priority: "medium", risk: "low", ...over });
const CEO = ["ai.execute", "tasks.create", "tasks.delegate", "opportunities.create", "approvals.request"];

describe("decideStep", () => {
  it("executes low-risk permitted steps", () => expect(decideStep(step(), CEO, false).kind).toBe("execute"));
  it("escalates high and critical risk", () => {
    expect(decideStep(step({ risk: "high" }), CEO, false).kind).toBe("approval");
    expect(decideStep(step({ risk: "critical" }), CEO, false).kind).toBe("approval");
  });
  it("always escalates explicit approval requests", () => expect(decideStep(step({ action: "request_approval" }), CEO, false).kind).toBe("approval"));
  it("escalates missing permission", () => expect(decideStep(step({ action: "create_project" }), CEO, false)).toMatchObject({ kind: "approval" }));
  it("escalates delegation without tasks.delegate", () =>
    expect(decideStep(step(), ["tasks.create", "approvals.request"], true)).toMatchObject({ kind: "approval" }));
  it("denies when agent cannot even request approval", () => expect(decideStep(step({ risk: "high" }), ["tasks.create"], false).kind).toBe("deny"));
});

describe("checkAgentCanRun", () => {
  it("blocks suspended agents", () => expect(checkAgentCanRun({ status: "suspended" }, ["ai.execute"]).ok).toBe(false));
  it("requires ai.execute", () => expect(checkAgentCanRun({ status: "active" }, []).ok).toBe(false));
  it("allows active agents with permission", () => expect(checkAgentCanRun({ status: "active" }, ["ai.execute"]).ok).toBe(true));
});

describe("checkCostLimit", () => {
  it("limit 0 allows only free providers (fail-safe)", () => {
    expect(checkCostLimit(0, 0, true).ok).toBe(true);
    expect(checkCostLimit(0, 0, false).ok).toBe(false);
  });
  it("enforces positive monthly caps", () => {
    expect(checkCostLimit(100, 99.9, false).ok).toBe(true);
    expect(checkCostLimit(100, 100, false).ok).toBe(false);
  });
});

describe("checkTaskRunnable", () => {
  it("requires all dependencies done", () => {
    expect(checkTaskRunnable("todo", ["done", "todo"])).toEqual({ ok: false, reason: "1 dependency is not done" });
    expect(checkTaskRunnable("todo", ["done"]).ok).toBe(true);
  });
  it("rejects tasks already running or finished", () => {
    expect(checkTaskRunnable("in_progress", []).ok).toBe(false);
    expect(checkTaskRunnable("done", []).ok).toBe(false);
  });
  it("allows retrying failed tasks", () => expect(checkTaskRunnable("failed", []).ok).toBe(true));
});

it("monthStartIso is the UTC first of month", () => expect(monthStartIso(new Date("2026-11-17T10:00:00Z"))).toBe("2026-11-01T00:00:00.000Z"));
