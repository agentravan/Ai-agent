"use server";

import { z } from "zod";
import { parseForm } from "@/lib/validation/forms";
import { must, runAction, UserFacingError } from "@/lib/utilities/action";
import { requireContext } from "@/modules/auth/session";
import { logEvent } from "@/modules/audit/service";
import { applyPlanOnce, describeOutcomes } from "@/modules/orchestration/apply-once";
import type { BoardMeeting, Execution } from "@/types/domain";
import { runMeeting } from "./service";

const PATH = "/board";
/** Stays under the page's maxDuration (300 s) with headroom. */
const MEETING_BUDGET_MS = 250_000;
const topicSchema = z.object({ topic: z.string().trim().min(3, "Write the agenda for the board").max(2000) });
const idSchema = z.object({ id: z.uuid() });

/** Back to the meeting page; the id is only echoed into the URL when it is a valid UUID. */
const meetingPath = (form: FormData) => {
  const id = String(form.get("id") ?? "");
  return z.uuid().safeParse(id).success ? `${PATH}?id=${id}` : PATH;
};

const describeRun = (r: Awaited<ReturnType<typeof runMeeting>>) =>
  r.status === "done" ? "The board has decided — review the plan and approve it to start work"
    : r.status === "failed" ? "The meeting stopped — see the reason below and press Continue"
      : `${r.spoke} spoke; ${r.pending} still to speak — press Continue meeting`;

/** Starts a meeting and runs it. The board page shows the latest meeting by default, so no id is needed in the redirect. */
export async function startMeetingAction(form: FormData) {
  await runAction(PATH, "Meeting held", async () => {
    const ctx = await requireContext("operate");
    const { topic } = parseForm(topicSchema, form);
    const meeting = must(await ctx.db.from("board_meetings").insert({ organisation_id: ctx.organisation.id, topic, created_by: ctx.userId }).select("id").single<{ id: string }>());
    await logEvent(ctx, { action: "board.meeting_started", entity: "board_meetings", entityId: meeting.id, metadata: { topic } });
    return describeRun(await runMeeting(ctx, meeting.id, MEETING_BUDGET_MS));
  });
}

export async function continueMeetingAction(form: FormData) {
  await runAction(meetingPath(form), "Meeting continued", async () => {
    const ctx = await requireContext("operate");
    const { id } = parseForm(idSchema, form);
    const { data } = await ctx.db.from("board_meetings").update({ status: "in_progress", error: null }).eq("id", id).eq("organisation_id", ctx.organisation.id).neq("status", "done").select("id");
    if (!data?.length) throw new UserFacingError("This meeting is already finished");
    return describeRun(await runMeeting(ctx, id, MEETING_BUDGET_MS));
  });
}

/** Founder approval turns the board's plan into projects and tasks; risky steps still go to the Approval Center. */
export async function approveBoardPlanAction(form: FormData) {
  await runAction(meetingPath(form), "Plan approved", async () => {
    const ctx = await requireContext("govern");
    const { id } = parseForm(idSchema, form);
    const meeting = must(await ctx.db.from("board_meetings").select("*").eq("id", id).eq("organisation_id", ctx.organisation.id).single<BoardMeeting>());
    if (meeting.status !== "done" || !meeting.plan_execution_id) throw new UserFacingError("The board has not produced a plan yet");
    const exec = must(await ctx.db.from("agent_executions").select("*").eq("id", meeting.plan_execution_id).eq("organisation_id", ctx.organisation.id).single<Execution>());
    const outcomes = await applyPlanOnce(ctx, exec);
    if (!outcomes) throw new UserFacingError("This plan was already approved");
    await logEvent(ctx, { action: "board.plan_approved", entity: "board_meetings", entityId: id, metadata: { execution_id: exec.id } });
    return `Approved: ${describeOutcomes(outcomes)}. Press "Start work" in Projects to let the team begin.`;
  });
}
