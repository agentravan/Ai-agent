"use server";

import { parseForm, commandSchema, idSchema } from "@/lib/validation/forms";
import { must, runAction, UserFacingError } from "@/lib/utilities/action";
import { requireContext } from "@/modules/auth/session";
import { logEvent } from "@/modules/audit/service";
import { applyPlan } from "@/modules/orchestration/apply";
import { listAgents, loadAgentByTier, runAgent } from "@/modules/orchestration/engine";
import { parsePlan, PLAN_FORMAT_INSTRUCTIONS, planSchema } from "@/modules/orchestration/plan";
import type { Execution } from "@/types/domain";

const PATH = "/command";

/** Natural-language command → CEO produces a validated structured plan (nothing executes yet). */
export async function issueCommandAction(form: FormData) {
  await runAction(PATH, "Plan generated — review and execute below", async () => {
    const ctx = await requireContext("operate");
    const { command } = parseForm(commandSchema, form);
    const ceo = await loadAgentByTier(ctx, "ceo");
    if (!ceo) throw new UserFacingError("No CEO agent exists. Create an agent with tier CEO in the Workforce registry.");
    const agents = await listAgents(ctx);
    const roster = agents.filter((a) => a.status === "active").map((a) => `${a.name} (${a.designation})`).join(", ");
    await logEvent(ctx, { action: "command.issued", entity: "command", metadata: { command } });
    const { execution } = await runAgent(ctx, {
      agent: ceo,
      kind: "command",
      json: true,
      input: `Founder command: ${command}\n\nAvailable agents: ${roster}\n\n${PLAN_FORMAT_INSTRUCTIONS}`,
      parse: parsePlan,
    });
    if (execution.status === "failed") throw new UserFacingError(`Planning failed: ${execution.error}`);
  });
}

/** Executes a generated plan exactly once, with per-step governance. */
export async function executePlanAction(form: FormData) {
  await runAction(PATH, "Plan executed", async () => {
    const ctx = await requireContext("operate");
    const { id } = parseForm(idSchema, form);
    const exec = must(await ctx.db.from("agent_executions").select("*").eq("id", id).single<Execution>());
    const plan = planSchema.safeParse(exec.plan);
    if (exec.status !== "succeeded" || exec.kind !== "command" || !plan.success) throw new UserFacingError("This execution has no executable plan");

    // Atomic claim: only one request can flip applied_at from null.
    const claimed = await ctx.db
      .from("agent_executions")
      .update({ plan: { ...plan.data, applied_at: new Date().toISOString(), applied_by: ctx.userId } })
      .eq("id", id)
      .is("plan->>applied_at", null)
      .select("id");
    if (!claimed.data?.length) throw new UserFacingError("This plan has already been executed");

    const [ceo, agents] = await Promise.all([loadAgentByTier(ctx, "ceo"), listAgents(ctx)]);
    const actor = agents.find((a) => a.id === exec.agent_id) ?? ceo;
    if (!actor) throw new UserFacingError("Planning agent no longer exists");
    const outcomes = await applyPlan(ctx, plan.data, actor, agents, id);

    await ctx.db.from("agent_executions").update({ plan: { ...plan.data, applied_at: new Date().toISOString(), applied_by: ctx.userId, outcomes } }).eq("id", id);
    await logEvent(ctx, { action: "command.plan_executed", entity: "agent_executions", entityId: id, metadata: { outcomes } });
    const count = (k: string) => outcomes.filter((o) => o.outcome === k).length;
    return `Plan executed: ${count("executed")} done, ${count("approval")} sent for approval, ${count("denied")} denied`;
  });
}
