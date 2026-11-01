"use server";

import { parseForm, commandSchema, idSchema } from "@/lib/validation/forms";
import { must, runAction, UserFacingError } from "@/lib/utilities/action";
import { requireContext } from "@/modules/auth/session";
import { logEvent } from "@/modules/audit/service";
import { applyPlan, type StepOutcome } from "@/modules/orchestration/apply";
import type { AppContext } from "@/modules/auth/session";
import { listAgents, loadAgentByTier, runAgent } from "@/modules/orchestration/engine";
import { parsePlan, PLAN_FORMAT_INSTRUCTIONS, planSchema } from "@/modules/orchestration/plan";
import type { Execution, Kra } from "@/types/domain";

const listKras = async (ctx: Awaited<ReturnType<typeof requireContext>>) =>
  (await ctx.db.from("kras").select("id, name, description, business_unit_id").eq("organisation_id", ctx.organisation.id).order("name").returns<Kra[]>()).data ?? [];

const backTo = (form: FormData) => (form.get("return_to") === "/ceo" ? "/ceo" : "/command");

/** Claims a plan exactly once and runs every step through governance. */
async function applyOnce(ctx: AppContext, exec: Execution): Promise<StepOutcome[] | null> {
  const plan = planSchema.safeParse(exec.plan);
  if (exec.status !== "succeeded" || exec.kind !== "command" || !plan.success) throw new UserFacingError("This execution has no executable plan");
  const claimed = await ctx.db.from("agent_executions")
    .update({ plan: { ...plan.data, applied_at: new Date().toISOString(), applied_by: ctx.userId } })
    .eq("id", exec.id).eq("organisation_id", ctx.organisation.id).is("plan->>applied_at", null).select("id");
  if (!claimed.data?.length) return null;
  const [ceo, agents, kras] = await Promise.all([loadAgentByTier(ctx, "ceo"), listAgents(ctx), listKras(ctx)]);
  const actor = agents.find((a) => a.id === exec.agent_id) ?? ceo;
  if (!actor) throw new UserFacingError("Planning agent no longer exists");
  const outcomes = await applyPlan(ctx, plan.data, actor, { agents, kras }, exec.id);
  await ctx.db.from("agent_executions").update({ plan: { ...plan.data, applied_at: new Date().toISOString(), applied_by: ctx.userId, outcomes } }).eq("id", exec.id).eq("organisation_id", ctx.organisation.id);
  await logEvent(ctx, { action: "command.plan_executed", entity: "agent_executions", entityId: exec.id, metadata: { outcomes } });
  return outcomes;
}

const describe = (o: StepOutcome[]) => {
  const n = (k: string) => o.filter((x) => x.outcome === k).length;
  return `${n("executed")} set up${n("approval") ? `, ${n("approval")} waiting for your approval` : ""}${n("denied") ? `, ${n("denied")} blocked` : ""}`;
};

/** Founder instruction → Atlas plans → safe steps are executed immediately (risky ones go to Approvals). */
export async function issueCommandAction(form: FormData) {
  await runAction(backTo(form), "Done", async () => {
    const ctx = await requireContext("operate");
    const { command } = parseForm(commandSchema, form);
    const ceo = await loadAgentByTier(ctx, "ceo");
    if (!ceo) throw new UserFacingError("No CEO agent exists. Create an agent with tier CEO in the Agent Registry.");
    const [agents, kras] = await Promise.all([listAgents(ctx), listKras(ctx)]);
    const roster = agents.filter((a) => a.status === "active").map((a) => `${a.name} (${a.designation})`).join(", ");
    await logEvent(ctx, { action: "command.issued", entity: "command", metadata: { command } });
    const { execution } = await runAgent(ctx, {
      agent: ceo, kind: "command", json: true, maxTokens: 2500,
      input: `Founder instruction: ${command}\n\nAvailable AI employees: ${roster}\nKRAs: ${kras.map((k) => k.name).join(", ")}\n\n${PLAN_FORMAT_INSTRUCTIONS}`,
      parse: parsePlan,
    });
    if (execution.status === "failed") throw new UserFacingError(`Atlas could not plan this: ${execution.error}`);
    const outcomes = await applyOnce(ctx, execution);
    return outcomes ? `Atlas: ${describe(outcomes)}. Press "Start work" to let the team begin.` : "Plan ready";
  });
}

/** Manual execution for older plans that were generated before auto-execution. */
export async function executePlanAction(form: FormData) {
  await runAction(backTo(form), "Plan executed", async () => {
    const ctx = await requireContext("operate");
    const { id } = parseForm(idSchema, form);
    const exec = must(await ctx.db.from("agent_executions").select("*").eq("id", id).single<Execution>());
    const outcomes = await applyOnce(ctx, exec);
    if (!outcomes) throw new UserFacingError("This plan has already been executed");
    return `Plan executed: ${describe(outcomes)}`;
  });
}
