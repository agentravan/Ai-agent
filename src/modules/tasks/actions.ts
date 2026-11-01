"use server";

import { idSchema, parseForm, taskSchema, taskUpdateSchema } from "@/lib/validation/forms";
import { must, runAction, UserFacingError } from "@/lib/utilities/action";
import { requireContext } from "@/modules/auth/session";
import { logEvent } from "@/modules/audit/service";
import { revalidatePath } from "next/cache";
import { nextReadyTask, runTask, type TaskRunResult } from "./service";
import type { Task } from "@/types/domain";

const back = (form: FormData) => (String(form.get("return_to") ?? "") === "/projects" ? "/projects" : "/coo");

export async function createTaskAction(form: FormData) {
  await runAction(back(form), "Task created", async () => {
    const ctx = await requireContext("operate");
    const { depends_on, ...task } = parseForm(taskSchema, form);
    const { id } = must(await ctx.db.from("tasks").insert({ ...task, organisation_id: ctx.organisation.id, created_by: ctx.userId }).select("id").single<{ id: string }>());
    if (depends_on) {
      must(await ctx.db.from("task_dependencies").insert({ organisation_id: ctx.organisation.id, task_id: id, depends_on_task_id: depends_on }).select("task_id"));
    }
  });
}

export async function updateTaskAction(form: FormData) {
  await runAction(back(form), "Task updated", async () => {
    const ctx = await requireContext("operate");
    const { id, ...patch } = parseForm(taskUpdateSchema, form);
    must(await ctx.db.from("tasks").update(patch).eq("id", id).select("id").single());
  });
}

/** Runs one specific task with its assigned agent. */
export async function runTaskAction(form: FormData) {
  await runAction(back(form), "Task executed", async () => {
    const ctx = await requireContext("operate");
    const { id } = parseForm(idSchema, form);
    const task = must(await ctx.db.from("tasks").select("*").eq("id", id).single<Task>());
    const r = await runTask(ctx, task);
    if (!r.ok) throw new UserFacingError(r.message);
    return r.message;
  });
}

export interface AutopilotStep { done: boolean; result?: TaskRunResult; next?: { title: string; agent: string } | null; error?: string }

/** Autopilot step for the live "Start work" view: runs the next ready task and reports what comes next. */
export async function autopilotStepAction(projectId: string | null): Promise<AutopilotStep> {
  try {
    const ctx = await requireContext("operate");
    const scope = projectId && /^[0-9a-f-]{36}$/i.test(projectId) ? projectId : undefined;
    const task = await nextReadyTask(ctx, scope);
    if (!task) return { done: true, next: null };
    const result = await runTask(ctx, task).catch((err: Error) => ({ taskId: task.id, title: task.title, agent: "?", ok: false, message: err.message }));
    const upcoming = await nextReadyTask(ctx, scope);
    // A task that failed before running is back in "todo"; stop instead of looping on it in the live view.
    if (!result.ok && upcoming?.id === task.id) {
      revalidatePath("/projects");
      return { done: true, result, next: null };
    }
    const agentName = upcoming?.assigned_agent_id ? (await ctx.db.from("agents").select("name").eq("id", upcoming.assigned_agent_id).maybeSingle<{ name: string }>()).data?.name ?? "agent" : "";
    revalidatePath("/projects");
    revalidatePath("/ceo");
    return { done: !upcoming, result, next: upcoming ? { title: upcoming.title, agent: agentName } : null };
  } catch (err) {
    return { done: true, error: err instanceof Error && !(err.message.startsWith("NEXT_")) ? err.message.slice(0, 300) : "Could not continue" };
  }
}

export async function peekNextTaskAction(projectId: string | null): Promise<{ title: string; agent: string } | null> {
  const ctx = await requireContext("operate");
  const scope = projectId && /^[0-9a-f-]{36}$/i.test(projectId) ? projectId : undefined;
  const t = await nextReadyTask(ctx, scope);
  if (!t) return null;
  const { data } = await ctx.db.from("agents").select("name").eq("id", t.assigned_agent_id!).maybeSingle<{ name: string }>();
  return { title: t.title, agent: data?.name ?? "agent" };
}
