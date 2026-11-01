# AI Empire OS — Engineering Standards

Product: AI Empire OS, an autonomous multi-agent business operating system. Founder: Harshit Bhardwaj.
Constraint: ₹0 infrastructure. Free tiers only (GitHub, Vercel Hobby, Supabase Free, local Ollama). Paid credentials are never mandatory.

## Stack
Next.js 16 (App Router, `src/proxy.ts`) · TypeScript strict · Tailwind 4 · Supabase Auth + Postgres (RLS) · Zod 4 · Vitest.

## Architecture rules
- `src/app` renders; `src/modules/<domain>` owns business logic and server actions; `src/lib` holds cross-cutting infrastructure.
- All data access uses the request-scoped Supabase client acting as the signed-in user. RLS is the security boundary; app checks (`requireContext(capability)`) are a second layer, never the only one.
- Never use a service-role key in request paths. Never expose secrets to the browser (only `NEXT_PUBLIC_SUPABASE_*`, which are public by design).
- Schema changes = new timestamped file in `supabase/migrations/` + update `supabase/tests/rls_test.sql` + `src/types/domain.ts`. Never edit an applied migration.
- SECURITY DEFINER functions live in the `private` schema (not exposed by the API) with explicit grants.
- Every AI call goes through `runAgent` (orchestration engine): status, permission and cost checks, persisted execution, bounded retries, audit event. No direct provider calls from pages.
- Risky agent actions (money, external communication, irreversible change, high/critical risk) must route to the Approval Center.
- When a provider or integration is not configured, show it as unavailable/pending. Never fake AI output.
- Validate every input with Zod at the action boundary. Show users only safe errors (`UserFacingError`).

## Pre-execution stress test (mandatory, internal)
Before shipping code, check: edge cases, logic/race conditions, performance, integrations, security & safety (Phase A);
resilience, scalability, compliance with these rules, determinism, final sanity check (Phase B).

## Commands
`npm run typecheck` · `npm test` · `npm run test:db` (needs local Postgres ≥15) · `npm run build` · `npm run check` (all three app checks).

## Founder approval required before
Paid subscriptions, financial transactions, production replacement, destructive database changes,
publishing confidential information, external client communication, account-security changes.

## Output
Concise. End substantive work with **Risk averted** and **Strength applied**.
