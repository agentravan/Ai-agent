/** Pure board-meeting rules: who sits on the board, speaking order and prompts. No I/O: unit-tested. */
import { PLAN_FORMAT_INSTRUCTIONS } from "@/modules/orchestration/plan";
import type { AgentTier } from "@/types/domain";

export type BoardRole = "ceo" | "coo" | "cfo" | "legal";
export interface BoardSeat<A> { role: BoardRole; agent: A }
type AgentLike = { tier: AgentTier; designation: string; status: string };

export const ROLE_TITLE: Record<BoardRole, string> = { ceo: "CEO", coo: "COO", cfo: "CFO", legal: "Legal Head" };

/** What each member must cover, so the meeting adds up to a decision instead of four similar opinions. */
const ROLE_BRIEF: Record<BoardRole, string> = {
  ceo: "Strategy: which opportunity to pursue first and why, given ₹0 capital and what the system can already do. Pick one clear direction.",
  coo: "Execution: how this runs this week — which AI employees and system features (Sales Engine, LinkedIn Desk, Rank Tracker, Agent Library) do what, and the Founder's 15–30 minutes a day.",
  cfo: "Money: price points to test, what must be collected up front, costs (must stay ₹0 until the profit gate), and the one number to track this week. Use only figures given — otherwise say what data is needed.",
  legal: "Law: is this allowed in India and in the client's country? Conditions (opt-out in outreach, data privacy, GST invoices, written client agreement). Say plainly: allowed / allowed with conditions / not allowed.",
};

/** CEO, COO, CFO, Legal Head — in that order. Only active agents; missing seats are skipped. */
export function pickBoard<A extends AgentLike>(agents: readonly A[]): BoardSeat<A>[] {
  const active = agents.filter((a) => a.status === "active");
  const exec = (re: RegExp) => active.find((a) => a.tier === "executive" && re.test(a.designation));
  const seats: [BoardRole, A | undefined][] = [
    ["ceo", active.find((a) => a.tier === "ceo")],
    ["coo", active.find((a) => a.tier === "coo")],
    ["cfo", exec(/financ|\bcfo\b/i)],
    ["legal", exec(/legal|compliance/i)],
  ];
  return seats.flatMap(([role, agent]) => (agent ? [{ role, agent }] : []));
}

export interface SpokenLine { speaker: string; body: string; failed?: boolean }

export function transcript(lines: readonly SpokenLine[]): string {
  const spoken = lines.filter((l) => !l.failed);
  return spoken.length ? spoken.map((l) => `${l.speaker}: ${l.body}`).join("\n\n") : "(nobody has spoken yet)";
}

export function speakerPrompt(role: BoardRole, topic: string, lines: readonly SpokenLine[]): string {
  return `Board meeting with the Founder. Agenda from the Founder: """${topic}"""

Discussion so far:
${transcript(lines)}

Your turn as ${ROLE_TITLE[role]}. ${ROLE_BRIEF[role]}
Build on what was said; don't repeat it. Max 130 words, short sentences that sound natural when read aloud.
End with your recommendation in one line starting "Meri salah:" (or "My recommendation:" if the Founder wrote in English).`;
}

export function closingPrompt(topic: string, lines: readonly SpokenLine[], roster: string, kras: string): string {
  return `You chaired a board meeting with the Founder. Agenda: """${topic}"""

What the board said:
${transcript(lines)}

Close the meeting: turn the agreed direction into a plan the team starts now.
Available AI employees: ${roster}
KRAs: ${kras}
The "summary" is your closing words to the Founder: the decision, who does what, and what the Founder must decide or approve.

${PLAN_FORMAT_INSTRUCTIONS}`;
}

/** Board messages are stored and read aloud: trim and cap them. */
export function cleanSpeech(text: string, max = 6000): string {
  const t = text.replace(/```[a-z]*\n?/gi, "").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/** Sequence numbers: members speak at 0..n-1; the CEO's closing is stored last. */
export const CLOSING_SEQ = 49;
