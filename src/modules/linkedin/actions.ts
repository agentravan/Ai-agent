"use server";

import { z } from "zod";
import { agentHas } from "@/lib/permissions";
import { parseForm } from "@/lib/validation/forms";
import { must, runAction, UserFacingError } from "@/lib/utilities/action";
import { requireContext, type AppContext } from "@/modules/auth/session";
import { logEvent } from "@/modules/audit/service";
import { listAgents, permissionsOf, runAgent } from "@/modules/orchestration/engine";
import { LINKEDIN_KINDS } from "@/types/domain";
import { buildPrompt, cleanDraft, KIND_LABEL } from "./logic";

const PATH = "/linkedin";
const draftSchema = z.object({
  kind: z.enum(LINKEDIN_KINDS),
  brief: z.string().trim().min(3, "Tell the AI what to write about").max(2000),
  context: z.string().trim().max(4000).optional(),
});
const idSchema = z.object({ id: z.uuid() });

/** The content writer: a hired LinkedIn specialist if present, else Iris, else Nova — must hold content.draft. */
async function pickWriter(ctx: AppContext) {
  const agents = (await listAgents(ctx)).filter((a) => a.status === "active" && agentHas(permissionsOf(a), "content.draft"));
  const writer = agents.find((a) => a.template_slug === "marketing/marketing-linkedin-content-creator") ?? agents.find((a) => a.name === "Iris") ?? agents.find((a) => a.name === "Nova") ?? agents[0];
  if (!writer) throw new UserFacingError("No active agent has the \"content.draft\" permission. Grant it to Iris (or your LinkedIn Content Creator) in the Agent Registry.");
  return writer;
}

export async function draftAction(form: FormData) {
  await runAction(PATH, "Draft ready", async () => {
    const ctx = await requireContext("operate");
    const { kind, brief, context } = parseForm(draftSchema, form);
    if (kind !== "post" && !context) throw new UserFacingError("Paste the comment or message you are replying to");
    const [writer, { data: recent }] = await Promise.all([
      pickWriter(ctx),
      kind === "post"
        ? ctx.db.from("linkedin_drafts").select("body").eq("organisation_id", ctx.organisation.id).eq("kind", "post").eq("status", "posted").order("posted_at", { ascending: false }).limit(5).returns<{ body: string | null }[]>()
        : Promise.resolve({ data: [] as { body: string | null }[] }),
    ]);
    const { execution, result } = await runAgent(ctx, {
      agent: writer, kind: "task", maxTokens: 1200,
      input: buildPrompt(kind, brief, context ?? null, (recent ?? []).map((r) => r.body ?? "").filter(Boolean)),
      parse: (text) => cleanDraft(text, kind),
    });
    if (execution.status === "failed" || !result) throw new UserFacingError(`Drafting failed: ${execution.error}`);
    const saved = must(await ctx.db.from("linkedin_drafts").insert({
      organisation_id: ctx.organisation.id, kind, brief, context: context || null, body: result, agent_id: writer.id, execution_id: execution.id,
    }).select("id").single<{ id: string }>());
    await logEvent(ctx, { action: "linkedin.drafted", entity: "linkedin_drafts", entityId: saved.id, actorType: "agent", metadata: { kind, agent_id: writer.id } });
    return `${writer.name} wrote your ${KIND_LABEL[kind].toLowerCase()} — review and approve it below`;
  });
}

/** Publishing is external communication: Founder/admin approval (enforced again by a DB trigger). */
export async function approveDraftAction(form: FormData) {
  await runAction(PATH, "Approved — copy it to LinkedIn", async () => {
    const ctx = await requireContext("govern");
    const { id } = parseForm(idSchema, form);
    const { data } = await ctx.db.from("linkedin_drafts").update({ status: "approved", approved_by: ctx.userId }).eq("id", id).eq("organisation_id", ctx.organisation.id).eq("status", "draft").select("id");
    if (!data?.length) throw new UserFacingError("This draft is no longer waiting for approval");
  });
}

export async function markPostedAction(form: FormData) {
  await runAction(PATH, "Marked as posted", async () => {
    const ctx = await requireContext("operate");
    const { id } = parseForm(idSchema, form);
    const { data } = await ctx.db.from("linkedin_drafts").update({ status: "posted", posted_at: new Date().toISOString() }).eq("id", id).eq("organisation_id", ctx.organisation.id).eq("status", "approved").select("id");
    if (!data?.length) throw new UserFacingError("Only approved drafts can be marked as posted");
  });
}

export async function discardDraftAction(form: FormData) {
  await runAction(PATH, "Draft discarded", async () => {
    const ctx = await requireContext("operate");
    const { id } = parseForm(idSchema, form);
    must(await ctx.db.from("linkedin_drafts").update({ status: "discarded" }).eq("id", id).eq("organisation_id", ctx.organisation.id).in("status", ["draft", "approved"]).select("id").single());
  });
}
