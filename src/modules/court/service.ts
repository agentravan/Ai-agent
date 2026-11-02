import "server-only";
import { formatInr } from "@/lib/utilities/format";
import { logEvent } from "@/modules/audit/service";
import type { AppContext } from "@/modules/auth/session";
import { companySnapshot, listAgents, runAgent } from "@/modules/orchestration/engine";
import type { Mom } from "@/types/domain";
import {
  defencePrompt, deliberationPrompt, majority, parseDefence, parseProsecution, parseRuling, prosecutionPrompt,
  type Defence, type Prosecution, type Ruling, type Vote,
} from "./logic";

export interface Trial {
  id: string; organisation_id: string; idea: string; proposed_by: string | null; meeting_id: string | null;
  stage: "filed" | "prosecuted" | "defended" | "decided" | "failed";
  prosecution: Prosecution | null; defence: Defence | null; jury: Ruling["votes"] | null; verdict: Vote | null;
  ruling: Omit<Ruling, "votes" | "verdict"> | null; error: string | null; adopted_at: string | null; created_at: string;
}

async function load(ctx: AppContext, id: string): Promise<Trial> {
  const { data } = await ctx.db.from("idea_trials").select("*").eq("id", id).eq("organisation_id", ctx.organisation.id).single<Trial>();
  if (!data) throw new Error("Case not found");
  return data;
}

/** What the court knows about the company — real figures and the latest meeting decisions, nothing invented. */
async function caseContext(ctx: AppContext): Promise<string> {
  const [company, { data: last }] = await Promise.all([
    companySnapshot(ctx),
    ctx.db.from("board_meetings").select("mom").eq("organisation_id", ctx.organisation.id).not("mom", "is", null).order("created_at", { ascending: false }).limit(2).returns<{ mom: Mom }[]>(),
  ]);
  const decisions = (last ?? []).flatMap((m) => [...m.mom.decisions, ...m.mom.risks]).slice(0, 8);
  return `Capital ₹0 (Phase 0: free tools only until ₹80,000 profit). Net profit so far ${formatInr(company.netProfitCents)}. `
    + `Services the company can deliver with its AI team: websites, HR services, e-commerce setup, outreach.`
    + (decisions.length ? `\nFrom recent meetings: ${decisions.join(" | ")}` : "");
}

async function judge(ctx: AppContext) {
  const agents = await listAgents(ctx);
  const nyaya = agents.find((a) => a.name === "Nyaya" && a.status === "active") ?? agents.find((a) => a.tier === "ceo" && a.status === "active");
  if (!nyaya) throw new Error("The court is closed: activate Nyaya (or the CEO) in the Agent Registry.");
  return nyaya;
}

/** Moves the case one step: prosecution → defence → jury & verdict. Safe to call again after a failure. */
export async function advanceTrial(ctx: AppContext, id: string): Promise<Trial> {
  const trial = await load(ctx, id);
  if (trial.stage === "decided") return trial;
  const [court, context] = await Promise.all([judge(ctx), caseContext(ctx)]);
  const update = async (patch: Partial<Trial>) => {
    const { data } = await ctx.db.from("idea_trials").update({ ...patch, error: null }).eq("id", id).eq("organisation_id", ctx.organisation.id).select("*").single<Trial>();
    return data ?? trial;
  };
  const fail = async (error: string | null | undefined) => {
    await ctx.db.from("idea_trials").update({ error: (error ?? "The court could not continue").slice(0, 500) }).eq("id", id).eq("organisation_id", ctx.organisation.id);
    throw new Error(`The court could not continue: ${(error ?? "AI unavailable").slice(0, 200)}`);
  };

  if (!trial.prosecution) {
    const { execution, result } = await runAgent(ctx, { agent: court, kind: "chat", json: true, maxTokens: 700, budgetMs: 60_000, input: prosecutionPrompt(trial.idea, trial.proposed_by, context), parse: parseProsecution });
    return result ? update({ prosecution: result, stage: "prosecuted" }) : fail(execution.error);
  }
  if (!trial.defence) {
    const { execution, result } = await runAgent(ctx, { agent: court, kind: "chat", json: true, maxTokens: 800, budgetMs: 60_000, input: defencePrompt(trial.idea, trial.prosecution.questions, context), parse: parseDefence });
    return result ? update({ defence: result, stage: "defended" }) : fail(execution.error);
  }
  const { execution, result } = await runAgent(ctx, {
    agent: court, kind: "chat", json: true, maxTokens: 1600, budgetMs: 90_000,
    input: deliberationPrompt(trial.idea, trial.prosecution.questions, trial.defence.answers, context), parse: parseRuling,
  });
  if (!result) return fail(execution.error);
  const { votes, verdict: _judgeSays, ...ruling } = result;
  const decided = await update({ jury: votes, verdict: majority(votes), ruling, stage: "decided" });
  await logEvent(ctx, { action: "court.verdict", entity: "idea_trials", entityId: id, actorType: "agent", metadata: { verdict: decided.verdict } });
  return decided;
}

/**
 * The Founder adopts the verdict: every active team member remembers the vision and the verdict, and the 7-day test
 * becomes a task for whoever proposed the idea (or the CEO).
 */
export async function adoptVerdict(ctx: AppContext, id: string): Promise<string> {
  const trial = await load(ctx, id);
  if (trial.stage !== "decided" || !trial.ruling || !trial.verdict) throw new Error("The court has not decided yet");
  if (trial.adopted_at) return "Already adopted";
  const { error } = await ctx.db.from("idea_trials").update({ adopted_at: new Date().toISOString() }).eq("id", id).eq("organisation_id", ctx.organisation.id).is("adopted_at", null);
  if (error) throw new Error(error.code === "42501" ? "Only the Founder or an admin can adopt a verdict" : error.message);
  const agents = (await listAgents(ctx)).filter((a) => a.status === "active");
  const memory = `Team vision (Idea Court, ${trial.verdict.toUpperCase()}): ${trial.ruling.vision} Idea: ${trial.idea.slice(0, 300)}. Fix: ${trial.ruling.fix}. Next test: ${trial.ruling.next_test}`.slice(0, 2000);
  await ctx.db.from("agent_memories").insert(agents.map((a) => ({ organisation_id: ctx.organisation.id, agent_id: a.id, kind: "decision", importance: 5, content: memory })));
  const owner = agents.find((a) => trial.proposed_by && a.name.toLowerCase() === trial.proposed_by.toLowerCase()) ?? agents.find((a) => a.tier === "ceo");
  if (trial.verdict !== "kill" && owner) {
    await ctx.db.from("tasks").insert({
      organisation_id: ctx.organisation.id, title: `7-day test: ${trial.idea.slice(0, 150)}`.slice(0, 200),
      description: `${trial.ruling.next_test}\n\nFix first: ${trial.ruling.fix}\nVision: ${trial.ruling.vision}`, priority: "high",
      assigned_agent_id: owner.id, created_by: ctx.userId,
    });
  }
  await logEvent(ctx, { action: "court.verdict_adopted", entity: "idea_trials", entityId: id, metadata: { verdict: trial.verdict } });
  return trial.verdict === "kill" ? "Adopted — the team will drop this idea and remembers why" : `Adopted — the whole team now shares this vision; ${owner?.name ?? "the CEO"} owns the 7-day test`;
}
