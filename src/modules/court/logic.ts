/** Idea Court rules: prompts, output schemas and the vote tally. Pure: unit-tested. */
import { z } from "zod";
import { AiError } from "@/lib/ai/types";

export type Vote = "build" | "fix" | "kill";

/** Twelve jurors, each judging from a different, realistic viewpoint (the panel in the video, made for an Indian agency). */
export const JURY = [
  { key: "customer", label: "Target customer", lens: "would I, the small business owner this is sold to, actually pay for it and why" },
  { key: "investor", label: "Investor", lens: "can this make real money and grow; what is the evidence" },
  { key: "competitor", label: "Competitor", lens: "how easily can I copy or undercut this" },
  { key: "lawyer", label: "Lawyer", lens: "legal and compliance risk in India and abroad" },
  { key: "marketer", label: "Marketer", lens: "can we reach these buyers cheaply and get replies" },
  { key: "operator", label: "Operator", lens: "can a tiny team with AI deliver it every week without breaking" },
  { key: "finance", label: "Finance head", lens: "cash up front, cost to deliver, time to first ₹" },
  { key: "skeptic", label: "Skeptic", lens: "the strongest reason this fails" },
  { key: "early", label: "Early adopter", lens: "what would make me try it this week" },
  { key: "sales", label: "Salesperson", lens: "can I close this in one call; what objection kills it" },
  { key: "smb", label: "Indian SME owner", lens: "does this fit how Indian businesses buy, pay and trust" },
  { key: "founder", label: "Fellow founder", lens: "is this the best use of the next 30 days at ₹0 capital" },
] as const;

const TONE = `Speak like a real Indian professional in a courtroom drama: plain Hinglish, short spoken sentences, no jargon or acronyms, no lists in speech.
Never invent customers, numbers, prices, results or research. If something is unknown, say what must be tested.`;

export function prosecutionPrompt(idea: string, by: string | null, context: string): string {
  return `IDEA COURT. You are the PROSECUTOR. Your job: find the real reasons this idea fails before the company wastes time on it.
Exhibit A — the idea${by ? ` (proposed by ${by})` : ""}: """${idea}"""
${context ? `Company context:\n${context}\n` : ""}
Ask exactly 3 brutal but fair questions — the ones a smart customer, investor or competitor would ask. Each must target a different weakness
(demand / willingness to pay, competition or alternatives, reach or delivery, legal or money).
${TONE}
Respond with ONLY JSON: {"opening": "one spoken sentence to open the case", "questions": [{"q": "the question, max 18 words", "why": "why it matters, max 20 words"}]}`;
}

export function defencePrompt(idea: string, questions: { q: string; why: string }[], context: string): string {
  return `IDEA COURT. You are the DEFENCE. Make the strongest HONEST case for this idea and answer every question from the prosecution.
Exhibit A: """${idea}"""
${context ? `Company context:\n${context}\n` : ""}
Prosecution's questions:
${questions.map((q, i) => `${i + 1}. ${q.q}`).join("\n")}
For each question: answer it directly; if the honest answer is "we don't know yet", say how we'd find out cheaply this week. You may sharpen the idea to survive the attack.
${TONE}
Respond with ONLY JSON: {"answers": ["answer to Q1, max 35 words", "answer to Q2", "answer to Q3"], "closing": "one spoken sentence closing argument"}`;
}

/**
 * One call for the whole hearing (faster): the prosecutor lists every real weak point and asks the 3 sharpest
 * questions; the defence answers and speaks for each executive — what they should do and must not do.
 */
export function hearingPrompt(idea: string, by: string | null, context: string, team: readonly string[]): string {
  return `IDEA COURT HEARING. Play two lawyers in turn.
Exhibit A — the idea${by ? ` (proposed by ${by})` : ""}: """${idea}"""
${context ? `Company context:\n${context}\n` : ""}
1) PROSECUTOR: list EVERY real weak point of this idea (demand, willingness to pay, competition, reach, delivery, legal, money, team time) —
   between 3 and 10, only real ones, never padded. Then ask the 3 sharpest questions a customer, investor or competitor would ask.
2) DEFENCE: answer each question honestly (if unknown, say how we find out cheaply this week). Then speak ON BEHALF of each executive below:
   in their own field, what they should DO and what they must NOT do for this idea.
   Executives: ${team.length ? team.join("; ") : "the CEO"}.
${TONE}
Respond with ONLY JSON:
{"opening": "prosecutor's one spoken sentence",
 "weaknesses": [{"point": "the weak point, max 14 words", "why": "why it can sink us, max 20 words"}],
 "questions": [{"q": "max 18 words", "why": "max 20 words"}],
 "answers": ["defence answer to Q1, max 35 words", "Q2", "Q3"],
 "team": [{"who": "Name (title) exactly as listed", "do": "max 18 words", "dont": "max 14 words"}],
 "closing": "defence's one spoken closing sentence"}`;
}

export function deliberationPrompt(idea: string, questions: { q: string }[], answers: string[], context: string, weaknesses: readonly { point: string }[] = [], team: readonly { who: string; do: string; dont: string }[] = []): string {
  return `IDEA COURT. First, play the 12-member JURY, then the JUDGE.
Exhibit A: """${idea}"""
${context ? `Company context:\n${context}\n` : ""}
Prosecution asked, defence answered:
${questions.map((q, i) => `Q: ${q.q}\nA: ${answers[i] ?? "(no answer)"}`).join("\n")}
${weaknesses.length ? `Weak points found:\n${weaknesses.map((w, i) => `W${i + 1}. ${w.point}`).join("\n")}\n` : ""}${team.length ? `Defence, for the executives:\n${team.map((t) => `- ${t.who}: do ${t.do}; don't ${t.dont}`).join("\n")}\n` : ""}
Jurors (vote BUILD = do it now, FIX = good but change something first, KILL = drop it):
${JURY.map((j) => `- ${j.key} (${j.label}): ${j.lens}`).join("\n")}

Then the JUDGE gives the verdict, what to fix, the cheapest next test that proves or kills the idea within 7 days at ₹0, and a one-line vision the whole team can rally around.
The JUDGE also turns EVERY weak point into an UPGRADE (one per weak point, same order): the concrete change that removes or shrinks it,
and the executive who owns it (one of the names above, or "Founder"). Then a short step-by-step plan that keeps failure risk as low as
honestly possible: cheapest proof first, money only after proof. Rate the remaining failure risk low / medium / high with the main
reason — never invent a percentage — and name the stop signal that tells us to drop it early before losing time or money.
${TONE}
Respond with ONLY JSON:
{"votes": [{"juror": "<key>", "vote": "build"|"fix"|"kill", "reason": "max 10 words"}] (exactly the 12 keys above),
 "verdict": "build"|"fix"|"kill", "summary": "judge's spoken verdict, max 40 words", "fix": "what must change, max 30 words",
 "next_test": "the 7-day ₹0 test with a clear pass mark, max 35 words", "vision": "one inspiring but honest line for the team, max 20 words",
 "upgrades": [{"weakness": "short name of the weak point", "upgrade": "the concrete fix, max 25 words", "owner": "Name or Founder"}],
 "plan": ["step 1, max 18 words", "…max 6 steps"],
 "failure_risk": "low"|"medium"|"high", "risk_reason": "max 25 words", "stop_if": "the early stop signal, max 20 words"}`;
}

function extractJson(text: string, what: string): unknown {
  const unfenced = text.replace(/```(?:json)?/gi, "");
  const start = unfenced.indexOf("{");
  const end = unfenced.lastIndexOf("}");
  if (start < 0 || end <= start) throw new AiError(`${what}: no JSON`, true);
  try { return JSON.parse(unfenced.slice(start, end + 1)); } catch { throw new AiError(`${what}: malformed JSON`, true); }
}
function check<T>(schema: z.ZodType<T>, raw: unknown, what: string): T {
  const r = schema.safeParse(raw);
  if (!r.success) throw new AiError(`${what}: ${r.error.issues[0]?.message ?? "invalid"}`, true);
  return r.data;
}

const line = (max: number) => z.string().trim().min(2).max(max);
const weaknessSchema = z.object({ point: line(300), why: line(300).catch("") });
const stanceSchema = z.object({ who: line(80), do: line(300), dont: line(300).catch("") });
/** Lenient list: keeps the valid items, drops a broken one instead of failing the whole hearing. */
const listOf = <T,>(item: z.ZodType<T>, max: number) =>
  z.array(z.unknown()).catch([]).transform((xs) => xs.flatMap((x) => { const r = item.safeParse(x); return r.success ? [r.data] : []; }).slice(0, max));
const prosecutionSchema = z.object({
  opening: line(400),
  questions: z.array(z.object({ q: line(300), why: line(300).catch("") })).min(1).max(3),
  weaknesses: listOf(weaknessSchema, 10).optional(),
});
const defenceSchema = z.object({ answers: z.array(line(600)).min(1).max(3), closing: line(400), team: listOf(stanceSchema, 8).optional() });
const hearingSchema = prosecutionSchema.extend({ answers: z.array(line(600)).min(1).max(3), closing: line(400), team: listOf(stanceSchema, 8) });
const voteSchema = z.enum(["build", "fix", "kill"]);
const rulingSchema = z.object({
  votes: z.array(z.object({ juror: z.string().trim().max(40), vote: z.string().trim().toLowerCase().pipe(voteSchema), reason: line(200).catch("") })).min(6).max(14),
  verdict: z.string().trim().toLowerCase().pipe(voteSchema),
  summary: line(600), fix: line(500).catch(""), next_test: line(600), vision: line(300),
  upgrades: listOf(z.object({ weakness: line(200), upgrade: line(400), owner: line(80).catch("Founder") }), 10).optional(),
  plan: listOf(line(300), 6).optional(),
  failure_risk: z.string().trim().toLowerCase().pipe(z.enum(["low", "medium", "high"])).optional().catch(undefined),
  risk_reason: line(400).optional().catch(undefined),
  stop_if: line(300).optional().catch(undefined),
});

export type Prosecution = z.infer<typeof prosecutionSchema>;
export type Defence = z.infer<typeof defenceSchema>;
export type Ruling = z.infer<typeof rulingSchema>;

export const parseProsecution = (t: string): Prosecution => check(prosecutionSchema, extractJson(t, "Prosecution"), "Prosecution");
export const parseDefence = (t: string): Defence => check(defenceSchema, extractJson(t, "Defence"), "Defence");

/** The combined hearing, split back into the two sides the courtroom plays. */
export function parseHearing(t: string): { prosecution: Prosecution; defence: Defence } {
  const h = check(hearingSchema, extractJson(t, "Hearing"), "Hearing");
  if (h.weaknesses && h.weaknesses.length < 1) throw new AiError("Hearing: no weak points", true);
  return {
    prosecution: { opening: h.opening, questions: h.questions, weaknesses: h.weaknesses ?? [] },
    defence: { answers: h.answers, closing: h.closing, team: h.team },
  };
}

export const RISK_LABEL = { low: "Low risk", medium: "Medium risk", high: "High risk" } as const;

/** Upgrades whose owner is a real active agent (case-insensitive on the first name), for task creation. */
export function ownedUpgrades<A extends { name: string }>(upgrades: readonly { weakness: string; upgrade: string; owner: string }[], agents: readonly A[]) {
  return upgrades.flatMap((u) => {
    const first = u.owner.trim().split(/[\s(]/)[0]?.toLowerCase() ?? "";
    const agent = agents.find((a) => a.name.toLowerCase() === first);
    return agent ? [{ ...u, agent }] : [];
  });
}

/** Votes are kept only for real jurors (one each, in panel order); the verdict follows the jury unless the judge has a clear reason. */
export function parseRuling(t: string): Ruling {
  const r = check(rulingSchema, extractJson(t, "Verdict"), "Verdict");
  const byKey = new Map(r.votes.map((v) => [v.juror.toLowerCase(), v]));
  const votes = JURY.flatMap((j) => { const v = byKey.get(j.key); return v ? [{ juror: j.key as string, vote: v.vote, reason: v.reason }] : []; });
  if (votes.length < 6) throw new AiError("Verdict: the jury did not vote", true);
  return { ...r, votes };
}

export function tally(votes: { vote: Vote }[]): Record<Vote, number> {
  return votes.reduce((t, v) => ({ ...t, [v.vote]: t[v.vote] + 1 }), { build: 0, fix: 0, kill: 0 } as Record<Vote, number>);
}

/** The court's verdict is the jury's majority; ties go to the more careful option (fix over build, kill over fix). */
export function majority(votes: { vote: Vote }[]): Vote {
  const t = tally(votes);
  if (t.kill > t.fix && t.kill > t.build) return "kill";
  if (t.build > t.fix && t.build > t.kill) return "build";
  return t.kill >= t.fix && t.kill >= t.build ? "kill" : "fix";
}

export const VERDICT_LABEL: Record<Vote, string> = { build: "BUILD IT", fix: "FIX IT", kill: "KILL IT" };

/** The judge's ruling as one plain paragraph — for the meeting transcript and everyone's memory. */
export function rulingText(t: { idea: string; verdict: Vote | null; ruling: Omit<Ruling, "votes" | "verdict"> | null; defence: Defence | null }): string {
  const r = t.ruling;
  if (!r || !t.verdict) return "";
  const ups = (r.upgrades ?? []).map((u, i) => `${i + 1}) ${u.weakness} → ${u.upgrade} [${u.owner}]`).join(" ");
  const team = (t.defence?.team ?? []).map((x) => `${x.who}: do ${x.do}${x.dont ? `; don't ${x.dont}` : ""}`).join(" | ");
  return [
    `Idea Court on "${t.idea.slice(0, 200)}": ${t.verdict.toUpperCase()}. ${r.summary}`,
    r.fix && `Fix: ${r.fix}`,
    ups && `Upgrades: ${ups}`,
    r.plan?.length ? `Plan: ${r.plan.map((p, i) => `${i + 1}. ${p}`).join(" ")}` : "",
    `Next test: ${r.next_test}`,
    r.failure_risk ? `${RISK_LABEL[r.failure_risk]}${r.risk_reason ? ` — ${r.risk_reason}` : ""}.` : "",
    r.stop_if && `Stop if: ${r.stop_if}`,
    team && `Team roles: ${team}`,
    `Vision: ${r.vision}`,
  ].filter(Boolean).join(" ").slice(0, 5800);
}
