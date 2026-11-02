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

export function deliberationPrompt(idea: string, questions: { q: string }[], answers: string[], context: string): string {
  return `IDEA COURT. First, play the 12-member JURY, then the JUDGE.
Exhibit A: """${idea}"""
${context ? `Company context:\n${context}\n` : ""}
Prosecution asked, defence answered:
${questions.map((q, i) => `Q: ${q.q}\nA: ${answers[i] ?? "(no answer)"}`).join("\n")}

Jurors (vote BUILD = do it now, FIX = good but change something first, KILL = drop it):
${JURY.map((j) => `- ${j.key} (${j.label}): ${j.lens}`).join("\n")}

Then the JUDGE gives the verdict, what to fix, the cheapest next test that proves or kills the idea within 7 days at ₹0, and a one-line vision the whole team can rally around.
${TONE}
Respond with ONLY JSON:
{"votes": [{"juror": "<key>", "vote": "build"|"fix"|"kill", "reason": "max 14 words"}] (exactly the 12 keys above),
 "verdict": "build"|"fix"|"kill", "summary": "judge's spoken verdict, max 40 words", "fix": "what must change, max 30 words",
 "next_test": "the 7-day ₹0 test with a clear pass mark, max 35 words", "vision": "one inspiring but honest line for the team, max 20 words"}`;
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
const prosecutionSchema = z.object({
  opening: line(400),
  questions: z.array(z.object({ q: line(300), why: line(300).catch("") })).min(1).max(3),
});
const defenceSchema = z.object({ answers: z.array(line(600)).min(1).max(3), closing: line(400) });
const voteSchema = z.enum(["build", "fix", "kill"]);
const rulingSchema = z.object({
  votes: z.array(z.object({ juror: z.string().trim().max(40), vote: z.string().trim().toLowerCase().pipe(voteSchema), reason: line(200).catch("") })).min(6).max(14),
  verdict: z.string().trim().toLowerCase().pipe(voteSchema),
  summary: line(600), fix: line(500).catch(""), next_test: line(600), vision: line(300),
});

export type Prosecution = z.infer<typeof prosecutionSchema>;
export type Defence = z.infer<typeof defenceSchema>;
export type Ruling = z.infer<typeof rulingSchema>;

export const parseProsecution = (t: string): Prosecution => check(prosecutionSchema, extractJson(t, "Prosecution"), "Prosecution");
export const parseDefence = (t: string): Defence => check(defenceSchema, extractJson(t, "Defence"), "Defence");

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
