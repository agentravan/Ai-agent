# AI Empire OS

Autonomous multi-agent business operating system. Founder: **Harshit Bhardwaj**. Mission (Project Apex): **$100 billion** from ₹0. Infrastructure budget: **₹0** until ₹80,000 net profit.

An AI CEO, COO and executive workforce plan, delegate and execute work. Every agent action passes permission, cost and approval governance, and everything is recorded in an append-only audit log.

## Features (Milestone 1)
- **Founder authentication:** Supabase Auth, secure cookie sessions, protected routes, role-based permissions (founder/admin/member/viewer).
- **Founder dashboard:** organisation overview, active projects, agent registry, pending approvals, latest activity, live AI connectivity.
- **AI CEO office:** identity, strategy workspace, opportunity proposals, data-grounded executive reports, founder communication.
- **AI COO office:** task status overview, task assignment, project progress, workforce monitoring (runs, failures, spend).
- **Agent registry:** hire agents with designation, tier, instructions, department, reporting manager, permissions and cost limit; activate or suspend.
- **Empire Command:** natural language → schema-validated plan → per-step execute, approval or deny, with execution tracking.
- **Approval center:** pending requests with action details, approve/reject (exactly once), history.
- **Audit system:** database-trigger audit of all business tables plus semantic agent/user events, with filters.
- **Board Room (Meet-style):** live meetings with the CEO, COO, CFO and Legal Head — glowing tiles, voices, captions; the Founder asks by text or mic and members answer, debate risk and profit, or pass. Scribe writes minutes (MOM), emails them, and action items become tasks on approval. Team meetings (a leader with their reports) and daily 09:00 / 19:00 IST stand-ups.
- **Idea Court:** any idea goes on trial — prosecutor, defence, 12 AI jurors (BUILD / FIX / KILL) and a judge's verdict with the fix, a 7-day ₹0 test and a one-line team vision the Founder can adopt.
- **Project Apex directive:** every agent run carries the mission ($100B North Star in USD, profit tracked in INR at a Founder-set rate, ₹80,000 gate before paid upgrades, legal-only growth).
- **Agent Library:** 280+ ready-made AI employees (sales, marketing, SEO, developers, designers…) from [Agency Agents](https://github.com/msitarzewski/agency-agents) (MIT), hired in one click under full governance.
- **Google Maps leads (optional):** with `GOOGLE_PLACES_API_KEY`, the Sales Engine finds businesses with phone numbers via Google Places; OpenStreetMap remains the ₹0 default and fallback.
- **LinkedIn Desk:** AI drafts posts and replies to comments/DMs; Founder approves, copies and posts (no LinkedIn login or automation).
- **Rank Tracker:** daily Google position for "best gym in bandra"-style keywords, with history and trend.
- **AI providers:** Ollama (free, default), any OpenAI-compatible endpoint, Claude (optional). If none is configured, AI features are clearly marked unavailable.

## Stack
Next.js 16 (App Router) · TypeScript strict · Tailwind CSS 4 · Supabase (Postgres + Auth + RLS) · Zod 4 · Vitest · Vercel.

## Quick start
```bash
npm ci
cp .env.example .env.local   # NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY (+ optional AI vars)
npm run dev
```
Apply `supabase/migrations/*.sql` to your Supabase project first. Full steps: [docs/DEPLOYMENT_GUIDE.md](docs/DEPLOYMENT_GUIDE.md).

## Scripts
| Command | Purpose |
|---|---|
| `npm run dev` / `build` / `start` | Next.js |
| `npm run typecheck` | `tsc --noEmit` (strict) |
| `npm test` | Unit tests (governance policy, plan parsing, retries, permissions, validation, providers) |
| `npm run test:db` | Applies migrations to a throwaway local Postgres and runs the RLS/integrity suite |
| `npm run check` | typecheck + tests + build |

## Documentation
[Repository audit](docs/REPOSITORY_AUDIT.md) · [Architecture](docs/ARCHITECTURE.md) · [Database](docs/DATABASE_DESIGN.md) · [Security](docs/SECURITY_MODEL.md) · [AI agents](docs/AI_AGENT_DESIGN.md) · [Deployment](docs/DEPLOYMENT_GUIDE.md) · [Roadmap](docs/IMPLEMENTATION_ROADMAP.md)
