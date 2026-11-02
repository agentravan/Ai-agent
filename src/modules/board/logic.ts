/** Pure meeting rules: who sits where, how each person talks, how minutes are parsed. No I/O: unit-tested. */
import { z } from "zod";
import { AiError } from "@/lib/ai/types";
import type { Plan, PlanStep } from "@/modules/orchestration/plan";
import type { AgentTier, MeetingKind, Mom } from "@/types/domain";

export type BoardRole = "ceo" | "coo" | "cfo" | "legal" | "member";
export interface Seat<A> { role: BoardRole; agent: A; title: string; color: string; voice: number }
type AgentLike = { id: string; name: string; tier: AgentTier; designation: string; status: string; manager_id?: string | null };

export const ROLE_TITLE: Record<Exclude<BoardRole, "member">, string> = { ceo: "CEO", coo: "COO", cfo: "CFO", legal: "Legal Head" };
/** Tile colours (match the board-room look): CEO blue, COO orange, CFO green, Legal purple; Scribe is white. */
const ROLE_COLOR: Record<Exclude<BoardRole, "member">, string> = { ceo: "#3b82f6", coo: "#f97316", cfo: "#22c55e", legal: "#a855f7" };
const MEMBER_COLORS = ["#14b8a6", "#ec4899", "#eab308", "#06b6d4", "#f43f5e", "#84cc16", "#8b5cf6", "#f59e0b"];
export const SCRIBE_COLOR = "#e5e7eb";

/** What each C-suite member must always weigh, so a meeting adds up to a decision, not four similar opinions. */
const ROLE_LENS: Record<BoardRole, string> = {
  ceo: "strategy and which opportunity wins — the big picture and the next milestone",
  coo: "execution — who does what this week with the AI team and system features, and the Founder's daily 15–30 minutes",
  cfo: "money — price, cash up front, costs (₹0 until the profit gate), profit per client; use only figures given, else say what data is needed",
  legal: "law and risk — India (Contract Act, GST, IT Act, DPDP 2023) and the client's country (anti-spam, consent, opt-outs): allowed / allowed with conditions / not allowed",
  member: "your own function — what you can deliver, what blocks you, what you need",
};

/** CEO, COO, CFO, Legal Head — in that order. Only active agents; missing seats are skipped. */
export function pickBoard<A extends AgentLike>(agents: readonly A[]): Seat<A>[] {
  const active = agents.filter((a) => a.status === "active");
  const exec = (re: RegExp) => active.find((a) => a.tier === "executive" && re.test(a.designation));
  const seats: [Exclude<BoardRole, "member">, A | undefined][] = [
    ["ceo", active.find((a) => a.tier === "ceo")],
    ["coo", active.find((a) => a.tier === "coo")],
    ["cfo", exec(/financ|\bcfo\b/i)],
    ["legal", exec(/legal|compliance/i)],
  ];
  return seats.flatMap(([role, agent], i) => (agent ? [{ role, agent, title: ROLE_TITLE[role], color: ROLE_COLOR[role], voice: i }] : []));
}

/** A leader's team meeting: the host first, then their active direct reports (max 6). */
export function pickTeam<A extends AgentLike>(agents: readonly A[], hostId: string): Seat<A>[] {
  const host = agents.find((a) => a.id === hostId && a.status === "active");
  if (!host) return [];
  const board = pickBoard(agents).find((s) => s.agent.id === host.id);
  const hostSeat: Seat<A> = board ?? { role: "member", agent: host, title: "Host", color: MEMBER_COLORS[0]!, voice: 0 };
  const reports = agents.filter((a) => a.status === "active" && a.manager_id === host.id && a.name !== "Scribe").slice(0, 6);
  return [hostSeat, ...reports.map((agent, i) => ({ role: "member" as const, agent, title: agent.designation.split(/[·(]/)[0]!.trim().slice(0, 40), color: MEMBER_COLORS[(i + 1) % MEMBER_COLORS.length]!, voice: i + 1 }))];
}

export interface SpokenLine { speaker: string; body: string; failed?: boolean; role?: string }

export function transcript(lines: readonly SpokenLine[], max = 9000): string {
  const spoken = lines.filter((l) => !l.failed && l.role !== "system");
  if (!spoken.length) return "(nobody has spoken yet)";
  const text = spoken.map((l) => `${l.speaker}: ${l.body}`).join("\n\n");
  return text.length > max ? `…${text.slice(-max)}` : text;
}

const TALK = `Talk like a real person in a live meeting, not a report: short spoken sentences, address colleagues or the Founder by name,
agree or disagree with what was said and say why. No headings, no markdown, no bullet lists. Same language as the Founder (Hinglish if they used it).`;

/** Each member's first turn: their view, through their own lens, with risk and profit. */
export function openingPrompt(seat: { role: BoardRole; title: string }, agenda: string, lines: readonly SpokenLine[], context = ""): string {
  return `You are in a meeting as ${seat.title}. Agenda: """${agenda}"""${context ? `\n\nContext:\n${context}` : ""}

Said so far:
${transcript(lines)}

Your turn. Speak from your lens: ${ROLE_LENS[seat.role]}.
Cover: your view, the main risk, the profit angle, and one recommendation. Max 110 words.
${TALK}`;
}

/** Answering the Founder during the meeting. Members not addressed only speak if they add something important. */
export function replyPrompt(seat: { role: BoardRole; title: string }, agenda: string, lines: readonly SpokenLine[], founderMessage: string, addressed: "me" | "other" | "all"): string {
  const rule = addressed === "me"
    ? "The Founder is asking YOU. Answer directly and completely, then add your advice."
    : addressed === "other"
      ? "The Founder asked someone else. Reply exactly PASS unless you must add a critical point from your lens (a risk, a cost, a legal issue) — then one or two sentences."
      : "Answer from your lens if you have something useful; otherwise reply exactly PASS. Don't repeat colleagues.";
  return `You are in a live meeting as ${seat.title}. Agenda: """${agenda}"""

Conversation so far:
${transcript(lines)}

The Founder just said: """${founderMessage}"""
${rule}
Weigh risk and profit where relevant (${ROLE_LENS[seat.role]}). Max 90 words.
${TALK}`;
}

/** Who the Founder is talking to: names or titles mentioned ("Ledger", "CFO", "legal"). Empty = everyone. */
export function addressedSeats<A extends { id: string; name: string }>(message: string, seats: readonly Seat<A>[]): Set<string> {
  const text = message.toLowerCase();
  const hit = new Set<string>();
  for (const s of seats) {
    const words = [s.agent.name, s.title, ...(s.role === "legal" ? ["legal", "lawyer", "compliance"] : []), ...(s.role === "cfo" ? ["finance", "paisa"] : [])];
    if (words.some((w) => w.length > 1 && new RegExp(`(^|[^a-z])${w.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z]|$)`).test(text))) hit.add(s.agent.id);
  }
  return hit;
}

export const isPass = (text: string) => /^\W*pass\W*$/i.test(text.trim()) || text.trim().length < 3;

/** Spoken text: no code fences or markdown symbols, capped for storage and reading aloud. */
export function cleanSpeech(text: string, max = 6000): string {
  const t = text.replace(/```[a-z]*\n?/gi, "").replace(/\*\*|__|^#+\s*/gm, "").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

const momSchema = z.object({
  summary: z.string().trim().min(3).max(2000),
  decisions: z.array(z.string().trim().min(1).max(400)).max(15).catch([]),
  action_items: z.array(z.object({
    owner: z.string().trim().min(1).max(80),
    task: z.string().trim().min(3).max(300),
    due: z.string().trim().max(40).catch(""),
    needs_approval: z.boolean().catch(false),
  })).max(12).catch([]),
  risks: z.array(z.string().trim().min(1).max(300)).max(10).catch([]),
  opportunities: z.array(z.string().trim().min(1).max(300)).max(10).catch([]),
  follow_ups: z.array(z.string().trim().min(1).max(300)).max(10).catch([]),
  next_agenda: z.array(z.string().trim().min(1).max(300)).max(8).catch([]),
});

export function momPrompt(kind: MeetingKind, agenda: string, lines: readonly SpokenLine[], participants: string[], today: string): string {
  return `You are the meeting secretary. Write the minutes of this ${kind === "team" ? "team" : kind === "board" ? "board" : `${kind} stand-up`} meeting held on ${today}.
Agenda: """${agenda}"""
Participants: Founder, ${participants.join(", ")}

Transcript:
${transcript(lines, 14000)}

Record only what was actually said. Action item owners must be "Founder" or one of the participants. Use concrete due dates or "today"/"this week".
Mark needs_approval true for anything involving money, contacting clients or other people, legal commitments or irreversible changes.
Write in the language the meeting used. Respond with ONLY JSON:
{"summary": string (max 80 words), "decisions": [string], "action_items": [{"owner": string, "task": string, "due": string, "needs_approval": boolean}],
"risks": [string], "opportunities": [string], "follow_ups": [string] (to check in the next meeting), "next_agenda": [string]}`;
}

/** Validates the minutes; invalid output is retryable. */
export function parseMom(text: string): Mom {
  const unfenced = text.replace(/```(?:json)?/gi, "");
  const start = unfenced.indexOf("{");
  const end = unfenced.lastIndexOf("}");
  if (start < 0 || end <= start) throw new AiError("Minutes contained no JSON", true);
  let raw: unknown;
  try { raw = JSON.parse(unfenced.slice(start, end + 1)); } catch { throw new AiError("Minutes JSON was malformed", true); }
  const parsed = momSchema.safeParse(raw);
  if (!parsed.success) throw new AiError(`Minutes failed validation: ${parsed.error.issues[0]?.message ?? "invalid"}`, true);
  return parsed.data;
}

/**
 * Action items → a governed plan (same path as Empire Command): agent-owned items become tasks for that agent,
 * Founder-owned items go on My Desk, and anything needing approval goes to the Approval Center. Unknown owners are dropped.
 */
export function momToPlan(mom: Mom, agentNames: readonly string[]): Plan | null {
  const names = new Map(agentNames.map((n) => [n.toLowerCase(), n]));
  const steps: PlanStep[] = [];
  for (const a of mom.action_items) {
    if (steps.length >= 10) break;
    const owner = a.owner.toLowerCase().replace(/\s*\(.*$/, "").trim();
    const base = {
      title: a.task.slice(0, 200), description: a.due ? `Due: ${a.due}. From meeting minutes.` : "From meeting minutes.",
      priority: "medium" as const, risk: a.needs_approval ? ("high" as const) : ("low" as const),
    };
    if (/^(founder|harshit|you|me)\b/.test(owner)) { steps.push({ ...base, action: "create_founder_task", task_type: "other" }); continue; }
    const agent = names.get(owner) ?? [...names.entries()].find(([k]) => owner.startsWith(k))?.[1];
    if (agent) steps.push({ ...base, action: "create_task", assignee: agent });
  }
  return steps.length ? { summary: mom.summary.slice(0, 2000), steps } : null;
}

/** Plain-text minutes for email and memory. */
export function momText(mom: Mom, title: string, date: string): string {
  const sec = (h: string, xs: string[]) => (xs.length ? `\n${h}\n${xs.map((x) => `- ${x}`).join("\n")}\n` : "");
  return `MINUTES OF MEETING — ${title}\nDate: ${date}\n\nSummary\n${mom.summary}\n`
    + sec("Decisions", mom.decisions)
    + sec("Action items", mom.action_items.map((a) => `${a.owner}: ${a.task}${a.due ? ` (due ${a.due})` : ""}${a.needs_approval ? " [needs Founder approval]" : ""}`))
    + sec("Risks", mom.risks) + sec("Opportunities", mom.opportunities)
    + sec("Follow up next meeting", mom.follow_ups) + sec("Next agenda", mom.next_agenda);
}

/** Today's date in India (stand-ups are per Indian calendar day). */
export function istDate(now = new Date()): string {
  return new Date(now.getTime() + 5.5 * 3600_000).toISOString().slice(0, 10);
}
export function istHour(now = new Date()): number {
  return new Date(now.getTime() + 5.5 * 3600_000).getUTCHours();
}

/** Which daily stand-up is due now (09:00 IST morning, 19:00 IST evening), given what already ran today. */
export function dueStandup(now: Date, doneToday: readonly MeetingKind[]): "morning" | "evening" | null {
  const h = istHour(now);
  if (h >= 19 && !doneToday.includes("evening")) return "evening";
  if (h >= 9 && h < 19 && !doneToday.includes("morning")) return "morning";
  return null;
}
