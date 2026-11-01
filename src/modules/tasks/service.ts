import "server-only";
import { UserFacingError } from "@/lib/utilities/action";
import { logEvent } from "@/modules/audit/service";
import type { AppContext } from "@/modules/auth/session";
import { loadAgent, runAgent } from "@/modules/orchestration/engine";
import { checkTaskRunnable } from "@/modules/orchestration/policy";
import type { Task, TaskStatus } from "@/types/domain";

export interface TaskRunResult { taskId: string; title: string; agent: string; ok: boolean; message: string }

const TASK_PROMPT = (t: Task, projectName: string | null) => `Task: ${t.title}
${projectName ? `Project: ${projectName}\n` : ""}Priority: ${t.priority}
${t.description ?? ""}

Produce the actual deliverable now (the plan, copy, checklist, page content, research method, etc.) — not a description of what you would do.
Keep it practical and short (max ~250 words unless the deliverable needs more). End with "Next:" and 1-3 bullets.
If something needs money, client contact or data you don't have, say exactly what the Founder must provide or approve.`;

async function dependencyStatuses(ctx: AppContext, taskId: string): Promise<TaskStatus[]> {
  const { data } = await ctx.db
    .from("task_dependencies")
    .select("tasks!task_dependencies_organisation_id_depends_on_task_id_fkey(status)")
    .eq("organisation_id", ctx.organisation.id)
    .eq("task_id", taskId)
    .returns<{ tasks: { status: TaskStatus } | null }[]>();
  return (data ?? []).map((d) => d.tasks?.status ?? "todo");
}

/** Delegates one task to its assigned agent: dependency gate → atomic claim → AI run → result recorded. */
export async function runTask(ctx: AppContext, task: Task): Promise<TaskRunResult> {
  if (!task.assigned_agent_id) throw new UserFacingError("Assign the task to an agent first");
  const check = checkTaskRunnable(task.status, await dependencyStatuses(ctx, task.id));
  if (!check.ok) throw new UserFacingError(check.reason);

  const claimed = await ctx.db.from("tasks").update({ status: "in_progress" }).eq("id", task.id).eq("organisation_id", ctx.organisation.id).eq("status", task.status).select("id");
  if (!claimed.data?.length) throw new UserFacingError("Task was started by someone else");

  const agent = await loadAgent(ctx, task.assigned_agent_id);
  const { data: project } = task.project_id
    ? await ctx.db.from("projects").select("name").eq("id", task.project_id).eq("organisation_id", ctx.organisation.id).maybeSingle<{ name: string }>()
    : { data: null };
  let execution;
  try {
    ({ execution } = await runAgent(ctx, { agent, kind: "task", taskId: task.id, maxTokens: 1800, input: TASK_PROMPT(task, project?.name ?? null) }));
  } catch (err) {
    await ctx.db.from("tasks").update({ status: task.status }).eq("id", task.id).eq("organisation_id", ctx.organisation.id); // release claim
    throw err;
  }
  const ok = execution.status === "succeeded";
  await ctx.db.from("tasks").update({ status: ok ? "done" : "failed", result: ok ? execution.output : `Failed: ${execution.error}` }).eq("id", task.id).eq("organisation_id", ctx.organisation.id);
  if (ok && execution.output) {
    await ctx.db.from("agent_memories").insert({ organisation_id: ctx.organisation.id, agent_id: agent.id, kind: "summary", content: `Completed "${task.title}": ${execution.output.slice(0, 600)}`, importance: 2 });
  }
  await logEvent(ctx, { action: ok ? "task.completed" : "task.failed", entity: "tasks", entityId: task.id, actorType: "agent", metadata: { agent_id: agent.id, execution_id: execution.id } });
  return { taskId: task.id, title: task.title, agent: agent.name, ok, message: ok ? `${agent.name} finished "${task.title}"` : `${agent.name} could not finish "${task.title}": ${execution.error}` };
}

const PRIORITY_RANK = { critical: 0, high: 1, medium: 2, low: 3 } as const;

/** Picks the next task that can run now: assigned to an active agent, not started, all dependencies done. */
export async function nextReadyTask(ctx: AppContext, projectId?: string): Promise<Task | null> {
  let q = ctx.db.from("tasks").select("*, agents!tasks_organisation_id_assigned_agent_id_fkey(status)").eq("organisation_id", ctx.organisation.id)
    .eq("status", "todo").not("assigned_agent_id", "is", null).order("created_at").limit(100);
  if (projectId) q = q.eq("project_id", projectId);
  const { data } = await q.returns<(Task & { agents: { status: string } | null })[]>();
  const candidates = (data ?? []).filter((t) => t.agents?.status === "active")
    .sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || a.created_at.localeCompare(b.created_at));
  for (const t of candidates) {
    if (checkTaskRunnable(t.status, await dependencyStatuses(ctx, t.id)).ok) {
      const { agents: _agents, ...task } = t;
      return task;
    }
  }
  return null;
}

/** Autopilot: works through ready tasks until the time budget is used (fits serverless limits). */
export async function runReadyTasks(ctx: AppContext, budgetMs: number, projectId?: string, worstCaseTaskMs = 130_000): Promise<TaskRunResult[]> {
  const started = Date.now();
  const results: TaskRunResult[] = [];
  // Only start a task if a slow run can still finish inside the budget.
  while (Date.now() - started + worstCaseTaskMs <= budgetMs) {
    const task = await nextReadyTask(ctx, projectId);
    if (!task) break;
    results.push(await runTask(ctx, task).catch((err: Error) => ({ taskId: task.id, title: task.title, agent: "?", ok: false, message: err.message })));
  }
  return results;
}
