import "server-only";
import { formatInr } from "@/lib/utilities/format";
import { UserFacingError } from "@/lib/utilities/action";
import { logEvent } from "@/modules/audit/service";
import type { AppContext } from "@/modules/auth/session";
import { companySnapshot, listAgents, runAgent } from "@/modules/orchestration/engine";
import type { AgentWithPermissions, DesignDoc } from "@/types/domain";
import {
  approvalBlockers, briefPrompt, challengePrompt, draftPrompt, nextLens, parseBrief, parseChallenge, parseDraft, parseReview, reviewPrompt, revisePrompt,
  type Decision, type FindingRow, type Stage,
} from "./logic";

/** One AI step per server call keeps each call inside the serverless time limit. */
const WRITE = { budgetMs: 100_000, attemptMs: 60_000, maxTokens: 6000 };
const BRIEF = { budgetMs: 70_000, attemptMs: 40_000, maxTokens: 2500 };
const REVIEW = { budgetMs: 70_000, attemptMs: 40_000, maxTokens: 2200 };

export type { DesignDoc };

export async function loadDoc(ctx: AppContext, id: string): Promise<DesignDoc> {
  const { data } = await ctx.db.from("design_docs").select("*").eq("id", id).eq("organisation_id", ctx.organisation.id).maybeSingle<DesignDoc>();
  if (!data) throw new UserFacingError("Design not found");
  return data;
}

/** Lenses reviewed and findings raised in the current round. */
export async function loadRound(ctx: AppContext, doc: Pick<DesignDoc, "id" | "round">) {
  if (doc.round < 1) return { lenses: [] as string[], paraphrase: null as string | null, findings: [] as FindingRow[] };
  const [{ data: reviews }, { data: findings }] = await Promise.all([
    ctx.db.from("design_reviews").select("lens, paraphrase").eq("doc_id", doc.id).eq("round", doc.round).eq("organisation_id", ctx.organisation.id).returns<{ lens: string; paraphrase: string | null }[]>(),
    ctx.db.from("design_findings").select("id, lens, severity, title, detail, fix, decision, round").eq("doc_id", doc.id).eq("round", doc.round).eq("organisation_id", ctx.organisation.id).order("created_at").returns<FindingRow[]>(),
  ]);
  return {
    lenses: (reviews ?? []).map((r) => r.lens),
    paraphrase: (reviews ?? []).find((r) => r.paraphrase)?.paraphrase ?? null,
    findings: findings ?? [],
  };
}

const active = (agents: AgentWithPermissions[], name: string) => agents.find((a) => a.name === name && a.status === "active");

/** Gaja writes; the CEO stands in if Gaja is suspended. */
function elephant(agents: AgentWithPermissions[]) {
  const a = active(agents, "Gaja") ?? agents.find((x) => x.tier === "ceo" && x.status === "active");
  if (!a) throw new UserFacingError("Design Studio is closed: activate Gaja (or the CEO) in the Agent Registry.");
  return a;
}

/** Meen reviews. There is no stand-in: a review by an agent with memory is not a goldfish review. */
function goldfish(agents: AgentWithPermissions[]) {
  const a = active(agents, "Meen");
  if (!a) throw new UserFacingError("Goldfish review needs Meen — activate Meen in the Agent Registry.");
  return a;
}

/** What the elephant knows about the company: real figures only. */
async function companyContext(ctx: AppContext): Promise<string> {
  const c = await companySnapshot(ctx);
  return `Budget: ₹0 infrastructure — free tiers only (GitHub, Vercel Hobby, Supabase Free, local Ollama) until ₹80,000 net profit. Net profit so far ${formatInr(c.netProfitCents)}.
The company runs AI Empire OS (Next.js + Supabase) with an AI workforce; it sells HR services, websites and e-commerce setup to Indian businesses.`;
}

async function setError(ctx: AppContext, id: string, error: string | null | undefined): Promise<never> {
  const msg = (error ?? "AI unavailable").slice(0, 500);
  await ctx.db.from("design_docs").update({ error: msg }).eq("id", id).eq("organisation_id", ctx.organisation.id);
  throw new UserFacingError(`Design Studio could not continue: ${msg.slice(0, 200)}`);
}

async function patch(ctx: AppContext, id: string, values: Partial<DesignDoc>, guard?: { stage: Stage }) {
  let q = ctx.db.from("design_docs").update({ ...values, error: null }).eq("id", id).eq("organisation_id", ctx.organisation.id);
  if (guard) q = q.eq("stage", guard.stage);
  const { data, error } = await q.select("*").maybeSingle<DesignDoc>();
  if (error) throw new UserFacingError(error.code === "42501" ? "Permission denied" : error.code === "23514" || error.code === "P0001" ? error.message : "Could not save the design");
  if (!data) throw new UserFacingError("The design changed meanwhile — refresh and try again");
  return data;
}

/**
 * Runs the next AI step, if any: brief → goldfish challenge (brief stage); draft (draft stage); the next goldfish lens (review stage).
 * `more` tells the caller to call again. Safe to repeat after a failure.
 */
export async function advanceDesign(ctx: AppContext, id: string): Promise<{ doc: DesignDoc; more: boolean; step: string | null }> {
  const doc = await loadDoc(ctx, id);
  if (doc.stage === "approved") return { doc, more: false, step: null };
  const agents = await listAgents(ctx);

  if (doc.stage === "brief" && !doc.brief) {
    const { execution, result } = await runAgent(ctx, { agent: elephant(agents), kind: "chat", ...BRIEF, input: briefPrompt(doc.title, doc.idea, await companyContext(ctx)), parse: parseBrief });
    if (!result) return setError(ctx, id, execution.error);
    // more: false — the page then shows the challenge card, whose own runner starts the goldfish (no double run).
    return { doc: await patch(ctx, id, { brief: result, challenges: null }, { stage: "brief" }), more: false, step: "brief" };
  }
  if (doc.stage === "brief" && doc.brief && !doc.challenges) {
    const { execution, result } = await runAgent(ctx, { agent: goldfish(agents), kind: "chat", json: true, fresh: true, ...REVIEW, input: challengePrompt(doc.brief), parse: parseChallenge });
    if (!result) return setError(ctx, id, execution.error);
    const now = await loadDoc(ctx, id);
    if (now.brief !== doc.brief) return { doc: now, more: false, step: null }; // the brief was edited meanwhile: challenge the new text instead
    return { doc: await patch(ctx, id, { challenges: result }, { stage: "brief" }), more: false, step: "challenge" };
  }
  if (doc.stage === "draft" && !doc.draft) {
    if (!doc.brief) throw new UserFacingError("Write the brief first");
    const { execution, result } = await runAgent(ctx, { agent: elephant(agents), kind: "chat", ...WRITE, input: draftPrompt(doc.title, doc.brief, doc.challenges ?? [], await companyContext(ctx)), parse: parseDraft });
    if (!result) return setError(ctx, id, execution.error);
    return { doc: await patch(ctx, id, { draft: result }, { stage: "draft" }), more: false, step: "draft" };
  }
  if (doc.stage === "review" && doc.draft) {
    const { lenses } = await loadRound(ctx, doc);
    const lens = nextLens(lenses);
    if (!lens) return { doc, more: false, step: null };
    // Goldfish: only the document text goes in — no memories, no playbooks, no brief, no conversation.
    const { execution, result } = await runAgent(ctx, { agent: goldfish(agents), kind: "chat", json: true, fresh: true, ...REVIEW, input: reviewPrompt(lens, doc.draft), parse: parseReview });
    if (!result) return setError(ctx, id, execution.error);
    const fresh = await loadDoc(ctx, id);
    if (fresh.stage !== "review" || fresh.round !== doc.round || fresh.draft !== doc.draft) return { doc: fresh, more: false, step: null }; // the draft moved on meanwhile
    const { data: review, error } = await ctx.db.from("design_reviews").insert({
      organisation_id: ctx.organisation.id, doc_id: id, round: doc.round, lens, paraphrase: result.paraphrase,
    }).select("id").single<{ id: string }>();
    if (error?.code === "23505") return { doc: fresh, more: nextLens([...lenses, lens]) !== null, step: lens }; // a parallel run got there first
    if (error || !review) throw new UserFacingError("Could not save the review");
    if (result.findings.length) {
      const { error: fErr } = await ctx.db.from("design_findings").insert(result.findings.map((f) => ({
        organisation_id: ctx.organisation.id, doc_id: id, review_id: review.id, round: doc.round, lens,
        severity: f.severity, title: f.title, detail: f.detail, fix: f.fix,
      })));
      if (fErr) {
        await ctx.db.from("design_reviews").delete().eq("id", review.id); // no half-saved review: it will run again
        throw new UserFacingError("Could not save the findings — run the review again");
      }
    }
    await logEvent(ctx, { action: "design.reviewed", entity: "design_docs", entityId: id, actorType: "agent", metadata: { lens, round: doc.round, findings: result.findings.length } });
    return { doc: fresh, more: nextLens([...lenses, lens]) !== null, step: lens };
  }
  return { doc, more: false, step: null };
}

export async function saveBrief(ctx: AppContext, id: string, brief: string) {
  // Editing the brief invalidates the goldfish challenge of the old text.
  await patch(ctx, id, { brief, challenges: null }, { stage: "brief" });
}

/** Brief → Draft (the elephant then writes the draft). */
export async function startDraft(ctx: AppContext, id: string) {
  const doc = await loadDoc(ctx, id);
  if (!doc.brief) throw new UserFacingError("Write the brief first");
  await patch(ctx, id, { stage: "draft", draft: null }, { stage: "brief" });
}

export async function saveDraft(ctx: AppContext, id: string, draft: string) {
  await patch(ctx, id, { draft }, { stage: "draft" });
}

/** Back from draft to the brief (the draft is rewritten from the new brief). */
export async function backToBrief(ctx: AppContext, id: string) {
  await patch(ctx, id, { stage: "brief", draft: null }, { stage: "draft" });
}

/** Draft → a new goldfish review round. */
export async function sendToReview(ctx: AppContext, id: string) {
  const doc = await loadDoc(ctx, id);
  if (!doc.draft) throw new UserFacingError("There is no draft to review yet");
  await patch(ctx, id, { stage: "review", round: doc.round + 1 }, { stage: "draft" });
  await logEvent(ctx, { action: "design.sent_to_review", entity: "design_docs", entityId: id, metadata: { round: doc.round + 1 } });
}

export async function decideFinding(ctx: AppContext, docId: string, findingId: string, decision: Decision) {
  const doc = await loadDoc(ctx, docId);
  if (doc.stage !== "review") throw new UserFacingError("Findings can be decided only during review");
  const { data, error } = await ctx.db.from("design_findings").update({ decision })
    .eq("id", findingId).eq("doc_id", docId).eq("round", doc.round).eq("organisation_id", ctx.organisation.id).select("id").maybeSingle();
  if (error || !data) throw new UserFacingError("Could not update the finding");
}

/** The elephant revises the draft with the findings marked Fix; the design goes back to Draft for a fresh review round. */
export async function reviseDraft(ctx: AppContext, id: string, notes: string): Promise<string> {
  const doc = await loadDoc(ctx, id);
  if (doc.stage !== "review" || !doc.draft) throw new UserFacingError("Only a draft under review can be revised");
  const { findings } = await loadRound(ctx, doc);
  const toFix = findings.filter((f) => f.decision === "fix");
  if (!toFix.length && !notes.trim()) throw new UserFacingError("Mark at least one finding Fix, or write a note for Gaja");
  const agents = await listAgents(ctx);
  const { execution, result } = await runAgent(ctx, { agent: elephant(agents), kind: "chat", ...WRITE, input: revisePrompt(doc.draft, toFix, notes.trim()), parse: parseDraft });
  if (!result) return setError(ctx, id, execution.error);
  await patch(ctx, id, { draft: result, stage: "draft" }, { stage: "review" });
  await logEvent(ctx, { action: "design.revised", entity: "design_docs", entityId: id, actorType: "agent", metadata: { round: doc.round, fixed: toFix.length } });
  return `Gaja revised the draft (${toFix.length} finding${toFix.length === 1 ? "" : "s"} fixed) — send it for a fresh goldfish review`;
}

/**
 * Founder approval (the database re-checks every rule). The build becomes a task for the product head (or the CEO),
 * and Gaja remembers the approved design.
 */
export async function approveDesign(ctx: AppContext, id: string): Promise<string> {
  const doc = await loadDoc(ctx, id);
  if (doc.stage === "approved") return "Already approved";
  if (doc.stage !== "review") throw new UserFacingError("Only a design under review can be approved");
  const { lenses, findings } = await loadRound(ctx, doc);
  const blockers = approvalBlockers(lenses, findings);
  if (blockers.length) throw new UserFacingError(blockers[0]!);
  const approved = await patch(ctx, id, { stage: "approved", approved_at: new Date().toISOString(), approved_by: ctx.userId }, { stage: "review" });

  const agents = (await listAgents(ctx)).filter((a) => a.status === "active");
  const owner = agents.find((a) => a.name === "Pragati") ?? agents.find((a) => a.tier === "ceo");
  if (owner) {
    const { error } = await ctx.db.from("tasks").insert({
      organisation_id: ctx.organisation.id, title: `Build: ${doc.title}`.slice(0, 200), priority: "high", assigned_agent_id: owner.id, created_by: ctx.userId,
      description: `Approved design (Design Studio, round ${doc.round}) — open /design/${id} for the full spec and copy it into the build tool.\n\nIdea: ${doc.idea.slice(0, 800)}`,
    });
    if (error) console.warn("[design] build task not created", error.message);
  }
  const gaja = agents.find((a) => a.name === "Gaja");
  if (gaja) {
    await ctx.db.from("agent_memories").insert({
      organisation_id: ctx.organisation.id, agent_id: gaja.id, kind: "decision", importance: 4,
      content: `APPROVED by the Founder — design "${doc.title}" (round ${doc.round}). Idea: ${doc.idea}`.slice(0, 2400),
    });
  }
  await logEvent(ctx, { action: "design.approved", entity: "design_docs", entityId: id, metadata: { round: approved.round } });
  return `Design approved${owner ? ` — ${owner.name} has the build task` : ""}`;
}
