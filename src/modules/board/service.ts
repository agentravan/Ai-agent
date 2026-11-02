import "server-only";
import { AiError } from "@/lib/ai/types";
import { logEvent } from "@/modules/audit/service";
import type { AppContext } from "@/modules/auth/session";
import { listKras } from "@/modules/orchestration/apply-once";
import { listAgents, runAgent } from "@/modules/orchestration/engine";
import { parsePlan } from "@/modules/orchestration/plan";
import type { BoardMeeting, BoardMessage } from "@/types/domain";
import { cleanSpeech, CLOSING_SEQ, closingPrompt, pickBoard, ROLE_TITLE, speakerPrompt, type SpokenLine } from "./logic";

/** Leave time for the closing plan before the platform's time limit. */
const CLOSING_RESERVE_MS = 70_000;

/**
 * Runs the meeting forward until done or out of time: each board member speaks once (members who already spoke are
 * skipped; failed turns are retried), then the CEO closes with a governed plan. Safe to call again to continue.
 */
export async function runMeeting(ctx: AppContext, meetingId: string, budgetMs: number): Promise<{ status: BoardMeeting["status"]; spoke: number; pending: number }> {
  const started = Date.now();
  const left = () => budgetMs - (Date.now() - started);
  const org = ctx.organisation.id;
  const [{ data: meeting }, { data: existing }, agents] = await Promise.all([
    ctx.db.from("board_meetings").select("*").eq("id", meetingId).eq("organisation_id", org).single<BoardMeeting>(),
    ctx.db.from("board_messages").select("*").eq("meeting_id", meetingId).eq("organisation_id", org).order("seq").returns<BoardMessage[]>(),
    listAgents(ctx),
  ]);
  if (!meeting) throw new Error("Meeting not found");
  if (meeting.status === "done") return { status: "done", spoke: 0, pending: 0 };

  const board = pickBoard(agents);
  if (!board.length || board[0]!.role !== "ceo") throw new AiError("The board needs an active CEO. Activate Atlas in the Agent Registry.", false);
  const bySeq = new Map((existing ?? []).map((m) => [m.seq, m]));
  const lines = (): SpokenLine[] => [...bySeq.values()].filter((m) => m.seq !== CLOSING_SEQ).sort((a, b) => a.seq - b.seq);

  const save = async (seq: number, row: Pick<BoardMessage, "agent_id" | "speaker" | "body" | "failed">) => {
    const { data } = await ctx.db.from("board_messages")
      .upsert({ organisation_id: org, meeting_id: meetingId, seq, ...row }, { onConflict: "meeting_id,seq" }).select("*").single<BoardMessage>();
    if (data) bySeq.set(seq, data);
  };

  let spoke = 0;
  for (const [seq, { role, agent }] of board.entries()) {
    if (bySeq.get(seq) && !bySeq.get(seq)!.failed) continue;
    if (left() < CLOSING_RESERVE_MS) break;
    const { execution, result } = await runAgent(ctx, {
      agent, kind: "chat", maxTokens: 600,
      input: speakerPrompt(role, meeting.topic, lines()),
      parse: (t) => { const s = cleanSpeech(t); if (s.length < 2) throw new AiError("Empty reply", true); return s; },
    });
    const speaker = `${agent.name} · ${ROLE_TITLE[role]}`;
    await save(seq, result
      ? { agent_id: agent.id, speaker, body: result, failed: false }
      : { agent_id: agent.id, speaker, body: `Could not speak: ${(execution.error ?? "unknown error").slice(0, 300)}`, failed: true });
    if (result) spoke++;
  }

  const pending = board.filter((_, seq) => !bySeq.get(seq) || bySeq.get(seq)!.failed).length;
  if (pending > 0 && left() < CLOSING_RESERVE_MS) return { status: "in_progress", spoke, pending };
  if (!lines().some((l) => !l.failed)) {
    await ctx.db.from("board_meetings").update({ status: "failed", error: "No board member could speak — check the AI provider in Settings." }).eq("id", meetingId).eq("organisation_id", org);
    return { status: "failed", spoke, pending };
  }
  if (left() < CLOSING_RESERVE_MS - 10_000) return { status: "in_progress", spoke, pending };

  // CEO closes the meeting with a plan (same governed format as Empire Command; nothing runs until the Founder approves).
  const ceo = board[0]!.agent;
  const kras = await listKras(ctx);
  const roster = agents.filter((a) => a.status === "active").map((a) => `${a.name} (${a.designation})`).join(", ");
  const { execution, result } = await runAgent(ctx, {
    agent: ceo, kind: "command", json: true, maxTokens: 2500,
    input: closingPrompt(meeting.topic, lines(), roster, kras.map((k) => k.name).join(", ")),
    parse: parsePlan,
  });
  if (!result) {
    await ctx.db.from("board_meetings").update({ status: "failed", error: `Closing plan failed: ${(execution.error ?? "unknown").slice(0, 400)}` }).eq("id", meetingId).eq("organisation_id", org);
    return { status: "failed", spoke, pending };
  }
  await save(CLOSING_SEQ, { agent_id: ceo.id, speaker: `${ceo.name} · Decisions`, body: cleanSpeech(result.summary, 4000), failed: false });
  await ctx.db.from("board_meetings").update({ status: "done", summary: result.summary.slice(0, 4000), plan_execution_id: execution.id, error: null })
    .eq("id", meetingId).eq("organisation_id", org);
  await logEvent(ctx, { action: "board.meeting_closed", entity: "board_meetings", entityId: meetingId, actorType: "agent", metadata: { steps: result.steps.length, execution_id: execution.id } });
  return { status: "done", spoke, pending: 0 };
}
