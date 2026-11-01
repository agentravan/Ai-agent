# Architecture

```
Browser ──HTTPS──► Vercel (Next.js 16 App Router)
                     ├─ src/proxy.ts            session refresh + route gate (401 for /api, redirect for pages)
                     ├─ Server Components       read via request-scoped Supabase client (user JWT → RLS)
                     ├─ Server Actions          Zod-validated mutations → runAction() flash/redirect
                     └─ modules/orchestration   governed agent runs ──► AI provider adapter (Ollama | Claude | OpenAI-compatible)
                                     │
                                     ▼
                     Supabase: Auth + Postgres (RLS, triggers, append-only audit)
```

## Layout
| Path | Responsibility |
|---|---|
| `src/app/(app)/*` | Protected pages: dashboard, command, ceo, coo, workforce, projects, opportunities, approvals, audit, settings |
| `src/app/login`, `src/app/auth/callback` | Founder sign-in/sign-up, email confirmation code exchange |
| `src/app/api/health`, `src/app/api/ai/status` | Public liveness probe (booleans only) and authenticated AI probe |
| `src/modules/<domain>/actions.ts` | Server actions per domain (agents, tasks, projects, opportunities, approvals, command, ceo) |
| `src/modules/orchestration` | `plan.ts` (schema), `policy.ts` (pure governance rules), `engine.ts` (runAgent), `apply.ts` (plan/approval execution) |
| `src/modules/auth/session.ts` | `resolveContext()` (cached per request) and `requireContext(capability)` |
| `src/modules/audit/service.ts` | Semantic audit events + queries |
| `src/lib/ai` | Provider interface, adapters, registry/status, retry, HTTP error classification |
| `src/lib/database` | Supabase server client and proxy session helper |
| `src/lib/permissions`, `src/lib/validation`, `src/lib/utilities` | Role capabilities and agent permissions, Zod form schemas, action runner and formatting |
| `src/types/domain.ts` | Row types mirroring the schema |
| `supabase/migrations`, `supabase/tests` | Source of truth for schema/RLS plus a local Postgres test suite |

## Key decisions
1. **Supabase client + RLS instead of Prisma.** Prisma connects as a privileged role, which bypasses RLS, and it needs the database password as a serverless secret. Using supabase-js with the user's JWT makes Postgres enforce tenant isolation on every query. Deployment needs only two public values. Prisma can't express RLS policies, so SQL migrations are the single source of truth.
2. **Server Actions + redirect flash messages.** Forms work without client JS. Errors are mapped to safe messages (`UserFacingError`); internals are logged server-side only.
3. **Governance as pure functions.** `policy.ts` has no I/O, so permission, cost, approval and dependency rules are fully unit-tested and deterministic.
4. **Defence in depth.** UI hides what a role can't do, actions call `requireContext(capability)`, and RLS plus constraints and triggers enforce it in the database.
5. **Free-first AI.** Provider order is Ollama, then OpenAI-compatible, then Claude. Paid usage needs an explicit per-agent budget.

## Not yet built (schema exists)
CRM, finance, employees, notifications and scheduled jobs have tables and RLS but no UI yet. See `IMPLEMENTATION_ROADMAP.md`.
