# Deployment Guide (₹0)

## Current deployment
| Item | Value |
|---|---|
| Vercel project | `ai-empire-os` (team *agentravan's projects*, Hobby, free) |
| Git | `agentravan/Ai-agent`. Pushes to `feat/ai-empire-os-foundation` create preview deployments |
| Supabase | project `ai-empire-os` (`zeroeprznkwhanhzwmfv`, ap-south-1, Free) |
| Env vars set in Vercel | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (publishable key; public by design) |
| Deployment protection | Vercel Authentication on (team default). Preview URLs require your Vercel login |

## Free-tier limits that matter
- **Vercel Hobby:** non-commercial use, function duration up to 300 s with Fluid compute (pages that call AI set `maxDuration = 300`), 1 concurrent build.
- **Supabase Free:** 2 active projects per owner, 500 MB database, projects pause after about 1 week of inactivity (restore from the dashboard), built-in email sending is heavily rate-limited (a few emails per hour).
- **Ollama:** free, but runs on your machine. Vercel can reach it only through a public tunnel (for example a Cloudflare Tunnel free URL) set as `OLLAMA_BASE_URL`. Protect the tunnel; anyone with the URL can use your model.

## One-time founder setup
1. **Supabase → Authentication → URL Configuration**
   - Site URL: your Vercel URL (for example `https://ai-empire-os-agentravans-projects.vercel.app`)
   - Redirect URLs: add `https://*-agentravans-projects.vercel.app/auth/callback` and `http://localhost:3000/auth/callback`
2. Open the preview and choose **Create founder account**. Confirm the email, then sign in. The organisation and executive team are created automatically.
3. Vercel → Project → Settings → Environment Variables: add `FOUNDER_EMAILS=<your email>` (Preview and Production), then redeploy. You can also disable sign-ups under Supabase → Auth → Providers → Email.
4. AI (optional, free): run `ollama pull llama3.2`, expose it with a tunnel, then set `OLLAMA_BASE_URL` and `OLLAMA_MODEL` in Vercel. Alternatively set the `OPENAI_COMPATIBLE_*` variables for a free hosted endpoint. Claude (`ANTHROPIC_API_KEY`) is optional and paid. Give agents a monthly cost limit before using it.

## Autopilot (self-running, self-healing)
Every 30 minutes `/api/cron/autopilot` runs one cycle per organisation:
1. Recovers runs stuck in "running" (killed serverless calls).
2. Puts failed tasks back in the queue: at most 3 automatic retries, waiting 30 min → 1 h → 2 h. After that the task stays failed and the Founder is told.
3. Agents work ready tasks within the time budget (each task at most once per cycle). Risky steps still go to the Approval Center.
4. If the main AI provider fails, the run fails over to the next configured provider (`AI_FALLBACK`, default `free` = never paid Anthropic).
5. Emails the Founder (at most once per 12 h) only when something needs a human: tasks out of retries, every task in a cycle failing, or work waiting with no AI configured.

Setup:
- Vercel: `CRON_SECRET` and `SUPABASE_SERVICE_ROLE_KEY` (already needed for reports). Mailbox variables are only needed for alert emails.
- GitHub → Settings → Secrets and variables → Actions: secret `CRON_SECRET` (same value as Vercel), optional variable `APP_URL`.
- `.github/workflows/autopilot.yml` must be on the repository's **default branch**: GitHub only runs scheduled workflows from there. Without it, the daily Vercel cron (14:00 IST) still runs one cycle.
- Run it by hand: Actions → Autopilot → Run workflow.

## Local development
```bash
cp .env.example .env.local      # fill Supabase URL + publishable key
npm ci
npm run dev                     # http://localhost:3000 (Ollama on 127.0.0.1:11434 works directly)
npm run check                   # typecheck + unit tests + build
PGBIN=/usr/lib/postgresql/16/bin npm run test:db   # RLS suite on local Postgres
```

## Applying migrations to a new Supabase project
Run each file in `supabase/migrations/` in order (SQL editor, Supabase CLI `supabase db push`, or MCP `apply_migration`). Then run the security advisor; it should report 0 issues.

## Promotion to production
Production deploys come from the repository's production branch. Merge `feat/ai-empire-os-foundation` into the production branch only after the preview checklist passes. Never replace another project's production.

## Preview verification checklist
`/` loads · `/login` renders the sign-in form · `/dashboard` redirects to `/login` when signed out · `/api/health` reports `database: "ok"` · `/api/ai/status` returns 401 when signed out · after sign-in, every navigation page renders · no secrets in page source.
