import "server-only";
import { env } from "@/lib/env";
import { emailConfigured, sendEmail } from "@/lib/integrations/email";
import { formatInr } from "@/lib/utilities/format";
import { logEvent } from "@/modules/audit/service";
import type { AppContext } from "@/modules/auth/session";
import { companySnapshot, listAgents, runAgent } from "@/modules/orchestration/engine";
import type { AgentWithPermissions, BoardMeeting, BoardMessage, MeetingKind, Mom } from "@/types/domain";
import {
  addressedSeats, cleanSpeech, dueStandup, isPass, istDate, momPrompt, momText, momToPlan, openingPrompt, parseMom, pickBoard, pickTeam,
  replyPrompt, type Seat, type SpokenLine,
} from "./logic";

type A = AgentWithPermissions;
const SPEAKER_BUDGET_MS = 60_000;

async function loadMeeting(ctx: AppContext, id: string): Promise<BoardMeeting> {
  const { data } = await ctx.db.from("board_meetings").select("*").eq("id", id).eq("organisation_id", ctx.organisation.id).single<BoardMeeting>();
  if (!data) throw new Error("Meeting not found");
  return data;
}

async function loadMessages(ctx: AppContext, id: string): Promise<BoardMessage[]> {
  const { data } = await ctx.db.from("board_messages").select("*").eq("meeting_id", id).eq("organisation_id", ctx.organisation.id).order("seq").returns<BoardMessage[]>();
  return data ?? [];
}

/** The people in the room: the C-suite for board meetings and stand-ups, the host and their reports for team meetings. */
export function seatsFor(meeting: Pick<BoardMeeting, "kind" | "host_agent_id">, agents: A[]): Seat<A>[] {
  return meeting.kind === "team" && meeting.host_agent_id ? pickTeam(agents, meeting.host_agent_id) : pickBoard(agents);
}

const lineOf = (m: BoardMessage): SpokenLine => ({ speaker: m.speaker, body: m.body, failed: m.failed, role: m.role });

/** Open follow-ups from the last finished meeting of the same kind (and host), so meetings build on each other. */
async function carryOver(ctx: AppContext, meeting: BoardMeeting): Promise<string> {
  let q = ctx.db.from("board_meetings").select("mom, created_at").eq("organisation_id", ctx.organisation.id).eq("status", "done").neq("id", meeting.id)
    .not("mom", "is", null).order("created_at", { ascending: false }).limit(1);
  q = meeting.kind === "team" && meeting.host_agent_id ? q.eq("host_agent_id", meeting.host_agent_id) : q.in("kind", ["board", "morning", "evening"]);
  const { data } = await q.maybeSingle<{ mom: Mom; created_at: string }>();
  if (!data?.mom) return "";
  const m = data.mom;
  const items = [...m.follow_ups, ...m.action_items.map((a) => `${a.owner}: ${a.task}${a.due ? ` (due ${a.due})` : ""}`)].slice(0, 10);
  return items.length ? `From the last meeting (${istDate(new Date(data.created_at))}) — check progress on:\n${items.map((x) => `- ${x}`).join("\n")}` : "";
}

/** Facts for a stand-up, straight from the system (no guessing). */
async function standupFacts(ctx: AppContext): Promise<string> {
  const org = ctx.organisation.id;
  const since = new Date(Date.now() - 24 * 3600_000).toISOString();
  const base = (table: string) => ctx.db.from(table).select("id", { count: "exact", head: true }).eq("organisation_id", org);
  const count = async (table: string, f: (q: ReturnType<typeof base>) => ReturnType<typeof base>) => (await f(base(table))).count ?? 0;
  const [done, failed, todo, founderOpen, newLeads, pitches, replies, approvals, company] = await Promise.all([
    count("tasks", (q) => q.eq("status", "done").gte("updated_at", since)),
    count("tasks", (q) => q.eq("status", "failed")),
    count("tasks", (q) => q.eq("status", "todo").eq("owner", "agent")),
    count("tasks", (q) => q.eq("owner", "founder").in("status", ["todo", "in_progress"])),
    count("leads", (q) => q.gte("created_at", since)),
    count("leads", (q) => q.eq("status", "pitch_ready")),
    count("leads", (q) => q.eq("status", "replied")),
    count("approvals", (q) => q.eq("status", "pending")),
    companySnapshot(ctx),
  ]);
  return `System facts (last 24 h): tasks finished ${done}, failed ${failed}, waiting for agents ${todo}, Founder's open tasks ${founderOpen}; `
    + `new leads ${newLeads}, pitches awaiting approval ${pitches}, leads who replied ${replies}; approvals pending ${approvals}; net profit so far ${formatInr(company.netProfitCents)}.`;
}

async function nextSeq(ctx: AppContext, meetingId: string): Promise<number> {
  const { data } = await ctx.db.from("board_messages").select("seq").eq("meeting_id", meetingId).eq("organisation_id", ctx.organisation.id).order("seq", { ascending: false }).limit(1).maybeSingle<{ seq: number }>();
  return (data?.seq ?? -1) + 1;
}

async function speakAs(ctx: AppContext, seat: Seat<A>, input: string): Promise<{ text: string | null; error?: string }> {
  const { execution, result } = await runAgent(ctx, {
    agent: seat.agent, kind: "chat", maxTokens: 500, budgetMs: SPEAKER_BUDGET_MS, input,
    parse: (t) => cleanSpeech(t, 2000),
  });
  return result ? { text: result } : { text: null, error: execution.error ?? "no answer" };
}

async function saveLines(ctx: AppContext, meetingId: string, rows: Omit<BoardMessage, "id" | "meeting_id" | "seq" | "created_at">[]): Promise<BoardMessage[]> {
  if (!rows.length) return [];
  const start = await nextSeq(ctx, meetingId);
  const { data } = await ctx.db.from("board_messages")
    .insert(rows.map((r, i) => ({ ...r, organisation_id: ctx.organisation.id, meeting_id: meetingId, seq: start + i }))).select("*").returns<BoardMessage[]>();
  return (data ?? []).sort((a, b) => a.seq - b.seq);
}

/** Opening round: the chair speaks first, then everyone else responds to it at the same time. Idempotent. */
export async function openMeeting(ctx: AppContext, meetingId: string): Promise<BoardMessage[]> {
  const meeting = await loadMeeting(ctx, meetingId);
  if (meeting.status !== "in_progress") return [];
  const [existing, agents] = await Promise.all([loadMessages(ctx, meetingId), listAgents(ctx)]);
  const seats = seatsFor(meeting, agents);
  if (!seats.length) throw new Error("Nobody can attend: activate the CEO (or the team host) in the Agent Registry.");
  const spoke = new Set(existing.filter((m) => m.role === "member" && !m.failed).map((m) => m.agent_id));
  const pending = seats.filter((s) => !spoke.has(s.agent.id));
  if (!pending.length) return [];

  const context = [meeting.kind === "morning" || meeting.kind === "evening" ? await standupFacts(ctx) : "", await carryOver(ctx, meeting)].filter(Boolean).join("\n\n");
  const lines = existing.map(lineOf);
  const out: BoardMessage[] = [];
  const say = async (seat: Seat<A>) => {
    const r = await speakAs(ctx, seat, openingPrompt(seat, meeting.topic, lines, context));
    return { role: "member" as const, agent_id: seat.agent.id, speaker: `${seat.agent.name} · ${seat.title}`, body: r.text ?? `(could not join: ${r.error?.slice(0, 200)})`, failed: !r.text };
  };
  const [chair, ...rest] = pending;
  if (chair && chair === seats[0]) {
    const saved = await saveLines(ctx, meetingId, [await say(chair)]);
    out.push(...saved);
    lines.push(...saved.map(lineOf));
    out.push(...await saveLines(ctx, meetingId, await Promise.all(rest.map(say))));
  } else {
    out.push(...await saveLines(ctx, meetingId, await Promise.all(pending.map(say))));
  }
  return out;
}

/** The Founder speaks; whoever was addressed answers, others add a point only if it matters (everyone else passes). */
export async function founderSays(ctx: AppContext, meetingId: string, text: string, founderName: string): Promise<BoardMessage[]> {
  const meeting = await loadMeeting(ctx, meetingId);
  if (meeting.status !== "in_progress") throw new Error("This meeting has ended");
  const [existing, agents] = await Promise.all([loadMessages(ctx, meetingId), listAgents(ctx)]);
  const seats = seatsFor(meeting, agents);
  const mine = await saveLines(ctx, meetingId, [{ role: "founder", agent_id: null, speaker: founderName, body: text.slice(0, 2000), failed: false }]);
  const lines = [...existing, ...mine].map(lineOf);
  const targets = addressedSeats(text, seats);
  const replies = await Promise.all(seats.map(async (seat) => {
    const addressed = targets.size === 0 ? "all" : targets.has(seat.agent.id) ? "me" : "other";
    const r = await speakAs(ctx, seat, replyPrompt(seat, meeting.topic, lines, text, addressed));
    if (!r.text || isPass(r.text)) return addressed === "me" && !r.text ? { seat, body: `(could not answer: ${r.error?.slice(0, 200)})`, failed: true } : null;
    return { seat, body: r.text, failed: false };
  }));
  const rows = replies.filter((r): r is NonNullable<typeof r> => !!r)
    // The person addressed answers first, then the others in seating order.
    .sort((a, b) => Number(targets.has(b.seat.agent.id)) - Number(targets.has(a.seat.agent.id)))
    .map((r) => ({ role: "member" as const, agent_id: r.seat.agent.id, speaker: `${r.seat.agent.name} · ${r.seat.title}`, body: r.body, failed: r.failed }));
  return [...mine, ...await saveLines(ctx, meetingId, rows)];
}

/** Emails the minutes to the Founder (when a mailbox is connected). */
async function emailMom(ctx: AppContext, meeting: BoardMeeting, mom: Mom): Promise<boolean> {
  const to = env.REPORT_EMAIL ?? ctx.email;
  if (!emailConfigured() || !to) return false;
  const date = istDate(new Date(meeting.created_at));
  await sendEmail({ to, subject: `MOM: ${meeting.topic.slice(0, 80)} (${date})`, text: momText(mom, meeting.topic, date) });
  await ctx.db.from("board_meetings").update({ mom_emailed_at: new Date().toISOString() }).eq("id", meeting.id).eq("organisation_id", ctx.organisation.id);
  return true;
}

/**
 * Ends the meeting: the Scribe writes the minutes, every participant remembers the decisions and their own action items,
 * the minutes are emailed to the Founder, and action items wait as a plan for the Founder's approval.
 */
export async function endMeeting(ctx: AppContext, meetingId: string): Promise<{ mom: Mom | null; emailed: boolean; error?: string }> {
  const meeting = await loadMeeting(ctx, meetingId);
  if (meeting.status === "done" && meeting.mom) return { mom: meeting.mom, emailed: !!meeting.mom_emailed_at };
  const [messages, agents] = await Promise.all([loadMessages(ctx, meetingId), listAgents(ctx)]);
  const seats = seatsFor(meeting, agents);
  const scribe = agents.find((a) => a.name === "Scribe" && a.status === "active") ?? seats[0]?.agent;
  if (!scribe) throw new Error("No note-taker available: activate Scribe in the Agent Registry.");
  const today = istDate(new Date(meeting.created_at));
  const names = seats.map((s) => s.agent.name);

  const { execution, result } = await runAgent(ctx, {
    agent: scribe, kind: "command", json: true, maxTokens: 2500,
    input: momPrompt(meeting.kind, meeting.topic, messages.map(lineOf), seats.map((s) => `${s.agent.name} (${s.title})`), today),
    // Stored on the execution as an executable plan (approved later through the normal governed path) plus the minutes.
    parse: (t) => { const mom = parseMom(t); return { ...(momToPlan(mom, names) ?? { summary: mom.summary, steps: [] }), mom }; },
  });
  if (!result) {
    await ctx.db.from("board_meetings").update({ error: `Minutes failed: ${(execution.error ?? "unknown").slice(0, 400)}` }).eq("id", meetingId).eq("organisation_id", ctx.organisation.id);
    return { mom: null, emailed: false, error: execution.error ?? "Minutes failed" };
  }
  const mom = result.mom;
  await ctx.db.from("board_meetings").update({
    status: "done", ended_at: new Date().toISOString(), mom, summary: mom.summary.slice(0, 4000), mom_execution_id: execution.id,
    plan_execution_id: result.steps.length ? execution.id : null, error: null,
  }).eq("id", meetingId).eq("organisation_id", ctx.organisation.id);
  await saveLines(ctx, meetingId, [{ role: "scribe", agent_id: scribe.id, speaker: `${scribe.name} · Minutes`, body: mom.summary, failed: false }]);

  // Everyone in the room remembers what was decided and what they own — next meetings and tasks build on it.
  await ctx.db.from("agent_memories").insert(seats.map((s) => {
    const own = mom.action_items.filter((a) => a.owner.toLowerCase().startsWith(s.agent.name.toLowerCase())).map((a) => `${a.task}${a.due ? ` (due ${a.due})` : ""}`);
    return {
      organisation_id: ctx.organisation.id, agent_id: s.agent.id, kind: "decision", importance: 4,
      content: `Meeting "${meeting.topic.slice(0, 120)}" on ${today}. Decided: ${mom.decisions.join("; ").slice(0, 900) || mom.summary.slice(0, 600)}.${own.length ? ` My action items: ${own.join("; ").slice(0, 900)}` : ""}`.slice(0, 2000),
    };
  }));
  const emailed = await emailMom(ctx, { ...meeting, mom }, mom).catch((e: Error) => { console.error("[meeting] MOM email failed", e.message); return false; });
  await logEvent(ctx, { action: "meeting.closed", entity: "board_meetings", entityId: meetingId, actorType: "agent", metadata: { kind: meeting.kind, action_items: mom.action_items.length, emailed } });
  return { mom, emailed };
}

export async function resendMom(ctx: AppContext, meetingId: string): Promise<boolean> {
  const meeting = await loadMeeting(ctx, meetingId);
  if (!meeting.mom) throw new Error("This meeting has no minutes yet");
  return emailMom(ctx, meeting, meeting.mom);
}

const STANDUP_TOPIC: Record<"morning" | "evening", string> = {
  morning: "Morning stand-up: aaj ka plan — kal kya hua, aaj har department kya karega, kahan atke hain, Founder se kya chahiye.",
  evening: "Evening review: aaj kya hua — kaunse kaam pure hue, kya atka, kitni leads/pitches/replies, kal ka plan aur Founder ke liye updates.",
};

/** Runs today's morning or evening stand-up once (DB-enforced), from opening to minutes. Used by the autopilot. */
export async function runStandup(ctx: AppContext, kind: "morning" | "evening", now = new Date()): Promise<string | null> {
  const { data, error } = await ctx.db.from("board_meetings")
    .insert({ organisation_id: ctx.organisation.id, topic: STANDUP_TOPIC[kind], kind, meeting_date: istDate(now), created_by: null })
    .select("id").single<{ id: string }>();
  if (error || !data) return null; // already held today (unique per day) or not allowed
  await openMeeting(ctx, data.id);
  const r = await endMeeting(ctx, data.id);
  return r.mom ? `${kind} stand-up held${r.emailed ? " — minutes emailed" : ""}` : `${kind} stand-up held; minutes failed: ${r.error}`;
}

/** Autopilot step: hold the stand-up that is due now (09:00 / 19:00 IST) if it has not happened today. */
export async function runDueStandup(ctx: AppContext, now = new Date()): Promise<string | null> {
  const { data } = await ctx.db.from("board_meetings").select("kind").eq("organisation_id", ctx.organisation.id).eq("meeting_date", istDate(now)).in("kind", ["morning", "evening"]).returns<{ kind: MeetingKind }[]>();
  const due = dueStandup(now, (data ?? []).map((d) => d.kind));
  return due ? runStandup(ctx, due, now) : null;
}
