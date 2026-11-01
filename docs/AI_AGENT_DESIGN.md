# AI Agent Design

## Provider abstraction (`src/lib/ai`)
```ts
interface AiProvider { id; label; model; generate({system, prompt, maxTokens, json, signal}); health(signal) }
```
| Provider | Config | Cost | Health check |
|---|---|---|---|
| Ollama (default, free) | `OLLAMA_BASE_URL`, `OLLAMA_MODEL` | ₹0 | `GET /api/tags`, verifies the model is pulled |
| OpenAI-compatible | `OPENAI_COMPATIBLE_BASE_URL/_MODEL/_API_KEY` | depends on provider | `GET /models` |
| Claude (optional) | `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` (default `claude-haiku-5-5`) | paid | `GET /v1/models` (free, no tokens) |

Selection is `AI_PROVIDER` if configured, otherwise the first configured provider, free first. To add a provider, implement `AiProvider` in `providers/` and register it in `registry.ts`.
Errors are classified: network, timeout, 408, 429 and 5xx are retryable; other 4xx (for example a bad key) fail fast.
**With no provider configured**, every AI control is disabled and labelled "AI execution unavailable". The rest of the app still works. No output is simulated.

## Agents
Agents are database records with a name, designation, tier, role instructions, department, reporting manager, permissions, status and monthly cost limit.
The system prompt is the governance preamble, then identity, then role instructions, then the top 5 memories.
Starter team, seeded per organisation:
- **Atlas** (CEO): strategy, opportunity evaluation, executive reports; delegates to the COO.
- **Orion** (COO): turns strategy into projects and tasks, assigns and tracks.
- **Nova** (CGO): growth experiments; drafts but never sends communication.
- **Ledger** (CFO): budgets and cost control; never moves money.

## Orchestration engine (`runAgent`)
1. Gate: agent active, holds `ai.execute`, monthly cost check.
2. Persist the `agent_executions` row as `running` (provider, model, max attempts).
3. Call the provider with `AbortSignal.timeout(AI_TIMEOUT_MS)`, up to `AI_MAX_ATTEMPTS` attempts with exponential backoff. The attempt count is persisted on every try.
4. Optionally validate output (for example `parsePlan`). Invalid output is retryable.
5. Persist the outcome: output, plan, tokens, cost, timestamps; or `failed` with the error.
6. Write an audit event (`agent.execution_succeeded` or `agent.execution_failed`).

Recovery: `recoverStaleExecutions` marks runs stuck in `queued` or `running` for more than 10 minutes as failed, which covers killed serverless invocations.

## Empire Command
1. The founder writes a natural-language command.
2. The CEO returns JSON matching `planSchema`: 1–10 steps of `create_project | create_task | create_opportunity | request_approval`, each with priority and risk (an unknown risk is treated as `high`).
3. The founder reviews and clicks **Execute plan**. An atomic claim makes execution happen exactly once.
4. Each step goes through `decideStep`: **execute**, **approval** (an Approval Center item carrying the step as payload) or **deny**. Results are stored on the execution and shown inline.
5. Approving an approval that carries an executable step runs that step. Other approval types (for example `finance.spend`) record the decision only, so nothing moves money.

## Task delegation
**Run** on a task: all dependencies must be `done`; the task is atomically claimed (`in_progress`); the assigned agent executes; the task becomes `done` with the result, or `failed` with the error. Failed tasks can be re-run. A summary memory is saved for the agent.

## Executive offices
CEO and COO pages provide an identity card, founder ↔ executive messaging (persisted executions) and executive reports generated from live counts only. The report prompt forbids inventing figures.
