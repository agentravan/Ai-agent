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

## Virtual Executive Office (Milestone 1.1)
**Structure.** Divisions: Executive & Strategy, Operations, Growth, Finance & Accounts. Business units, each with an accountable Tier-2 manager agent:
- Web Development & Tech → **Vega** (Web Development Lead)
- HR Services & Consulting → **Hera** (HR Services Manager)
- Buyontime E-Commerce → **Mercury** (E-Commerce Operations Manager)

**Tiers.** Tier 1 Associate/Specialist (`worker`) → Tier 2 Team Manager (`manager`) → Tier 3 Senior VP / Division Head (`executive`, plus the CEO/COO C-suite) → Tier 4 Founder (human).

**Escalation ladder** (`decideStep`):
| Situation | Route |
|---|---|
| Low risk, permitted | Executes inside the team |
| Medium risk, permitted | Executes. Logged as `escalation.manager_review` for the assignee's manager; the Founder is not notified |
| High/critical risk, or `finance.*`, `budget.*`, `external.*`, `legal.*`, `policy.*` | Founder Approval Matrix (Approve / Reject / Modify) |
| Missing permission or delegation right | Founder approval, or denied if the agent cannot request approval |

**KRA/KPI.** Every task and project carries a KRA (required in forms). Plan steps resolve their KRA in this order: the named KRA, then the KRA of the assignee's unit, then "Strategic growth". KPI targets are set by the Founder and never by AI.

**CEO Executive Cockpit** (`/dashboard`) has six live-data sections:
1. Executive summary for the last 24h, plus an AI morning briefing
2. Business units
3. Financial headline
4. Real-time virtual desk
5. Strategic think-tank and risks
6. Approval matrix

Briefing, end-of-day and executive reports send the AI only a computed fact sheet (`cockpitFacts`), so figures cannot be invented. Buyontime order data shows "integration pending" until it is connected.

## Sales & Outreach Engine (Cabin D)
1. **Targets:** you add a business type, city and offer (for example, salons in Dallas, website offer). Active targets are hunted daily.
2. **Discovery:** OpenStreetMap supplies real businesses with their public contact tags. Nominatim finds the city and Overpass lists the businesses (free, ODbL, ≤1 request per second, results capped). Leads are de-duplicated by OSM id. For website offers, businesses that already have a website are dropped. Each lead gets a transparent fit score (`scoreLead`).
3. **Qualification (Iris):** reviews up to 8 new leads per run. She decides pitch or skip with a reason, and drafts an email (with opt-out) and a WhatsApp message. Her prompt includes **what past outcomes taught** (`learnFromOutcomes`). Output is schema-validated, and invalid output is retried.
4. **Founder approval:** required before any contact. A database trigger blocks `approved` unless a founder or admin session approves, and blocks `contacted` unless the lead was approved first. "Approve all" makes this one tap.
5. **Sending:** WhatsApp opens `wa.me` with the approved text, so you press send yourself; this respects WhatsApp's rules. Email goes through Resend when configured, otherwise through your mail app.
6. **Learning:** recording replied, won or lost updates conversion stats per category, city and website status. Won leads become active clients in the delivering unit.

Not automated, by design: cold auto-messaging on WhatsApp, Instagram or LinkedIn. It breaks those platforms' terms and gets accounts banned. Social posting needs approved Meta and LinkedIn developer apps.

## Daily email reports
Vercel Cron calls `/api/cron/morning` at 03:30 UTC (09:00 IST) and `/api/cron/evening` at 13:30 UTC (19:00 IST). Both are authenticated with `CRON_SECRET`. The morning run executes one prospecting cycle, then emails the briefing. The evening run emails the wrap-up with CEO recommendations, which use facts only. Jobs use the service-role client with explicit organisation filters on every query. Required settings: `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`, `RESEND_API_KEY`, and optionally `REPORT_EMAIL`.
