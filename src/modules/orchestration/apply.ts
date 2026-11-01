import "server-only";
import { must, UserFacingError } from "@/lib/utilities/action";
import type { AppContext } from "@/modules/auth/session";
import type { AgentWithPermissions } from "@/types/domain";
import { permissionsOf } from "./engine";
import { planStepSchema, type Plan, type PlanStep } from "./plan";
import { decideStep } from "./policy";

export interface StepOutcome {
  title: string;
  action: PlanStep["action"];
  outcome: "executed" | "approval" | "denied";
  detail: string;
  ref?: string;
}

const EXECUTABLE = new Set<PlanStep["action"]>(["create_project", "create_task", "create_opportunity"]);

function resolveAssignee(step: PlanStep, agents: AgentWithPermissions[], fallback: AgentWithPermissions) {
  const name = step.assignee?.toLowerCase();
  return (name && agents.find((a) => a.status === "active" && (a.name.toLowerCase() === name || a.designation.toLowerCase() === name))) || fallback;
}

/** Performs a single executable step. Called only after policy (or a founder approval) allows it. */
export async function executeStep(ctx: AppContext, step: PlanStep, actor: AgentWithPermissions, assigneeId: string | null): Promise<string> {
  const org = ctx.organisation.id;
  switch (step.action) {
    case "create_project":
      return must(await ctx.db.from("projects").insert({ organisation_id: org, name: step.title.slice(0, 120), description: step.description, owner_agent_id: assigneeId ?? actor.id }).select("id").single<{ id: string }>()).id;
    case "create_task":
      return must(await ctx.db.from("tasks").insert({ organisation_id: org, title: step.title, description: step.description, priority: step.priority, assigned_agent_id: assigneeId, created_by: ctx.userId }).select("id").single<{ id: string }>()).id;
    case "create_opportunity":
      return must(await ctx.db.from("opportunities").insert({ organisation_id: org, title: step.title, summary: step.description, proposed_by_agent_id: actor.id, created_by: ctx.userId }).select("id").single<{ id: string }>()).id;
    default:
      throw new UserFacingError(`Action ${step.action} cannot be executed automatically`);
  }
}

/** Routes each plan step through agent governance: execute, escalate to approval, or deny. */
export async function applyPlan(ctx: AppContext, plan: Plan, actor: AgentWithPermissions, agents: AgentWithPermissions[], executionId: string): Promise<StepOutcome[]> {
  const perms = permissionsOf(actor);
  const outcomes: StepOutcome[] = [];
  for (const step of plan.steps) {
    const assignee = step.action === "create_task" || step.action === "create_project" ? resolveAssignee(step, agents, actor) : actor;
    const decision = decideStep(step, perms, assignee.id !== actor.id);
    try {
      if (decision.kind === "execute") {
        const ref = await executeStep(ctx, step, actor, assignee.id);
        outcomes.push({ title: step.title, action: step.action, outcome: "executed", detail: `Assigned to ${assignee.name}`, ref });
      } else if (decision.kind === "approval") {
        const { id } = must(
          await ctx.db
            .from("approvals")
            .insert({
              organisation_id: ctx.organisation.id,
              title: step.title,
              action_type: step.approval_action ?? `plan.${step.action}`,
              risk: step.risk,
              payload: { step, assignee_id: assignee.id, source_execution_id: executionId, reason: decision.reason },
              requested_by_agent_id: actor.id,
              requested_by: ctx.userId,
            })
            .select("id")
            .single<{ id: string }>(),
        );
        outcomes.push({ title: step.title, action: step.action, outcome: "approval", detail: decision.reason, ref: id });
      } else {
        outcomes.push({ title: step.title, action: step.action, outcome: "denied", detail: decision.reason });
      }
    } catch (err) {
      // One failing step must not abort the rest of the plan.
      outcomes.push({ title: step.title, action: step.action, outcome: "denied", detail: `Failed: ${(err as Error).message}` });
    }
  }
  return outcomes;
}

/** Executes the payload of an approved request, if it carries an executable plan step. */
export async function executeApprovedPayload(ctx: AppContext, payload: Record<string, unknown>, actor: AgentWithPermissions | null): Promise<string | null> {
  const parsed = planStepSchema.safeParse(payload.step);
  if (!parsed.success || !EXECUTABLE.has(parsed.data.action) || !actor) return null; // decision recorded only
  const assigneeId = typeof payload.assignee_id === "string" ? payload.assignee_id : actor.id;
  return executeStep(ctx, parsed.data, actor, assigneeId);
}
