import "server-only";
import { estimateCostCents, providerChain } from "@/lib/ai/registry";
import { withRetry } from "@/lib/ai/retry";
import { AiError, AiUnavailableError, type AiProvider, type GenerateResult } from "@/lib/ai/types";
import { env } from "@/lib/env";
import { UserFacingError, must } from "@/lib/utilities/action";
import { logEvent } from "@/modules/audit/service";
import type { AppContext } from "@/modules/auth/session";
import type { AgentWithPermissions, Execution } from "@/types/domain";
import { checkAgentCanRun, checkCostLimit, COOL_MS, healthyFirst, maxAttemptsFor, monthStartIso, nextAttemptMs, providerKey, shouldCool, STALE_EXECUTION_MS } from "./policy";
import { pickRecall, recallBlock, type MemoryRow } from "@/modules/learning/logic";
import { domainsFor, pickPassages, playbookBlock, specialistBlock } from "@/modules/knowledge/logic";
import { PLAYBOOKS, SPECIALIST_RULES } from "@/modules/knowledge/catalog";
import { growthStage, upgradeUnlocked } from "@/modules/cockpit/metrics";
import { formatInr } from "@/lib/utilities/format";
import { MISSION, northStarLabel } from "./mission";

export interface CompanySnapshot { netProfitCents: number; northStarCents: number; gateCents: number; northStarUsd: number; usdInrRate: number }

/** Where the company stands against its North Star (used by every agent and by the funding gate). */
export async function companySnapshot(ctx: AppContext): Promise<CompanySnapshot> {
  type OrgGoals = { north_star_target_cents: number; upgrade_profit_gate_cents: number; north_star_usd: number; usd_inr_rate: number };
  const [{ data: org }, { data: money }] = await Promise.all([
    ctx.db.from("organisations").select("north_star_target_cents, upgrade_profit_gate_cents, north_star_usd, usd_inr_rate").eq("id", ctx.organisation.id).maybeSingle<OrgGoals>(),
    ctx.db.from("financial_records").select("kind, amount_cents").eq("organisation_id", ctx.organisation.id).limit(20000).returns<{ kind: string; amount_cents: number }[]>(),
  ]);
  const net = (money ?? []).reduce((s, r) => s + (r.kind === "income" ? 1 : -1) * Number(r.amount_cents), 0);
  const northStarUsd = Number(org?.north_star_usd ?? 100_000_000_000);
  const usdInrRate = Number(org?.usd_inr_rate ?? 95);
  return {
    netProfitCents: net,
    northStarCents: Number(org?.north_star_target_cents ?? Math.round(northStarUsd * usdInrRate * 100)),
    gateCents: Number(org?.upgrade_profit_gate_cents ?? 8_000_000),
    northStarUsd,
    usdInrRate,
  };
}

function goalBriefing(c: CompanySnapshot): string {
  const g = growthStage(c.netProfitCents, c.northStarCents);
  const unlocked = upgradeUnlocked(c.netProfitCents, c.gateCents);
  return `${MISSION}
Company North Star: ${northStarLabel(c.northStarUsd, c.usdInrRate, c.northStarCents)}. Net profit so far: ${formatInr(c.netProfitCents)}.
Next milestone: ${g.next ? `${g.next.label} (${g.pctToNext}% of the way)` : "North Star reached"}. Every plan must move us to the next milestone fastest, using the AI workforce.
Spending rule: ${unlocked ? `the ${formatInr(c.gateCents)} profit gate is crossed — the CFO may propose funding for system upgrades via Founder approval, with expected return.` : `no paid upgrades, tools or spending until net profit reaches ${formatInr(c.gateCents)}; grow with free methods only.`}`;
}

const GOVERNANCE = `You are an AI employee inside AI Empire OS, working for a human founder.
Company reality: the workforce is the AI employees listed in this system plus the Founder. Infrastructure budget is ₹0.
Rules:
- Do the work; don't write essays about doing it. Output the deliverable itself.
- Write for a busy founder: simple words, short bullet points, no jargon, no tables unless asked.
- Reply in the same language and style the Founder used (e.g. Hinglish if they wrote Hinglish).
- Never invent numbers: no revenue projections, prices of competitors, statistics, salaries or hiring plans.
  Only use figures the Founder gave or that appear in the provided data; otherwise say "data needed".
- Never assume humans will be hired, paid tools bought or money spent.
- You cannot spend money, sign agreements or contact external parties yourself; propose those for Founder approval.
- Never claim an action happened unless the system did it.`;

export interface RunOptions<T> {
  agent: AgentWithPermissions;
  kind: Execution["kind"];
  input: string;
  taskId?: string | null;
  json?: boolean;
  maxTokens?: number;
  /** Optional tighter time limit for this run (e.g. one speaker in a multi-step board meeting). */
  budgetMs?: number;
  /** Cap for ONE provider attempt, so a hung provider fails over to the backup inside the budget (live meetings). */
  attemptMs?: number;
  /** Validates/parses output; throw a retryable AiError to make the model try again. */
  parse?: (text: string) => T;
  /**
   * Goldfish run (Design Studio): the model sees only the governance rules, its role and the input —
   * no memories, playbooks, expert rules or company briefing — so it reviews the text as a stranger would.
   */
  fresh?: boolean;
}

export const permissionsOf = (a: AgentWithPermissions) => a.agent_permissions.map((p) => p.permission);

async function monthlySpendCents(ctx: AppContext, agentId: string): Promise<number> {
  const { data } = await ctx.db
    .from("agent_executions")
    .select("cost_cents")
    .eq("agent_id", agentId)
    .eq("organisation_id", ctx.organisation.id)
    .gte("created_at", monthStartIso())
    .returns<{ cost_cents: number | string }[]>();
  return (data ?? []).reduce((sum, r) => sum + Number(r.cost_cents), 0);
}

/** Open Duet-style recall: the notes that share words with this task (plus every standing rule), no AI call. */
async function memoryContext(ctx: AppContext, agentId: string, input: string): Promise<string> {
  const { data } = await ctx.db
    .from("agent_memories")
    .select("kind, content, importance, created_at")
    .eq("agent_id", agentId)
    .eq("organisation_id", ctx.organisation.id)
    .order("created_at", { ascending: false })
    .limit(150)
    .returns<MemoryRow[]>();
  return recallBlock(pickRecall(data ?? [], input));
}

/** Per server instance: providers that just hung or hit a limit are tried last for a minute. */
const coolUntil = new Map<string, number>();

/**
 * Executes one agent run with governance: status + permission + cost checks, a persisted
 * execution record, bounded retries with timeouts, and an audit event. Returns the final record.
 */
export async function runAgent<T = string>(ctx: AppContext, opts: RunOptions<T>): Promise<{ execution: Execution; result: T | null }> {
  const { agent } = opts;
  const perms = permissionsOf(agent);
  const runCheck = checkAgentCanRun(agent, perms);
  if (!runCheck.ok) throw new UserFacingError(`${agent.name}: ${runCheck.reason}`);

  // Main provider first, then configured backups (AI_FALLBACK). Backups get one attempt each so a
  // failover still fits the serverless time limit.
  const chain = healthyFirst(providerChain(), coolUntil, Date.now());
  const provider = chain[0];
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
        // Every provider in the chain may use attempts (main: AI_MAX_ATTEMPTS, each backup: 1). The DB requires attempts <= max_attempts.
        max_attempts: maxAttemptsFor(chain.length, env.AI_MAX_ATTEMPTS),
        provider: provider.id,
        model: provider.model,
        triggered_by: ctx.userId,
        started_at: new Date().toISOString(),
      })
      .select("*")
      .single<Execution>(),
  );

  const identity = `Your identity: ${agent.name}, ${agent.designation} (${agent.tier}).\n${agent.instructions}`;
  let system = `${GOVERNANCE}\n${identity}`;
  if (!opts.fresh) {
    const [memory, company] = await Promise.all([memoryContext(ctx, agent.id, opts.input), companySnapshot(ctx)]);
    // Executive Playbooks: the passages from this agent's own field that match the task (no AI call).
    const fields = domainsFor(agent);
    const playbook = playbookBlock(pickPassages(PLAYBOOKS.playbooks, opts.input, fields));
    // Expert rules: how an experienced specialist in this field decides (bootstrapped guidance for our stage).
    const expert = specialistBlock(SPECIALIST_RULES.rules, fields);
    system = `${GOVERNANCE}\n${goalBriefing(company)}\n${identity}${expert}${memory}${playbook}`;
  }
  const update = (patch: Record<string, unknown>) =>
    ctx.db.from("agent_executions").update(patch).eq("id", execution.id).eq("organisation_id", ctx.organisation.id).select("*").single<Execution>();

  try {
    let totalAttempts = 0;
    let lastError: unknown;
    let firstError: unknown; // the main provider's failure is the one the Founder needs to see
    // One run never outlives the serverless time limit: each attempt gets min(AI_TIMEOUT_MS, time left).
    const deadline = Date.now() + Math.min(env.AI_RUN_BUDGET_MS, opts.budgetMs ?? Infinity);
    const attemptTimeout = () => {
      const ms = nextAttemptMs(deadline - Date.now(), env.AI_TIMEOUT_MS, opts.attemptMs);
      if (ms === null) throw new AiError("AI took too long — out of time for this run; it will retry later", false);
      return ms;
    };
    let done: { value: { out: GenerateResult; parsed: T }; used: AiProvider } | null = null;
    for (const p of chain) {
      if (p !== provider) {
        console.warn("[ai] provider failed, failing over", { from: provider.id, to: p.id });
        await update({ provider: p.id, model: p.model });
      }
      try {
        const { value } = await withRetry(
          async () => {
            const out = await p.generate({
              system,
              prompt: opts.input,
              json: opts.json,
              maxTokens: opts.maxTokens ?? 1500,
              signal: AbortSignal.timeout(attemptTimeout()),
            });
            // An empty answer is a failed attempt, never a finished task (free "thinking" models can spend all tokens reasoning).
            if (!out.text.trim()) throw new AiError(`AI returned an empty answer${out.finishReason ? ` (stopped: ${out.finishReason})` : ""}`, true);
            const parsed = opts.parse ? opts.parse(out.text) : (out.text as unknown as T);
            return { out, parsed };
          },
          { attempts: p === provider ? env.AI_MAX_ATTEMPTS : 1, onAttempt: async () => void (await update({ attempts: Math.min(++totalAttempts, 10) })) },
        );
        done = { value, used: p };
        break;
      } catch (err) {
        lastError = err;
        firstError ??= err;
        if (shouldCool(err)) coolUntil.set(providerKey(p), Date.now() + COOL_MS);
        if (nextAttemptMs(deadline - Date.now(), env.AI_TIMEOUT_MS, opts.attemptMs) === null) break;
      }
    }
    if (!done) {
      if (firstError && lastError !== firstError) {
        throw new Error(`${(firstError as Error).message?.slice(0, 600)} · backups also failed: ${(lastError as Error).message?.slice(0, 300)}`);
      }
      throw lastError;
    }
    const { value, used } = done;
    const final = must(
      await update({
        status: "succeeded",
        attempts: Math.min(totalAttempts, 10),
        provider: used.id,
        model: used.model,
        output: value.out.text,
        plan: opts.parse ? value.parsed : null,
        input_tokens: value.out.inputTokens,
        output_tokens: value.out.outputTokens,
        cost_cents: estimateCostCents(value.out.inputTokens, value.out.outputTokens),
        finished_at: new Date().toISOString(),
      }),
    );
    await logEvent(ctx, { action: "agent.execution_succeeded", entity: "agent_executions", entityId: final.id, actorType: "agent", metadata: { agent_id: agent.id, kind: opts.kind, provider: used.id, ...(used !== provider ? { failed_over_from: provider.id } : {}) } });
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
    .eq("organisation_id", ctx.organisation.id)
    .in("status", ["queued", "running"])
    .lt("updated_at", cutoff);
  // Tasks whose run was cut off stay re-runnable instead of "in progress" forever.
  await ctx.db
    .from("tasks")
    .update({ status: "failed", result: "Interrupted before completion — press Run or Start work to retry." })
    .eq("organisation_id", ctx.organisation.id)
    .eq("status", "in_progress")
    .lt("updated_at", cutoff);
}

const AGENT_COLUMNS = "*, agent_permissions(permission)";

export async function loadAgent(ctx: AppContext, id: string): Promise<AgentWithPermissions> {
  return must(await ctx.db.from("agents").select(AGENT_COLUMNS).eq("id", id).eq("organisation_id", ctx.organisation.id).single<AgentWithPermissions>());
}

export async function loadAgentByTier(ctx: AppContext, tier: "ceo" | "coo"): Promise<AgentWithPermissions | null> {
  const { data } = await ctx.db.from("agents").select(AGENT_COLUMNS).eq("organisation_id", ctx.organisation.id).eq("tier", tier).maybeSingle<AgentWithPermissions>();
  return data;
}

export async function listAgents(ctx: AppContext): Promise<AgentWithPermissions[]> {
  const { data } = await ctx.db.from("agents").select(AGENT_COLUMNS).eq("organisation_id", ctx.organisation.id).order("tier").order("name").returns<AgentWithPermissions[]>();
  return data ?? [];
}
