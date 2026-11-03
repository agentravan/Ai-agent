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
5. Checks Google rank for keywords not checked in the last 20 h (max 5 per cycle, only with `GOOGLE_PLACES_API_KEY`).
6. Emails the Founder (at most once per 12 h) only when something needs a human: tasks out of retries, every task in a cycle failing, or work waiting with no AI configured.

Setup:
- Vercel: `CRON_SECRET` and `SUPABASE_SERVICE_ROLE_KEY` (already needed for reports). Mailbox variables are only needed for alert emails.
- GitHub → Settings → Secrets and variables → Actions: secret `CRON_SECRET` (same value as Vercel), optional variable `APP_URL`.
- `.github/workflows/autopilot.yml` must be on the repository's **default branch**: GitHub only runs scheduled workflows from there. Without it, the daily Vercel cron (14:00 IST) still runs one cycle.
- Run it by hand: Actions → Autopilot → Run workflow.

## Agency toolkit (Agent Library, Google leads, LinkedIn Desk, Rank Tracker)
1. Apply `supabase/migrations/20261102000000_agency_toolkit.sql` (Supabase → SQL Editor, or `supabase db push`). It is additive: no existing data changes.
2. **Agent Library** (`/workforce/library`) and **LinkedIn Desk** (`/linkedin`) work immediately. LinkedIn drafts need an AI provider; you approve, copy and post them yourself — the app never logs in to LinkedIn.
3. **Google leads + Rank Tracker** (optional, may cost money): Google Cloud console → create a project → enable **Places API (New)** → APIs & Services → Credentials → create an API key and restrict it to *Places API (New)*. Google requires a billing account; set a budget alert. Add `GOOGLE_PLACES_API_KEY` in Vercel (Production + Preview) and redeploy.
   - Lead searches request phone/website fields (billed per request; `GOOGLE_PLACES_MAX_PAGES`, default 2 = 40 businesses per search).
   - Rank checks request place IDs only (Google's free "IDs only" search); matching your business the first time is one small paid request.
   - Without the key, leads keep coming from OpenStreetMap (₹0) and the Rank Tracker shows as unavailable.
   - Google's terms limit how long Places data may be cached; leads keep the Google place ID so details can be refreshed.
4. To refresh the library from upstream: `git clone --depth 1 https://github.com/msitarzewski/agency-agents /tmp/aa && node scripts/import-agency-agents.mjs /tmp/aa`.
   Playbooks: `git clone --depth 1 https://github.com/SenteLabsAI/OpenExecutive /tmp/oe && node scripts/import-open-executive.mjs /tmp/oe`.
   Agent Radar: `git clone --depth 1 https://github.com/slavakurilyak/awesome-ai-agents /tmp/awe && node scripts/import-awesome-agents.mjs /tmp/awe`.
   Review the diff of the generated JSON before committing — it is outside content.

## Board Room & $100B North Star
1. Apply `supabase/migrations/20261102000100_board_of_directors.sql` after the agency toolkit migration. It adds the Legal Head (Themis), board meeting tables, and sets every organisation's North Star to **$100 billion**.
2. The North Star is stored in US$ (`north_star_usd`) with your dollar rate (`usd_inr_rate`, default ₹95/$). The database converts it to rupees automatically; change both on **My Desk → Company goals**.
3. The ₹80,000 profit gate is unchanged: no paid tools or upgrades until net profit crosses it.
4. Board meetings run several AI calls in a row (1–4 min). If the time limit is hit, press **Continue meeting** — nobody speaks twice.

## Meeting room, minutes and daily stand-ups
- Migration `20261102000200_meeting_room.sql` adds meeting kinds (board, team, morning, evening), minutes (MOM) and the **Scribe** note-taker.
- `/board` is the lobby; `/board/<id>` is a Meet-style room: tiles per member, the speaker's tile glows with captions, voices are read aloud (browser voices, free), the Founder can type or speak (Chrome/Edge mic).
- **End & minutes**: Scribe writes the MOM (decisions, action items with owners and due dates, risks, opportunities, follow-ups, next agenda), every participant stores it as memory, and it is emailed to the Founder when the mailbox is connected. Action items become tasks only after the Founder presses **Approve action items** (risky ones go to Approvals).
- Daily stand-ups run from the autopilot at 09:00 and 19:00 IST (once per day each, enforced in the database). This needs `SUPABASE_SERVICE_ROLE_KEY` and `CRON_SECRET` set.

## Idea Court
- Migration `20261102000300_idea_court.sql` adds `idea_trials` and the **Nyaya** agent.
- `/court`: file any idea (or a decision from meeting minutes). The trial runs in stages — prosecution (3 hardest questions), defence (answers + closing), 12 jurors vote BUILD / FIX / KILL, the judge gives the fix, a 7-day ₹0 test and a one-line vision. The verdict is the jury majority (ties go to the more careful option).
- **Adopt verdict as team vision** (Founder/admin only, enforced in the database): every active agent remembers it, and the 7-day test becomes a task for the proposer (or the CEO).
- Voices: free browser voices; Microsoft Edge has the most natural Indian voices.

## AI reliability (free models)
- Free "thinking" models can be slow or return empty answers. Empty answers now count as a failed attempt (retried), and a timeout while the answer is streaming is retried too.
- Add backup free models in Vercel: `OPENAI_COMPATIBLE_FALLBACK_MODELS=model-a:free,model-b:free` (same OpenRouter key). Pick current IDs from openrouter.ai/models (filter: free). They are tried in order if the main model fails.
- Recommended with backups: `AI_TIMEOUT_MS=75000`, `AI_MAX_ATTEMPTS=1`. `AI_RUN_BUDGET_MS` (default 240000) caps one run across all retries so it never hits the 300 s limit.
- The autopilot needs `SUPABASE_SERVICE_ROLE_KEY` in Vercel; without it, tasks only run when you press **Start work**.

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
