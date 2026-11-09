"use server";

import { redirect, unstable_rethrow } from "next/navigation";
import { z } from "zod";
import { AiError, AiUnavailableError } from "@/lib/ai/types";
import { PermissionError } from "@/lib/permissions";
import { must, runAction, UserFacingError } from "@/lib/utilities/action";
import { parseForm, ValidationError } from "@/lib/validation/forms";
import { logEvent } from "@/modules/audit/service";
import { requireContext } from "@/modules/auth/session";
import { advanceDesign, approveDesign, backToBrief, decideFinding, reviseDraft, saveBrief, saveDraft, sendToReview, startDraft } from "./service";

const createSchema = z.object({
  title: z.string().trim().min(3, "Give the project a short name").max(160),
  idea: z.string().trim().min(5, "Describe the idea (at least a few words)").max(4000),
});
const idSchema = z.object({ id: z.uuid() });
const briefSchema = idSchema.extend({ brief: z.string().trim().min(20, "The brief is too short").max(20000) });
const draftSchema = idSchema.extend({ draft: z.string().trim().min(50, "The draft is too short").max(60000) });
const decideSchema = idSchema.extend({ finding: z.uuid(), decision: z.enum(["open", "fix", "skip"]) });
const reviseSchema = idSchema.extend({ notes: z.string().trim().max(2000).optional().default("") });

const back = (form: FormData) => {
  const id = String(form.get("id") ?? "");
  return z.uuid().safeParse(id).success ? `/design/${id}` : "/design";
};

/** Opens a new design and walks the Founder into it. */
export async function createDesignAction(form: FormData) {
  let id = "";
  try {
    const ctx = await requireContext("operate");
    const c = parseForm(createSchema, form);
    id = must(await ctx.db.from("design_docs").insert({ organisation_id: ctx.organisation.id, title: c.title, idea: c.idea, created_by: ctx.userId }).select("id").single<{ id: string }>()).id;
    await logEvent(ctx, { action: "design.created", entity: "design_docs", entityId: id, metadata: { title: c.title } });
  } catch (err) {
    unstable_rethrow(err);
    const known = err instanceof UserFacingError || err instanceof ValidationError || err instanceof PermissionError;
    if (!known) console.error("[design]", err);
    redirect(`/design?error=${encodeURIComponent(known ? (err as Error).message : "Could not start the design")}`);
  }
  redirect(`/design/${id}`);
}

/** Runs the next AI step (called in a loop by the page's runner). */
export async function advanceDesignAction(id: string): Promise<{ ok: true; more: boolean; step: string | null } | { ok: false; error: string }> {
  try {
    const ctx = await requireContext("operate");
    const { more, step } = await advanceDesign(ctx, z.uuid().parse(id));
    return { ok: true, more, step };
  } catch (err) {
    const known = err instanceof UserFacingError || err instanceof AiError || err instanceof AiUnavailableError || err instanceof PermissionError;
    if (!known) console.error("[design]", err);
    return { ok: false, error: known ? (err as Error).message : "Design Studio could not continue — try again" };
  }
}

export async function saveBriefAction(form: FormData) {
  await runAction(back(form), "Brief saved — the goldfish will challenge the new text", async () => {
    const ctx = await requireContext("operate");
    const c = parseForm(briefSchema, form);
    await saveBrief(ctx, c.id, c.brief);
  });
}

export async function startDraftAction(form: FormData) {
  await runAction(back(form), "Brief approved — Gaja is writing the draft", async () => {
    const ctx = await requireContext("operate");
    await startDraft(ctx, parseForm(idSchema, form).id);
  });
}

export async function saveDraftAction(form: FormData) {
  await runAction(back(form), "Draft saved", async () => {
    const ctx = await requireContext("operate");
    const c = parseForm(draftSchema, form);
    await saveDraft(ctx, c.id, c.draft);
  });
}

export async function backToBriefAction(form: FormData) {
  await runAction(back(form), "Back to the brief — the draft will be rewritten from it", async () => {
    const ctx = await requireContext("operate");
    await backToBrief(ctx, parseForm(idSchema, form).id);
  });
}

export async function sendToReviewAction(form: FormData) {
  await runAction(back(form), "Sent to the goldfish — four fresh reviewers are reading it", async () => {
    const ctx = await requireContext("operate");
    await sendToReview(ctx, parseForm(idSchema, form).id);
  });
}

export async function decideFindingAction(form: FormData) {
  await runAction(back(form), "Saved", async () => {
    const ctx = await requireContext("operate");
    const c = parseForm(decideSchema, form);
    await decideFinding(ctx, c.id, c.finding, c.decision);
  });
}

export async function reviseDraftAction(form: FormData) {
  await runAction(back(form), "Draft revised", async () => {
    const ctx = await requireContext("operate");
    const c = parseForm(reviseSchema, form);
    return reviseDraft(ctx, c.id, c.notes);
  });
}

export async function approveDesignAction(form: FormData) {
  await runAction(back(form), "Design approved", async () => {
    const ctx = await requireContext("govern");
    return approveDesign(ctx, parseForm(idSchema, form).id);
  });
}
