"use server";

import { decisionSchema, parseForm } from "@/lib/validation/forms";
import { must, runAction, UserFacingError } from "@/lib/utilities/action";
import { requireContext } from "@/modules/auth/session";
import { logEvent } from "@/modules/audit/service";
import { executeApprovedPayload } from "@/modules/orchestration/apply";
import { listAgents } from "@/modules/orchestration/engine";
import type { Approval } from "@/types/domain";
import { lessonFromDecision } from "@/modules/learning/logic";

export async function decideApprovalAction(form: FormData) {
  const back = form.get("return_to") === "/dashboard" ? "/dashboard" : "/approvals";
  await runAction(back, "Decision recorded", async () => {
    const ctx = await requireContext("govern");
    const { id, decision, note, title, description, priority } = parseForm(decisionSchema, form);
    const modified = decision === "modified";
    const overrides = modified ? Object.fromEntries(Object.entries({ title, description, priority }).filter(([, v]) => v)) : undefined;
    const status = decision === "rejected" ? "rejected" : "approved";
    const decisionNote = modified ? `Modified by Founder${note ? `: ${note}` : ""}` : note || null;

    // Conditional update on status=pending makes double-decisions impossible (DB trigger also enforces it).
    const { data } = await ctx.db
      .from("approvals")
      .update({ status, decided_by: ctx.userId, decided_at: new Date().toISOString(), decision_note: decisionNote })
      .eq("id", id)
      .eq("status", "pending")
      .select("*")
      .returns<Approval[]>();
    const approval = data?.[0];
    if (!approval) throw new UserFacingError("Approval not found or already decided");

    let ref: string | null = null;
    if (status === "approved") {
      const agents = await listAgents(ctx);
      const actor = agents.find((a) => a.id === approval.requested_by_agent_id) ?? null;
      try {
        ref = await executeApprovedPayload(ctx, approval.payload, actor, agents, overrides);
      } catch (err) {
        await logEvent(ctx, { action: "approval.execution_failed", entity: "approvals", entityId: id, metadata: { error: (err as Error).message } });
        throw new UserFacingError(`Approved, but executing the action failed: ${(err as Error).message}`);
      }
    }
    // Self-learning: the agent that asked remembers what the Founder decided, so it proposes better next time.
    const lesson = approval.requested_by_agent_id ? lessonFromDecision({ title: approval.title, action_type: approval.action_type, status, modified, note: note || null }) : null;
    if (lesson) {
      const { error: memErr } = await ctx.db.from("agent_memories").insert({ organisation_id: ctx.organisation.id, agent_id: approval.requested_by_agent_id, kind: "decision", ...lesson });
      if (memErr) console.warn("[learning] lesson not saved", memErr.message);
    }
    await logEvent(ctx, { action: `approval.${status}`, entity: "approvals", entityId: id, metadata: { action_type: approval.action_type, executed_ref: ref, modified, overrides } });
    if (status === "rejected") return "Rejected";
    return `${modified ? "Modified and approved" : "Approved"}${ref ? " — executed" : " (decision recorded)"}`;
  });
}

export async function requestApprovalAction(form: FormData) {
  await runAction("/approvals", "Approval requested", async () => {
    const ctx = await requireContext("operate");
    const title = String(form.get("title") ?? "").trim().slice(0, 200);
    const action_type = String(form.get("action_type") ?? "").trim();
    if (!title || !/^[a-z_]+\.[a-z_]+$/.test(action_type)) throw new UserFacingError("Title and an action type like finance.spend are required");
    must(await ctx.db.from("approvals").insert({ organisation_id: ctx.organisation.id, title, action_type, requested_by: ctx.userId, payload: { details: String(form.get("details") ?? "").slice(0, 2000) } }).select("id").single());
  });
}
