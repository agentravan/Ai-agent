import "server-only";
import { UserFacingError } from "@/lib/utilities/action";
import { logEvent } from "@/modules/audit/service";
import type { AppContext } from "@/modules/auth/session";
import type { Execution, Kra } from "@/types/domain";
import { applyPlan, type StepOutcome } from "./apply";
import { companySnapshot, listAgents, loadAgentByTier } from "./engine";
import { planSchema } from "./plan";

export const listKras = async (ctx: AppContext): Promise<Kra[]> =>
  (await ctx.db.from("kras").select("id, name, description, business_unit_id").eq("organisation_id", ctx.organisation.id).order("name").returns<Kra[]>()).data ?? [];

/** Claims a plan exactly once (atomic on plan.applied_at) and runs every step through governance. Null = already applied. */
export async function applyPlanOnce(ctx: AppContext, exec: Execution): Promise<StepOutcome[] | null> {
  const plan = planSchema.safeParse(exec.plan);
  if (exec.status !== "succeeded" || exec.kind !== "command" || !plan.success) throw new UserFacingError("This execution has no executable plan");
  const claimed = await ctx.db.from("agent_executions")
    .update({ plan: { ...plan.data, applied_at: new Date().toISOString(), applied_by: ctx.userId } })
    .eq("id", exec.id).eq("organisation_id", ctx.organisation.id).is("plan->>applied_at", null).select("id");
  if (!claimed.data?.length) return null;
  const [ceo, agents, kras, company] = await Promise.all([loadAgentByTier(ctx, "ceo"), listAgents(ctx), listKras(ctx), companySnapshot(ctx)]);
  const actor = agents.find((a) => a.id === exec.agent_id) ?? ceo;
  if (!actor) throw new UserFacingError("Planning agent no longer exists");
  const outcomes = await applyPlan(ctx, plan.data, actor, { agents, kras, netProfitCents: company.netProfitCents, upgradeGateCents: company.gateCents }, exec.id);
  await ctx.db.from("agent_executions").update({ plan: { ...plan.data, applied_at: new Date().toISOString(), applied_by: ctx.userId, outcomes } }).eq("id", exec.id).eq("organisation_id", ctx.organisation.id);
  await logEvent(ctx, { action: "command.plan_executed", entity: "agent_executions", entityId: exec.id, metadata: { outcomes } });
  return outcomes;
}

export const describeOutcomes = (o: StepOutcome[]) => {
  const n = (k: string) => o.filter((x) => x.outcome === k).length;
  return `${n("executed")} set up${n("approval") ? `, ${n("approval")} waiting for your approval` : ""}${n("denied") ? `, ${n("denied")} blocked` : ""}`;
};
