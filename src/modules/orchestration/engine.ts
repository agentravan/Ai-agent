import "server-only";
import { activeProvider, estimateCostCents } from "@/lib/ai/registry";
import { withRetry } from "@/lib/ai/retry";
import { AiUnavailableError } from "@/lib/ai/types";
import { env } from "@/lib/env";
import { UserFacingError, must } from "@/lib/utilities/action";
import { logEvent } from "@/modules/audit/service";
import type { AppContext } from "@/modules/auth/session";
import type { AgentWithPermissions, Execution } from "@/types/domain";
import { checkAgentCanRun, checkCostLimit, monthStartIso, STALE_EXECUTION_MS } from "./policy";

const GOVERNANCE = `You are an AI employee inside AI Empire OS, working for a human founder.
Rules: be factual and concise; never claim to have performed actions you cannot perform; you cannot spend money,
sign agreements or contact external parties; anything risky must be proposed for founder approval.`;

export interface RunOptions<T> {
  agent: AgentWithPermissions;
  kind: Execution["kind"];
  input: string;
  taskId?: string | null;
  json?: boolean;
  maxTokens?: number;
  /** Validates/parses output; throw a retryable AiError to make the model try again. */
  parse?: (text: string) => T;
}

export const permissionsOf = (a: AgentWithPermissions) => a.agent_permissions.map((p) => p.permission);

async function monthlySpendCents(ctx: AppContext, agentId: string): Promise<number> {
  const { data } = await ctx.db
    .from("agent_executions")
    .select("cost_cents")
    .eq("agent_id", agentId)
    .gte("created_at", monthStartIso())
    .returns<{ cost_cents: number | string }[]>();
  return (data ?? []).reduce((sum, r) => sum + Number(r.cost_cents), 0);
}

async function memoryContext(ctx: AppContext, agentId: string): Promise<string> {
  const { data } = await ctx.db
    .from("agent_memories")
    .select("kind, content")
    .eq("agent_id", agentId)
    .order("importance", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(5)
    .returns<{ kind: string; content: string }[]>();
  return data?.length ? `\nRelevant memory:\n${data.map((m) => `- [${m.kind}] ${m.content.slice(0, 500)}`).join("\n")}` : "";
}

/**
 * Executes one agent run with governance: status + permission + cost checks, a persisted
 * execution record, bounded retries with timeouts, and an audit event. Returns the final record.
 */
export async function runAgent<T = string>(ctx: AppContext, opts: RunOptions<T>): Promise<{ execution: Execution; result: T | null }> {
  const { agent } = opts;
  const perms = permissionsOf(agent);
  const runCheck = checkAgentCanRun(agent, perms);
  if (!runCheck.ok) throw new UserFacingError(`${agent.name}: ${runCheck.reason}`);

  const provider = activeProvider();
  if (!provider) throw new AiUnavailableError();

  const providerIsFree = env.AI_COST_INPUT_CENTS_PER_MTOK === 0 && env.AI_COST_OUTPUT_CENTS_PER_MTOK === 0;
  const cost = checkCostLimit(agent.monthly_cost_limit_cents, await monthlySpendCents(ctx, agent.id), providerIsFree);
  if (!cost.ok) throw new UserFacingError(`${agent.name}: ${cost.reason}`);

  const execution = must(
    await ctx.db
      .from("agent_executions")
      .insert({
        organisation_id: ctx.organisation.id,
        agent_id: agent.id,
        task_id: opts.taskId ?? null,
        kind: opts.kind,
        status: "running",
        input: opts.input,
        max_attempts: env.AI_MAX_ATTEMPTS,
        provider: provider.id,
        model: provider.model,
        triggered_by: ctx.userId,
        started_at: new Date().toISOString(),
      })
      .select("*")
      .single<Execution>(),
  );

  const system = `${GOVERNANCE}\nYour identity: ${agent.name}, ${agent.designation} (${agent.tier}).\n${agent.instructions}${await memoryContext(ctx, agent.id)}`;
  const update = (patch: Record<string, unknown>) =>
    ctx.db.from("agent_executions").update(patch).eq("id", execution.id).select("*").single<Execution>();

  try {
    const { value, attempts } = await withRetry(
      async () => {
        const out = await provider.generate({
          system,
          prompt: opts.input,
          json: opts.json,
          maxTokens: opts.maxTokens ?? 1500,
          signal: AbortSignal.timeout(env.AI_TIMEOUT_MS),
        });
        const parsed = opts.parse ? opts.parse(out.text) : (out.text as unknown as T);
        return { out, parsed };
      },
      { attempts: env.AI_MAX_ATTEMPTS, onAttempt: async (attempts) => void (await update({ attempts })) },
    );
    const final = must(
      await update({
        status: "succeeded",
        attempts,
        output: value.out.text,
        plan: opts.parse ? value.parsed : null,
        input_tokens: value.out.inputTokens,
        output_tokens: value.out.outputTokens,
        cost_cents: estimateCostCents(value.out.inputTokens, value.out.outputTokens),
        finished_at: new Date().toISOString(),
      }),
    );
    await logEvent(ctx, { action: "agent.execution_succeeded", entity: "agent_executions", entityId: final.id, actorType: "agent", metadata: { agent_id: agent.id, kind: opts.kind } });
    return { execution: final, result: value.parsed };
  } catch (err) {
    const message = (err as Error).message?.slice(0, 2000) || "Unknown error";
    const failed = (await update({ status: "failed", error: message, finished_at: new Date().toISOString() })).data ?? execution;
    await logEvent(ctx, { action: "agent.execution_failed", entity: "agent_executions", entityId: execution.id, actorType: "agent", metadata: { agent_id: agent.id, error: message } });
    return { execution: { ...failed, status: "failed", error: message }, result: null };
  }
}

/** Marks executions orphaned by a killed serverless invocation as failed so nothing stays "running" forever. */
export async function recoverStaleExecutions(ctx: AppContext): Promise<void> {
  const cutoff = new Date(Date.now() - STALE_EXECUTION_MS).toISOString();
  await ctx.db
    .from("agent_executions")
    .update({ status: "failed", error: "Execution interrupted before completion (recovered after timeout)", finished_at: new Date().toISOString() })
    .in("status", ["queued", "running"])
    .lt("updated_at", cutoff);
}

const AGENT_COLUMNS = "*, agent_permissions(permission)";

export async function loadAgent(ctx: AppContext, id: string): Promise<AgentWithPermissions> {
  return must(await ctx.db.from("agents").select(AGENT_COLUMNS).eq("id", id).single<AgentWithPermissions>());
}

export async function loadAgentByTier(ctx: AppContext, tier: "ceo" | "coo"): Promise<AgentWithPermissions | null> {
  const { data } = await ctx.db.from("agents").select(AGENT_COLUMNS).eq("tier", tier).maybeSingle<AgentWithPermissions>();
  return data;
}

export async function listAgents(ctx: AppContext): Promise<AgentWithPermissions[]> {
  const { data } = await ctx.db.from("agents").select(AGENT_COLUMNS).order("tier").order("name").returns<AgentWithPermissions[]>();
  return data ?? [];
}
