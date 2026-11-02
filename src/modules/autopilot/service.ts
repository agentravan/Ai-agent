import "server-only";
import { providerChain } from "@/lib/ai/registry";
import { env } from "@/lib/env";
import { emailConfigured, sendEmail } from "@/lib/integrations/email";
import { logEvent } from "@/modules/audit/service";
import type { AppContext } from "@/modules/auth/session";
import { recoverStaleExecutions } from "@/modules/orchestration/engine";
import { checkDueKeywords } from "@/modules/rank/service";
import { runReadyTasks } from "@/modules/tasks/service";
import { alertProblems, autoRetryDecision, isEventfulCycle, shouldAlert, type AutopilotSummary } from "./policy";

/** Puts failed tasks back in the queue (bounded retries with backoff). Counts tasks that have used up their retries. */
export async function requeueFailedTasks(ctx: AppContext, now = new Date()): Promise<{ requeued: number; exhausted: number }> {
  const org = ctx.organisation.id;
  const { data: tasks } = await ctx.db
    .from("tasks")
    .select("id, updated_at")
    .eq("organisation_id", org)
    .eq("status", "failed")
    .not("assigned_agent_id", "is", null)
    .order("updated_at")
    .limit(50)
    .returns<{ id: string; updated_at: string }[]>();
  if (!tasks?.length) return { requeued: 0, exhausted: 0 };

  const { data: runs } = await ctx.db
    .from("agent_executions")
    .select("task_id, finished_at, created_at")
    .eq("organisation_id", org)
    .eq("kind", "task")
    .eq("status", "failed")
    .in("task_id", tasks.map((t) => t.id))
    .returns<{ task_id: string; finished_at: string | null; created_at: string }[]>();

  const history = new Map<string, { count: number; last: number }>();
  for (const r of runs ?? []) {
    const at = Date.parse(r.finished_at ?? r.created_at);
    const h = history.get(r.task_id) ?? { count: 0, last: 0 };
    history.set(r.task_id, { count: h.count + 1, last: Math.max(h.last, at) });
  }

  let requeued = 0;
  let exhausted = 0;
  for (const t of tasks) {
    const h = history.get(t.id);
    const lastFailure = new Date(h?.last || Date.parse(t.updated_at));
    const decision = autoRetryDecision(h?.count ?? 0, lastFailure, now);
    if (!decision.retry) {
      if (decision.reason === "exhausted") exhausted++;
      continue;
    }
    // Atomic: only requeue if nobody (Founder or another run) changed it meanwhile.
    const { data } = await ctx.db.from("tasks").update({ status: "todo" }).eq("id", t.id).eq("organisation_id", org).eq("status", "failed").select("id");
    if (data?.length) {
      requeued++;
      await logEvent(ctx, { action: "task.auto_retry_queued", entity: "tasks", entityId: t.id, actorType: "agent", metadata: { failed_runs: h?.count ?? 0 } });
    }
  }
  return { requeued, exhausted };
}

async function countReadyTasks(ctx: AppContext): Promise<number> {
  const { count } = await ctx.db
    .from("tasks")
    .select("id", { count: "exact", head: true })
    .eq("organisation_id", ctx.organisation.id)
    .eq("status", "todo")
    .not("assigned_agent_id", "is", null);
  return count ?? 0;
}

async function maybeAlert(ctx: AppContext, summary: AutopilotSummary, now: Date): Promise<boolean> {
  const problems = alertProblems(summary);
  if (!problems.length || !emailConfigured()) return false;
  const { data: last } = await ctx.db
    .from("audit_logs")
    .select("created_at")
    .eq("organisation_id", ctx.organisation.id)
    .eq("action", "autopilot.alert_sent")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ created_at: string }>();
  if (!shouldAlert(problems.length, last ? new Date(last.created_at) : null, now)) return false;

  const to = env.REPORT_EMAIL ?? ctx.email;
  if (!to) return false;
  const text = `AI Empire OS autopilot needs your attention:\n\n${problems.map((p) => `- ${p}`).join("\n")}\n\nEverything else keeps running on its own. You will get at most one of these emails every 12 hours.`;
  try {
    await sendEmail({ to, subject: "AI Empire OS: autopilot needs you", text });
  } catch (err) {
    console.error("[autopilot] alert email failed", (err as Error).message);
    return false;
  }
  await logEvent(ctx, { action: "autopilot.alert_sent", entity: "organisations", entityId: ctx.organisation.id, actorType: "agent", metadata: { problems } });
  return true;
}

/**
 * One self-running, self-healing cycle for an organisation:
 * recover stuck runs → requeue failed tasks (bounded, with backoff) → work ready tasks within the time budget
 * → email the Founder only if something needs a human. Risky actions still route to the Approval Center via runAgent/plans.
 */
export async function runAutopilot(ctx: AppContext, budgetMs: number, now = new Date()): Promise<AutopilotSummary & { alerted: boolean }> {
  const started = Date.now();
  await recoverStaleExecutions(ctx);
  const { requeued, exhausted } = await requeueFailedTasks(ctx, now);

  const aiConfigured = providerChain().length > 0;
  const results = aiConfigured ? await runReadyTasks(ctx, budgetMs - (Date.now() - started)) : [];
  const succeeded = results.filter((r) => r.ok).length;

  // Daily Google rank checks (only when a Places key is set and time is left). Never blocks the cycle.
  if (budgetMs - (Date.now() - started) > 30_000) {
    await checkDueKeywords(ctx, now).catch((err: Error) => console.error("[autopilot] rank checks failed", err.message));
  }

  const summary: AutopilotSummary = {
    requeued,
    needsFounder: exhausted,
    ran: results.length,
    succeeded,
    failed: results.length - succeeded,
    waitingForAi: aiConfigured ? 0 : await countReadyTasks(ctx),
    aiConfigured,
  };
  if (isEventfulCycle(summary)) {
    await logEvent(ctx, { action: "autopilot.cycle", entity: "organisations", entityId: ctx.organisation.id, actorType: "agent", metadata: { ...summary } });
  }
  const alerted = await maybeAlert(ctx, summary, now);
  return { ...summary, alerted };
}
