"use server";

import { redirect, unstable_rethrow } from "next/navigation";
import { z } from "zod";
import { PermissionError } from "@/lib/permissions";
import { parseForm, ValidationError } from "@/lib/validation/forms";
import { must, runAction, UserFacingError } from "@/lib/utilities/action";
import { AiError, AiUnavailableError } from "@/lib/ai/types";
import { requireContext } from "@/modules/auth/session";
import { logEvent } from "@/modules/audit/service";
import { applyPlanOnce, describeOutcomes } from "@/modules/orchestration/apply-once";
import { listAgents } from "@/modules/orchestration/engine";
import type { BoardMeeting, BoardMessage, Execution } from "@/types/domain";
import { endMeeting, founderSays, openMeeting, resendMom, runStandup, seatsFor } from "./service";

const PATH = "/board";
const uuid = z.uuid();
const startSchema = z.object({
  kind: z.enum(["board", "team"]).default("board"),
  topic: z.string().trim().min(3, "Write the agenda").max(2000),
  host_agent_id: z.preprocess((v) => (v === "" || v == null ? null : v), z.uuid().nullable()).optional(),
});
const idSchema = z.object({ id: z.uuid() });

type Live = { ok: true; messages: BoardMessage[] } | { ok: false; error: string };
const safe = (err: unknown) =>
  err instanceof UserFacingError || err instanceof AiError || err instanceof AiUnavailableError ? err.message
    : (console.error("[meeting]", err), "Something went wrong — please try again.");

/** Creates a meeting and walks the Founder into the room, where the conversation happens live. */
export async function startMeetingAction(form: FormData) {
  let id = "";
  try {
    const ctx = await requireContext("operate");
    const { kind, topic, host_agent_id } = parseForm(startSchema, form);
    const agents = await listAgents(ctx);
    if (kind === "team" && !host_agent_id) throw new UserFacingError("Choose who leads the team meeting");
    const seats = seatsFor({ kind, host_agent_id: host_agent_id ?? null }, agents);
    if (!seats.length) throw new UserFacingError("Nobody can attend: activate the CEO (or the team leader) in the Agent Registry");
    const meeting = must(await ctx.db.from("board_meetings").insert({
      organisation_id: ctx.organisation.id, topic, kind, host_agent_id: kind === "team" ? host_agent_id : null,
      participant_ids: seats.map((s) => s.agent.id), created_by: ctx.userId,
    }).select("id").single<{ id: string }>());
    id = meeting.id;
    await logEvent(ctx, { action: "meeting.started", entity: "board_meetings", entityId: id, metadata: { kind, topic } });
  } catch (err) {
    unstable_rethrow(err);
    const msg = err instanceof UserFacingError || err instanceof ValidationError || err instanceof PermissionError ? err.message : safe(err);
    redirect(`${PATH}?error=${encodeURIComponent(msg)}`);
  }
  redirect(`${PATH}/${id}`);
}

/** Called by the room when it opens: everyone gives their opening view. */
export async function openMeetingAction(id: string): Promise<Live> {
  try {
    const ctx = await requireContext("operate");
    return { ok: true, messages: await openMeeting(ctx, uuid.parse(id)) };
  } catch (err) {
    return { ok: false, error: safe(err) };
  }
}

/** The Founder speaks in the meeting (typed or spoken). */
export async function askMeetingAction(id: string, text: string): Promise<Live> {
  try {
    const ctx = await requireContext("operate");
    const message = z.string().trim().min(1, "Say something first").max(2000).parse(text);
    const name = ctx.profile.full_name?.split(" ")[0] || "Founder";
    return { ok: true, messages: await founderSays(ctx, uuid.parse(id), message, `${name} · Founder`) };
  } catch (err) {
    return { ok: false, error: err instanceof z.ZodError ? ((err as z.ZodError).issues[0]?.message ?? "Invalid message") : safe(err) };
  }
}

/** Ends the meeting: Scribe writes and emails the minutes. */
export async function endMeetingAction(id: string): Promise<{ ok: boolean; error?: string; emailed?: boolean }> {
  try {
    const ctx = await requireContext("operate");
    const r = await endMeeting(ctx, uuid.parse(id));
    return r.mom ? { ok: true, emailed: r.emailed } : { ok: false, error: r.error ?? "Minutes could not be written — try again" };
  } catch (err) {
    return { ok: false, error: safe(err) };
  }
}

const meetingPath = (form: FormData) => {
  const id = String(form.get("id") ?? "");
  return uuid.safeParse(id).success ? `${PATH}/${id}` : PATH;
};

/** Founder approval turns the minutes' action items into tasks; risky ones still go to the Approval Center. */
export async function approveMomAction(form: FormData) {
  await runAction(meetingPath(form), "Action items approved", async () => {
    const ctx = await requireContext("govern");
    const { id } = parseForm(idSchema, form);
    const meeting = must(await ctx.db.from("board_meetings").select("*").eq("id", id).eq("organisation_id", ctx.organisation.id).single<BoardMeeting>());
    if (!meeting.plan_execution_id) throw new UserFacingError("These minutes have no action items for the team");
    const exec = must(await ctx.db.from("agent_executions").select("*").eq("id", meeting.plan_execution_id).eq("organisation_id", ctx.organisation.id).single<Execution>());
    const outcomes = await applyPlanOnce(ctx, exec);
    if (!outcomes) throw new UserFacingError("These action items were already approved");
    await logEvent(ctx, { action: "meeting.actions_approved", entity: "board_meetings", entityId: id, metadata: { execution_id: exec.id } });
    return `Approved: ${describeOutcomes(outcomes)}. Press "Start work" in Projects to let the team begin.`;
  });
}

export async function emailMomAction(form: FormData) {
  await runAction(meetingPath(form), "Minutes emailed", async () => {
    const ctx = await requireContext("operate");
    const { id } = parseForm(idSchema, form);
    if (!(await resendMom(ctx, id))) throw new UserFacingError("Mailbox not connected — add MAIL_USER / MAIL_PASSWORD in Vercel");
  });
}

/** Holds today's stand-up now (normally the autopilot does this at 09:00 and 19:00 IST). */
export async function runStandupNowAction(form: FormData) {
  await runAction(PATH, "Stand-up held", async () => {
    const ctx = await requireContext("operate");
    const kind = z.enum(["morning", "evening"]).parse(form.get("kind"));
    const r = await runStandup(ctx, kind);
    if (!r) throw new UserFacingError(`Today's ${kind} stand-up has already been held — open it from the list`);
    return r;
  });
}
