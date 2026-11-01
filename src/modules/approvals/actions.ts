"use server";

import { decisionSchema, parseForm } from "@/lib/validation/forms";
import { must, runAction, UserFacingError } from "@/lib/utilities/action";
import { requireContext } from "@/modules/auth/session";
import { logEvent } from "@/modules/audit/service";
import { executeApprovedPayload } from "@/modules/orchestration/apply";
import { loadAgent } from "@/modules/orchestration/engine";
import type { Approval } from "@/types/domain";

export async function decideApprovalAction(form: FormData) {
  await runAction("/approvals", "Decision recorded", async () => {
    const ctx = await requireContext("govern");
    const { id, decision, note } = parseForm(decisionSchema, form);

    // Conditional update on status=pending makes double-decisions impossible (DB trigger also enforces it).
    const { data } = await ctx.db
      .from("approvals")
      .update({ status: decision, decided_by: ctx.userId, decided_at: new Date().toISOString(), decision_note: note || null })
      .eq("id", id)
      .eq("status", "pending")
      .select("*")
      .returns<Approval[]>();
    const approval = data?.[0];
    if (!approval) throw new UserFacingError("Approval not found or already decided");

    let ref: string | null = null;
    if (decision === "approved") {
      const actor = approval.requested_by_agent_id ? await loadAgent(ctx, approval.requested_by_agent_id).catch(() => null) : null;
      try {
        ref = await executeApprovedPayload(ctx, approval.payload, actor);
      } catch (err) {
        await logEvent(ctx, { action: "approval.execution_failed", entity: "approvals", entityId: id, metadata: { error: (err as Error).message } });
        throw new UserFacingError(`Approved, but executing the action failed: ${(err as Error).message}`);
      }
    }
    await logEvent(ctx, { action: `approval.${decision}`, entity: "approvals", entityId: id, metadata: { action_type: approval.action_type, executed_ref: ref } });
    return decision === "approved" ? (ref ? "Approved and executed" : "Approved (decision recorded)") : "Rejected";
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
