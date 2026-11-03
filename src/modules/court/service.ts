import "server-only";
import { formatInr } from "@/lib/utilities/format";
import { logEvent } from "@/modules/audit/service";
import type { AppContext } from "@/modules/auth/session";
import { companySnapshot, listAgents, runAgent } from "@/modules/orchestration/engine";
import type { Mom } from "@/types/domain";
import {
  defencePrompt, deliberationPrompt, hearingPrompt, majority, ownedUpgrades, parseDefence, parseHearing, parseRuling, rulingText,
  type Defence, type Prosecution, type Ruling, type Vote,
} from "./logic";

/** Live court: one provider gets a short slice, so a hung model fails over to the backup inside the budget. */
const HEARING = { budgetMs: 45_000, attemptMs: 14_000, maxTokens: 1400 };
const VERDICT = { budgetMs: 70_000, attemptMs: 22_000, maxTokens: 1900 };

/** The executives the defence speaks for: active C-suite, as "Name (Title)". */
const teamOf = (agents: Awaited<ReturnType<typeof listAgents>>) =>
  agents.filter((a) => a.status === "active" && (a.tier === "ceo" || a.tier === "coo" || a.tier === "executive")).map((a) => `${a.name} (${a.designation})`).slice(0, 8);


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
  const [court, context, agents] = await Promise.all([judge(ctx), caseContext(ctx), listAgents(ctx)]);
  const update = async (patch: Partial<Trial>) => {
    const { data } = await ctx.db.from("idea_trials").update({ ...patch, error: null }).eq("id", id).eq("organisation_id", ctx.organisation.id).select("*").single<Trial>();
    return data ?? trial;
  };
  const fail = async (error: string | null | undefined) => {
    await ctx.db.from("idea_trials").update({ error: (error ?? "The court could not continue").slice(0, 500) }).eq("id", id).eq("organisation_id", ctx.organisation.id);
    throw new Error(`The court could not continue: ${(error ?? "AI unavailable").slice(0, 200)}`);
  };

  // One call for the whole hearing (prosecution + defence) — the court used to take three slow rounds.
  if (!trial.prosecution) {
    const { execution, result } = await runAgent(ctx, { agent: court, kind: "chat", json: true, ...HEARING, input: hearingPrompt(trial.idea, trial.proposed_by, context, teamOf(agents)), parse: parseHearing });
    return result ? update({ prosecution: result.prosecution, defence: result.defence, stage: "defended" }) : fail(execution.error);
  }
  if (!trial.defence) { // cases filed before the combined hearing
    const { execution, result } = await runAgent(ctx, { agent: court, kind: "chat", json: true, ...HEARING, maxTokens: 800, input: defencePrompt(trial.idea, trial.prosecution.questions, context), parse: parseDefence });
    return result ? update({ defence: result, stage: "defended" }) : fail(execution.error);
  }
  const { execution, result } = await runAgent(ctx, {
    agent: court, kind: "chat", json: true, ...VERDICT,
    input: deliberationPrompt(trial.idea, trial.prosecution.questions, trial.defence.answers, context, trial.prosecution.weaknesses ?? [], trial.defence.team ?? []), parse: parseRuling,
  });
  if (!result) return fail(execution.error);
  const { votes, verdict: _judgeSays, ...ruling } = result;
  const decided = await update({ jury: votes, verdict: majority(votes), ruling, stage: "decided" });
  // A trial held during a meeting is part of that meeting: the verdict goes into the transcript (and so into the minutes).
  if (decided.meeting_id && decided.verdict) {
    const { data: m } = await ctx.db.from("board_meetings").select("status").eq("id", decided.meeting_id).eq("organisation_id", ctx.organisation.id).maybeSingle<{ status: string }>();
    if (m?.status === "in_progress") {
      const { data: lastSeq } = await ctx.db.from("board_messages").select("seq").eq("meeting_id", decided.meeting_id).order("seq", { ascending: false }).limit(1).maybeSingle<{ seq: number }>();
      await ctx.db.from("board_messages").insert({
        organisation_id: ctx.organisation.id, meeting_id: decided.meeting_id, seq: (lastSeq?.seq ?? -1) + 1, role: "system", speaker: "Idea Court",
        body: rulingText(decided),
      });
    }
  }
  // The judge's update reaches every team member at once (advisory until the Founder adopts it).
  const team = agents.filter((a) => a.status === "active");
  if (team.length) {
    await ctx.db.from("agent_memories").insert(team.map((a) => ({
      organisation_id: ctx.organisation.id, agent_id: a.id, kind: "note", importance: 4,
      content: `(Advisory — awaiting the Founder's adoption) ${rulingText(decided)}`.slice(0, 2400),
    })));
  }
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
  const ruling = rulingText(trial);
  // Everyone follows the adopted ruling; each executive also keeps the part the defence spoke for them.
  await ctx.db.from("agent_memories").insert(agents.map((a) => {
    const mine = (trial.defence?.team ?? []).find((t) => t.who.toLowerCase().startsWith(a.name.toLowerCase()));
    return {
      organisation_id: ctx.organisation.id, agent_id: a.id, kind: "decision", importance: 5,
      content: `ADOPTED by the Founder — follow this. ${mine ? `Your part: do ${mine.do}${mine.dont ? `; don't ${mine.dont}` : ""}. ` : ""}${ruling}`.slice(0, 2600),
    };
  }));
  const owner = agents.find((a) => trial.proposed_by && a.name.toLowerCase() === trial.proposed_by.toLowerCase()) ?? agents.find((a) => a.tier === "ceo");
  let upgradeTasks = 0;
  if (trial.verdict !== "kill") {
    const rows = [];
    if (owner) {
      rows.push({
        organisation_id: ctx.organisation.id, title: `7-day test: ${trial.idea.slice(0, 150)}`.slice(0, 200),
        description: `${trial.ruling.next_test}\n\nFix first: ${trial.ruling.fix}${trial.ruling.stop_if ? `\nStop if: ${trial.ruling.stop_if}` : ""}\nVision: ${trial.ruling.vision}`,
        priority: "high", assigned_agent_id: owner.id, created_by: ctx.userId,
      });
    }
    // Every upgrade with a real owner becomes that agent's task (normal task governance applies).
    for (const u of ownedUpgrades(trial.ruling.upgrades ?? [], agents)) {
      rows.push({
        organisation_id: ctx.organisation.id, title: `Upgrade: ${u.weakness}`.slice(0, 200),
        description: `${u.upgrade}\n\nFrom the Idea Court ruling on: ${trial.idea.slice(0, 300)}`, priority: "medium",
        assigned_agent_id: u.agent.id, created_by: ctx.userId,
      });
    }
    if (rows.length) {
      const { error: taskErr } = await ctx.db.from("tasks").insert(rows);
      if (taskErr) console.warn("[court] tasks not created", taskErr.message);
      else upgradeTasks = rows.length - (owner ? 1 : 0);
    }
  }
  await logEvent(ctx, { action: "court.verdict_adopted", entity: "idea_trials", entityId: id, metadata: { verdict: trial.verdict } });
  return trial.verdict === "kill" ? "Adopted — the team will drop this idea and remembers why"
    : `Adopted — the whole team follows this ruling; ${owner?.name ?? "the CEO"} owns the 7-day test${upgradeTasks ? `, ${upgradeTasks} upgrade task${upgradeTasks === 1 ? "" : "s"} assigned` : ""}`;
}
