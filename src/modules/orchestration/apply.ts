import "server-only";
import { must, UserFacingError } from "@/lib/utilities/action";
import { logEvent } from "@/modules/audit/service";
import type { AppContext } from "@/modules/auth/session";
import type { AgentWithPermissions, Kra } from "@/types/domain";
import { permissionsOf } from "./engine";
import { planStepSchema, type Plan, type PlanStep } from "./plan";
import { decideStep, resolveKra } from "./policy";

export interface StepOutcome {
  title: string;
  action: PlanStep["action"];
  outcome: "executed" | "approval" | "denied";
  detail: string;
  ref?: string;
}

const EXECUTABLE = new Set<PlanStep["action"]>(["create_project", "create_task", "create_opportunity"]);

export interface PlanContext {
  agents: AgentWithPermissions[];
  kras: Kra[];
}

function resolveAssignee(step: PlanStep, agents: AgentWithPermissions[], fallback: AgentWithPermissions) {
  const name = step.assignee?.toLowerCase();
  return (name && agents.find((a) => a.status === "active" && (a.name.toLowerCase() === name || a.designation.toLowerCase() === name))) || fallback;
}

/** Performs a single executable step. Called only after policy (or a Founder approval) allows it. */
export async function executeStep(ctx: AppContext, step: PlanStep, actor: AgentWithPermissions, assignee: { id: string; business_unit_id: string | null }, kraId: string | null): Promise<string> {
  const org = ctx.organisation.id;
  switch (step.action) {
    case "create_project":
      return must(await ctx.db.from("projects").insert({ organisation_id: org, name: step.title.slice(0, 120), description: step.description, owner_agent_id: assignee.id, business_unit_id: assignee.business_unit_id, kra_id: kraId }).select("id").single<{ id: string }>()).id;
    case "create_task":
      return must(await ctx.db.from("tasks").insert({ organisation_id: org, title: step.title, description: step.description, priority: step.priority, assigned_agent_id: assignee.id, kra_id: kraId, created_by: ctx.userId }).select("id").single<{ id: string }>()).id;
    case "create_opportunity":
      return must(await ctx.db.from("opportunities").insert({ organisation_id: org, title: step.title, summary: step.description, proposed_by_agent_id: actor.id, created_by: ctx.userId }).select("id").single<{ id: string }>()).id;
    default:
      throw new UserFacingError(`Action ${step.action} cannot be executed automatically`);
  }
}

/** Routes each plan step through governance: execute (optionally manager-reviewed), Founder approval, or deny. */
export async function applyPlan(ctx: AppContext, plan: Plan, actor: AgentWithPermissions, pc: PlanContext, executionId: string): Promise<StepOutcome[]> {
  const perms = permissionsOf(actor);
  const outcomes: StepOutcome[] = [];
  for (const step of plan.steps) {
    const assignee = step.action === "create_task" || step.action === "create_project" ? resolveAssignee(step, pc.agents, actor) : actor;
    const kra = resolveKra(step, assignee, pc.kras);
    const decision = decideStep(step, perms, assignee.id !== actor.id);
    const kraNote = kra ? ` · KRA: ${kra.name}` : "";
    try {
      if (decision.kind === "execute") {
        const ref = await executeStep(ctx, step, actor, assignee, kra?.id ?? null);
        let detail = `Assigned to ${assignee.name}${kraNote}`;
        if (decision.review === "manager") {
          // Mid-tier issue: resolved inside the team, visible to the manager — not sent to the Founder.
          const reviewer = pc.agents.find((a) => a.id === assignee.manager_id) ?? actor;
          await logEvent(ctx, { action: "escalation.manager_review", entity: step.action === "create_project" ? "projects" : step.action === "create_task" ? "tasks" : "opportunities", entityId: ref, actorType: "agent", metadata: { reviewer_agent_id: reviewer.id, risk: step.risk } });
          detail += ` · manager review: ${reviewer.name}`;
        }
        outcomes.push({ title: step.title, action: step.action, outcome: "executed", detail, ref });
      } else if (decision.kind === "approval") {
        const { id } = must(
          await ctx.db
            .from("approvals")
            .insert({
              organisation_id: ctx.organisation.id,
              title: step.title,
              action_type: step.approval_action ?? `plan.${step.action}`,
              risk: step.risk,
              payload: { step, assignee_id: assignee.id, kra_id: kra?.id ?? null, kra: kra?.name ?? null, source_execution_id: executionId, reason: decision.reason },
              requested_by_agent_id: actor.id,
              requested_by: ctx.userId,
            })
            .select("id")
            .single<{ id: string }>(),
        );
        outcomes.push({ title: step.title, action: step.action, outcome: "approval", detail: `${decision.reason}${kraNote}`, ref: id });
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

/** Executes the payload of an approved request (with optional Founder modifications), if it carries an executable step. */
export async function executeApprovedPayload(
  ctx: AppContext,
  payload: Record<string, unknown>,
  actor: AgentWithPermissions | null,
  agents: AgentWithPermissions[],
  overrides?: Partial<Pick<PlanStep, "title" | "description" | "priority">>,
): Promise<string | null> {
  const parsed = planStepSchema.safeParse({ ...(payload.step as object), ...overrides });
  if (!parsed.success || !EXECUTABLE.has(parsed.data.action) || !actor) return null; // decision recorded only
  const assignee = agents.find((a) => a.id === payload.assignee_id) ?? actor;
  const kraId = typeof payload.kra_id === "string" ? payload.kra_id : null;
  return executeStep(ctx, parsed.data, actor, assignee, kraId);
}
