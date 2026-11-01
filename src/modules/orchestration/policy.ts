import { agentHas, type AgentPermission } from "@/lib/permissions";
import type { Agent, TaskStatus } from "@/types/domain";
import type { PlanAction, PlanStep } from "./plan";

/** Pure governance rules for autonomous agents. No I/O: fully unit-tested. */

export const STEP_PERMISSION: Record<PlanAction, AgentPermission> = {
  create_project: "projects.create",
  create_task: "tasks.create",
  create_opportunity: "opportunities.create",
  request_approval: "approvals.request",
};

export type StepDecision =
  | { kind: "execute" }
  | { kind: "approval"; reason: string }
  | { kind: "deny"; reason: string };

export function decideStep(step: PlanStep, permissions: readonly string[], delegating: boolean): StepDecision {
  const canRequest = agentHas(permissions, "approvals.request");
  const escalate = (reason: string): StepDecision =>
    canRequest ? { kind: "approval", reason } : { kind: "deny", reason: `${reason}; agent cannot request approval` };

  if (step.action === "request_approval") return escalate("Explicit approval request");
  if (step.risk === "high" || step.risk === "critical") return escalate(`Risk level ${step.risk} requires founder approval`);
  if (!agentHas(permissions, STEP_PERMISSION[step.action])) return escalate(`Agent lacks "${STEP_PERMISSION[step.action]}"`);
  if (delegating && !agentHas(permissions, "tasks.delegate")) return escalate('Agent lacks "tasks.delegate"');
  return { kind: "execute" };
}

export type RunCheck = { ok: true } | { ok: false; reason: string };

export function checkAgentCanRun(agent: Pick<Agent, "status">, permissions: readonly string[]): RunCheck {
  if (agent.status !== "active") return { ok: false, reason: "Agent is suspended" };
  if (!agentHas(permissions, "ai.execute")) return { ok: false, reason: 'Agent lacks "ai.execute" permission' };
  return { ok: true };
}

/**
 * Cost guard. limit 0 = "free providers only" (fail-safe: paid usage needs an explicit budget).
 * limit > 0 = monthly cap in cents, checked before each run.
 */
export function checkCostLimit(limitCents: number, spentCents: number, providerIsFree: boolean): RunCheck {
  if (limitCents === 0) return providerIsFree ? { ok: true } : { ok: false, reason: "Paid AI usage requires a monthly cost limit on this agent" };
  if (spentCents >= limitCents) return { ok: false, reason: `Monthly cost limit reached (${spentCents.toFixed(2)}¢ of ${limitCents}¢)` };
  return { ok: true };
}

const RUNNABLE: readonly TaskStatus[] = ["todo", "blocked", "failed"];

export function checkTaskRunnable(status: TaskStatus, dependencyStatuses: readonly TaskStatus[]): RunCheck {
  if (!RUNNABLE.includes(status)) return { ok: false, reason: `Task is ${status.replace("_", " ")}` };
  const open = dependencyStatuses.filter((s) => s !== "done").length;
  if (open) return { ok: false, reason: `${open} dependenc${open === 1 ? "y is" : "ies are"} not done` };
  return { ok: true };
}

export function monthStartIso(now = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

export const STALE_EXECUTION_MS = 10 * 60_000;
