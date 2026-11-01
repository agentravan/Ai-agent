# Implementation Roadmap

## Milestone 1 — Foundation, working preview (this branch)
- [x] Next.js 16 + TS strict + Tailwind 4 initialised; `npm audit` clean
- [x] Supabase schema (20 tables), RLS, triggers, migrations applied to a free project; advisor clean
- [x] Founder authentication, sessions, protected routes, role permissions
- [x] Founder dashboard, CEO office, COO office, agent registry, Empire Command, approvals, audit, projects/tasks, opportunities, settings
- [x] AI provider abstraction (Ollama/Claude/OpenAI-compatible) + governed orchestration
- [x] 40 unit tests + DB RLS suite; production build passing
- [x] Pushed to `feat/ai-empire-os-foundation`; Vercel project created
- [ ] **Founder:** configure Supabase Auth URLs, create founder account, set `FOUNDER_EMAILS` (see DEPLOYMENT_GUIDE)
- [ ] **Founder:** connect an AI provider (Ollama via tunnel, or a free OpenAI-compatible endpoint)

## Milestone 2 — Business operations
- CRM UI (clients, pipeline) on the existing `clients` table
- Finance UI: budgets, income/expense records, budget-vs-actual, agent spend roll-up
- Human employees directory linked to departments
- Notifications centre (table exists) + approval notifications

## Milestone 3 — Autonomy
- Scheduled jobs runner: Vercel Cron (Hobby allows daily) → `/api/cron` protected by `CRON_SECRET`; needs a dedicated least-privilege DB role or Supabase Edge Function instead of user sessions
- Multi-step delegation chains (COO decomposes → workers execute → COO reviews)
- Streaming responses and background execution queue (Supabase Queues / pg_cron) to avoid serverless time limits
- Memory curation and retrieval (pgvector on Supabase free tier)

## Milestone 4 — Team & hardening
- Invite admins/members to an organisation (privileged RPC for role changes)
- E2E browser tests in CI (Playwright) against a Supabase branch
- Rate limiting on auth and command endpoints; CSP with nonces
- Observability: structured logs, error tracking (free tier)
