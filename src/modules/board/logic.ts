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

/** How each person behaves in a room — like experienced Indian executives, not chatbots. */
const PERSONALITY: Record<BoardRole, string> = {
  ceo: "the chair: calm, decisive, sees the big picture; you frame the discussion, make the call when views differ, and hand the floor to the right person by name",
  coo: "practical and fast: you think in owners, deadlines and next steps; you push back on vague plans",
  cfo: "careful with money and blunt about it: cash first, no spending before the profit gate; you question numbers that have no basis",
  legal: "precise and calm: you flag only real legal risks, say plainly what is allowed and on what conditions, and suggest the lawful way to do it",
  member: "a hands-on team lead: you speak about your own work — what is done, what is blocked, what you need",
};

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
  const spoken = lines.filter((l) => !l.failed); // includes Idea Court verdicts recorded during the meeting
  if (!spoken.length) return "(nobody has spoken yet)";
  const text = spoken.map((l) => `${l.speaker}: ${l.body}`).join("\n\n");
  return text.length > max ? `…${text.slice(-max)}` : text;
}

/** Meeting etiquette: what makes it sound like people, not a chatbot. */
function talk(founder: string, people: readonly string[] = []): string {
  return `THIS IS SPOKEN, LIVE, ACROSS A TABLE — not a report, not a chat answer. (Ignore any bullet-point rule: you are talking.)
Sound like a real Indian business person, not an AI:
- ONE point per turn, 1–3 short sentences, under 45 words. Stop when the point is made — others will ask if they want more.
- Everyday Hinglish, the way you'd talk to a friend who runs a business. No jargon or acronyms (no "MSA", "HSN", "DPDP", "ROI", "leverage", "synergy").
- Don't start with someone's name every time, don't summarise, don't list steps, no "Founder,", no "great point", no closing lines.
- Small human touches are fine: "dekho", "honestly", "ek minute", "haan, but…". Disagree when you disagree.
- Only real people exist: ${[founder, ...people].join(", ")}. Never invent colleagues, tools, clients, prices or results.
- If you need data, ask one short question instead of guessing.
Examples of how people actually talk here:
GOOD: "Dekho, India mein cold calls pe reply nahi aa raha — data clear hai. Main ek hafta US salons try karna chahunga, email se."
GOOD: "Haan, but payment pehle lena. Half advance, baaki delivery pe."
BAD (AI-like): "Great question, Founder! Here is a comprehensive 5-step plan: 1) Lead generation via…"`;
}

/** Each member's first turn. The chair opens the meeting; the others respond to the chair. */
export function openingPrompt(seat: { role: BoardRole; title: string }, agenda: string, lines: readonly SpokenLine[], context = "", founder = "Founder", chair = false, people: readonly string[] = []): string {
  const job = chair
    ? `You are chairing. Say in a sentence why we're here and your honest first take, then ask one colleague a direct question by name.`
    : `React to what was just said from your side (${ROLE_LENS[seat.role]}) — the one risk or profit point that matters most and is new.`;
  return `Live meeting. You are ${seat.title} — ${PERSONALITY[seat.role]}. ${founder} (the Founder) is in the room. Agenda: """${agenda}"""${context ? `\n\nContext:\n${context}` : ""}

Said so far:
${transcript(lines)}

${job}
${talk(founder, people)}`;
}

/** Answering the Founder during the meeting. */
export function replyPrompt(seat: { role: BoardRole; title: string }, agenda: string, lines: readonly SpokenLine[], founderMessage: string, addressed: "me" | "other" | "all", founder = "Founder", people: readonly string[] = []): string {
  const rule = addressed === "me"
    ? `${founder} is asking YOU. Answer directly first, then your advice.`
    : `Someone else is answering. Reply exactly PASS — unless there is a serious point from your lens (a real risk, a cost, a legal problem) that would otherwise be missed; then say it in one or two sentences.`;
  return `Live meeting. You are ${seat.title} — ${PERSONALITY[seat.role]}. Agenda: """${agenda}"""

Conversation so far:
${transcript(lines)}

${founder} just said: """${founderMessage}"""
${rule}
${talk(founder, people)}`;
}

/** Topic words that tell the room whose question it is when nobody is named. */
const TOPIC: Partial<Record<BoardRole, RegExp>> = {
  cfo: /\b(price|pricing|paisa|paise|rupe|₹|cost|kharch|budget|profit|margin|revenue|invoice|payment|cash|fee|rate|kitna)/i,
  legal: /\b(legal|law|kanoon|contract|agreement|gst|tax|privacy|data|spam|compliance|license|licence|terms|policy)/i,
  coo: /\b(kaise karen|kaise karein|process|execute|execution|team|kab tak|deadline|timeline|kaam|task|setup|deliver|tools?|automation)/i,
};

/** Small talk and meeting mechanics: only the chair replies, like a real chairperson would. */
const SMALL_TALK = /^(hi|hello|hey|namaste|ok|okay|theek|thik|haan|ha|yes|no|nahi|thanks|thank you|shukriya|good|achha|acha)\b|awaaz|aawaz|voice|sun (pa )?rahe|audible|can you hear|mic\b/i;

/**
 * Who should answer the Founder: people named (or whose topic it is) must answer; for a general question the chair
 * answers and the others may add a serious point; for small talk only the chair replies (others are not even asked).
 */
export function routeTurn<A extends { id: string; name: string }>(message: string, seats: readonly Seat<A>[]): { answer: string[]; may: string[] } {
  const named = [...addressedSeats(message, seats)];
  const ids = seats.map((s) => s.agent.id);
  const chair = ids[0];
  if (named.length) return { answer: named, may: ids.filter((id) => !named.includes(id)) };
  if (SMALL_TALK.test(message.trim()) && message.trim().split(/\s+/).length <= 8) return { answer: chair ? [chair] : [], may: [] };
  const topical = seats.filter((s) => TOPIC[s.role]?.test(message)).map((s) => s.agent.id);
  const answer = topical.length ? topical : chair ? [chair] : [];
  return { answer, may: ids.filter((id) => !answer.includes(id)) };
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

/** What the room sees when someone could not answer: plain words, not provider JSON (details stay in the run log). */
export function friendlyFailure(error: string | null | undefined): string {
  const e = (error ?? "").toLowerCase();
  if (/401|403|cookie auth|api key|unauthor/.test(e)) return "(AI key problem — couldn't answer. Check the AI keys in Settings.)";
  if (/429|rate.?limit|quota|per-day|free-models/.test(e)) return "(AI free limit reached for now — try again later or add the Gemini key.)";
  if (/503|overload|upstream|unavailable/.test(e)) return "(AI is overloaded right now — try again in a minute.)";
  if (/time|abort/.test(e)) return "(Took too long to think — ask again.)";
  return "(Couldn't answer just now — try again.)";
}

export const isPass = (text: string) => /^\W*pass\W*$/i.test(text.trim()) || text.trim().length < 3;

/**
 * Keeps a spoken turn short and natural: strips list markers and cuts at a sentence end within the limit,
 * so nobody is cut off mid-word or reads out a numbered plan.
 */
export function spoken(text: string, maxChars = 320): string {
  let t = cleanSpeech(text, 4000)
    .replace(/^(founder|harshit)\s*[,:—-]\s*/i, "")
    .replace(/^\s*(?:[-*•]|\d{1,2}[.)])\s+/gm, "") // list markers at line start
    .replace(/(^|[.!?]\s+)\d{1,2}[.)]\s+/g, "$1") // "… 2. Next" spoken inline
    .replace(/\s*\n+\s*/g, " ")
    .trim();
  if (t.length <= maxChars) return t;
  const cut = t.slice(0, maxChars);
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("? "), cut.lastIndexOf("! "), cut.lastIndexOf("। "));
  t = end > maxChars * 0.35 ? cut.slice(0, end + 1) : `${cut.slice(0, cut.lastIndexOf(" "))}…`;
  return t.trim();
}

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
