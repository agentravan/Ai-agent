"use server";

import { parseForm, promptSchema } from "@/lib/validation/forms";
import { runAction, UserFacingError } from "@/lib/utilities/action";
import { requireContext } from "@/modules/auth/session";
import { loadAgent, runAgent } from "@/modules/orchestration/engine";

/** Founder ↔ executive communication. Each exchange is a persisted, audited execution. */
export async function messageExecutiveAction(form: FormData) {
  const path = String(form.get("return_to") ?? "") === "/coo" ? "/coo" : "/ceo";
  await runAction(path, "Response received", async () => {
    const ctx = await requireContext("operate");
    const { agent_id, prompt } = parseForm(promptSchema, form);
    const agent = await loadAgent(ctx, agent_id);
    const { execution } = await runAgent(ctx, { agent, kind: "chat", input: prompt });
    if (execution.status === "failed") throw new UserFacingError(`${agent.name} could not respond: ${execution.error}`);
  });
}

/** Executive report grounded in live organisation data (no invented numbers). */
export async function executiveReportAction(form: FormData) {
  const path = String(form.get("return_to") ?? "") === "/coo" ? "/coo" : "/ceo";
  await runAction(path, "Report generated", async () => {
    const ctx = await requireContext("operate");
    const { agent_id } = parseForm(promptSchema.pick({ agent_id: true }), form);
    const agent = await loadAgent(ctx, agent_id);
    const count = async (table: string, col?: string, val?: string) => {
      let q = ctx.db.from(table).select("*", { count: "exact", head: true });
      if (col && val) q = q.eq(col, val);
      return (await q).count ?? 0;
    };
    const [projects, active, todo, done, failed, pending, opps] = await Promise.all([
      count("projects"), count("projects", "status", "active"), count("tasks", "status", "todo"),
      count("tasks", "status", "done"), count("tasks", "status", "failed"), count("approvals", "status", "pending"), count("opportunities"),
    ]);
    const facts = `Organisation: ${ctx.organisation.name}\nProjects: ${projects} (${active} active)\nTasks: ${todo} to do, ${done} done, ${failed} failed\nPending approvals: ${pending}\nOpportunities: ${opps}`;
    const { execution } = await runAgent(ctx, {
      agent,
      kind: "chat",
      input: `Write a concise executive report for the founder using ONLY these facts. Do not invent figures.\n\n${facts}\n\nSections: Summary, Risks, Recommended next actions (max 5).`,
    });
    if (execution.status === "failed") throw new UserFacingError(`Report failed: ${execution.error}`);
  });
}
