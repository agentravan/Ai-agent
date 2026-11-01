"use server";

import { idSchema, parseForm, taskSchema, taskUpdateSchema } from "@/lib/validation/forms";
import { must, runAction, UserFacingError } from "@/lib/utilities/action";
import { requireContext } from "@/modules/auth/session";
import { logEvent } from "@/modules/audit/service";
import { loadAgent, runAgent } from "@/modules/orchestration/engine";
import { checkTaskRunnable } from "@/modules/orchestration/policy";
import type { Task, TaskStatus } from "@/types/domain";

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

/** Delegates a task to its assigned agent: dependency gate → AI run with bounded retries → result recorded. */
export async function runTaskAction(form: FormData) {
  await runAction(back(form), "Task executed", async () => {
    const ctx = await requireContext("operate");
    const { id } = parseForm(idSchema, form);
    const task = must(await ctx.db.from("tasks").select("*").eq("id", id).single<Task>());
    if (!task.assigned_agent_id) throw new UserFacingError("Assign the task to an agent first");

    const { data: deps } = await ctx.db
      .from("task_dependencies")
      .select("tasks!task_dependencies_organisation_id_depends_on_task_id_fkey(status)")
      .eq("task_id", id)
      .returns<{ tasks: { status: TaskStatus } | null }[]>();
    const check = checkTaskRunnable(task.status, (deps ?? []).map((d) => d.tasks?.status ?? "todo"));
    if (!check.ok) throw new UserFacingError(check.reason);

    // Claim the task atomically so two concurrent runs cannot both start it.
    const claimed = await ctx.db.from("tasks").update({ status: "in_progress" }).eq("id", id).eq("status", task.status).select("id");
    if (!claimed.data?.length) throw new UserFacingError("Task was started by someone else");

    const agent = await loadAgent(ctx, task.assigned_agent_id);
    let execution;
    try {
      ({ execution } = await runAgent(ctx, {
        agent,
        kind: "task",
        taskId: id,
        input: `Task: ${task.title}\nPriority: ${task.priority}\n${task.description ?? ""}\n\nComplete this task. Return your deliverable, then a short "Next steps" list. If the task needs money, external contact or other risky action, describe the proposal instead of claiming it was done.`,
      }));
    } catch (err) {
      await ctx.db.from("tasks").update({ status: task.status }).eq("id", id); // release claim
      throw err;
    }
    const ok = execution.status === "succeeded";
    await ctx.db.from("tasks").update({ status: ok ? "done" : "failed", result: ok ? execution.output : `Failed: ${execution.error}` }).eq("id", id);
    if (ok && execution.output) {
      await ctx.db.from("agent_memories").insert({ organisation_id: ctx.organisation.id, agent_id: agent.id, kind: "summary", content: `Completed "${task.title}": ${execution.output.slice(0, 600)}`, importance: 2 });
    }
    await logEvent(ctx, { action: ok ? "task.completed" : "task.failed", entity: "tasks", entityId: id, actorType: "agent", metadata: { agent_id: agent.id, execution_id: execution.id } });
    if (!ok) throw new UserFacingError(`${agent.name} could not complete the task: ${execution.error}`);
    return `${agent.name} completed the task`;
  });
}
