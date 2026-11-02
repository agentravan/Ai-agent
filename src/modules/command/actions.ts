"use server";

import { parseForm, commandSchema, idSchema } from "@/lib/validation/forms";
import { must, runAction, UserFacingError } from "@/lib/utilities/action";
import { requireContext } from "@/modules/auth/session";
import { logEvent } from "@/modules/audit/service";
import { applyPlanOnce, describeOutcomes, listKras } from "@/modules/orchestration/apply-once";
import { listAgents, loadAgentByTier, runAgent } from "@/modules/orchestration/engine";
import { parsePlan, PLAN_FORMAT_INSTRUCTIONS } from "@/modules/orchestration/plan";
import type { Execution } from "@/types/domain";

const backTo = (form: FormData) => (form.get("return_to") === "/ceo" ? "/ceo" : "/command");
const applyOnce = applyPlanOnce;
const describe = describeOutcomes;

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
