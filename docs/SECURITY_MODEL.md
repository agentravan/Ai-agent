# Security Model

## Identity & sessions
- Supabase Auth (email + password). Sessions live in HTTP-only cookies managed by `@supabase/ssr` and are refreshed in `src/proxy.ts` on every request.
- The server always calls `auth.getUser()`, which validates the JWT with Supabase, and never trusts the cookie payload alone.
- Optional `FOUNDER_EMAILS` allowlist is enforced at sign-in, sign-up and on every request (`resolveContext`).
- Sign-in errors are generic, so they don't reveal whether an account exists. Post-login `next` redirects accept only same-site paths (open-redirect safe).

## Authorisation (3 layers)
| Layer | Mechanism |
|---|---|
| UI | Controls hidden when `can(role, capability)` is false |
| Server actions | `requireContext(capability)` → `PermissionError` |
| Database | RLS on every table: org-scoped reads; writes need `member+` (operational) or `admin+` (governance); deletes need `admin+`; approval decisions need `admin+` and `decided_by = auth.uid()` |

Capabilities: `read` (all), `operate` (founder/admin/member), `govern` (founder/admin), `own` (founder).
Profiles: users may update only `full_name` (column-level grant). Role escalation is impossible from the client.

## Agent governance
- An agent runs only if it is `active` and holds `ai.execute`.
- Plan steps need the matching permission. Delegating to another agent also needs `tasks.delegate`.
- High/critical risk steps and explicit `request_approval` go to the Approval Center. Without `approvals.request` they are denied.
- Cost: limit `0` means free providers only, so paid AI is blocked until the founder sets a budget. A positive limit is a monthly cap checked before each run.
- Agents cannot move money or contact external parties. They can only propose these actions, and the system prompt says so.

## Secrets
- The browser only ever receives `NEXT_PUBLIC_SUPABASE_URL` and the publishable key, both public by design and safe under RLS.
- AI keys (`ANTHROPIC_API_KEY`, `OPENAI_COMPATIBLE_API_KEY`) are server-only env vars, never logged or returned.
- No service-role key is used anywhere. `.env*` files are git-ignored except `.env.example`.
- `/api/health` reports booleans and provider ids only.

## Database hardening
- SECURITY DEFINER helpers live in the unexposed `private` schema with `search_path = ''` and explicit EXECUTE grants. The Supabase security advisor reports 0 issues.
- `anon` has no table privileges.

## Transport & headers
HSTS, `X-Frame-Options: DENY`, `nosniff`, a strict referrer policy and a restrictive Permissions-Policy; `X-Powered-By` is removed. `robots: noindex`.

## Abuse & integrity controls
- Exactly-once semantics: approval decisions (conditional update + trigger), plan execution (atomic `applied_at` claim) and task runs (status compare-and-set).
- Bounded retries with per-call timeouts. Stale `running` executions are auto-failed after 10 minutes.
- Zod validation caps every input length.

## Founder actions recommended
1. Supabase → Auth → URL Configuration: set Site URL to the Vercel URL and add `https://*-agentravans-projects.vercel.app/auth/callback` to Redirect URLs.
2. After creating your founder account, set `FOUNDER_EMAILS` in Vercel, or disable public sign-ups in Supabase Auth settings.
