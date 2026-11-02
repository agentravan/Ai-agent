"use server";

import { redirect, unstable_rethrow } from "next/navigation";
import { z } from "zod";
import { AiError, AiUnavailableError } from "@/lib/ai/types";
import { PermissionError } from "@/lib/permissions";
import { must, runAction, UserFacingError } from "@/lib/utilities/action";
import { parseForm, ValidationError } from "@/lib/validation/forms";
import { logEvent } from "@/modules/audit/service";
import { requireContext } from "@/modules/auth/session";
import { adoptVerdict, advanceTrial, type Trial } from "./service";

const fileSchema = z.object({
  idea: z.string().trim().min(5, "Describe the idea (at least a few words)").max(2000),
  proposed_by: z.string().trim().max(120).optional(),
  meeting_id: z.preprocess((v) => (v === "" || v == null ? null : v), z.uuid().nullable()).optional(),
});

/** Files a case and walks the Founder into the courtroom. */
export async function fileCaseAction(form: FormData) {
  let id = "";
  try {
    const ctx = await requireContext("operate");
    const c = parseForm(fileSchema, form);
    const row = must(await ctx.db.from("idea_trials").insert({
      organisation_id: ctx.organisation.id, idea: c.idea, proposed_by: c.proposed_by || null, meeting_id: c.meeting_id ?? null, created_by: ctx.userId,
    }).select("id").single<{ id: string }>());
    id = row.id;
    await logEvent(ctx, { action: "court.case_filed", entity: "idea_trials", entityId: id, metadata: { proposed_by: c.proposed_by ?? null } });
  } catch (err) {
    unstable_rethrow(err);
    const known = err instanceof UserFacingError || err instanceof ValidationError || err instanceof PermissionError;
    if (!known) console.error("[court]", err);
    redirect(`/court?error=${encodeURIComponent(known ? (err as Error).message : "Could not file the case")}`);
  }
  redirect(`/court/${id}`);
}

/** Runs the next stage of the trial (called by the courtroom while it plays). */
export async function advanceTrialAction(id: string): Promise<{ ok: true; trial: Trial } | { ok: false; error: string }> {
  try {
    const ctx = await requireContext("operate");
    return { ok: true, trial: await advanceTrial(ctx, z.uuid().parse(id)) };
  } catch (err) {
    const msg = err instanceof Error && (err instanceof AiError || err instanceof AiUnavailableError || err.message.startsWith("The court")) ? err.message : "The court could not continue — try again";
    if (!(err instanceof AiError)) console.error("[court]", err);
    return { ok: false, error: msg };
  }
}

export async function adoptVerdictAction(form: FormData) {
  const id = String(form.get("id") ?? "");
  await runAction(z.uuid().safeParse(id).success ? `/court/${id}` : "/court", "Verdict adopted", async () => {
    const ctx = await requireContext("govern");
    try {
      return await adoptVerdict(ctx, z.uuid().parse(id));
    } catch (err) {
      throw err instanceof Error ? new UserFacingError(err.message) : err;
    }
  });
}

/** Opens a trial from inside a live meeting (the verdict is recorded back into that meeting). */
export async function trialFromMeetingAction(meetingId: string, idea: string, proposedBy: string | null): Promise<{ ok: true; trial: Trial } | { ok: false; error: string }> {
  try {
    const ctx = await requireContext("operate");
    const c = fileSchema.parse({ idea, proposed_by: proposedBy ?? undefined, meeting_id: meetingId });
    const { data, error } = await ctx.db.from("idea_trials").insert({
      organisation_id: ctx.organisation.id, idea: c.idea, proposed_by: c.proposed_by || null, meeting_id: c.meeting_id ?? null, created_by: ctx.userId,
    }).select("*").single<Trial>();
    if (error || !data) throw new UserFacingError("Could not open the court");
    await logEvent(ctx, { action: "court.case_filed", entity: "idea_trials", entityId: data.id, metadata: { meeting_id: meetingId } });
    return { ok: true, trial: data };
  } catch (err) {
    return { ok: false, error: err instanceof z.ZodError ? ((err as z.ZodError).issues[0]?.message ?? "Invalid idea") : err instanceof UserFacingError ? err.message : "Could not open the court" };
  }
}
