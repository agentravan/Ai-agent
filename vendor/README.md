# vendor/ — outside code, kept for reference only

Full source copies of two open-source repos, so their knowledge and designs live inside our system.
**Nothing in this folder is built, installed, deployed or run by AI Empire OS.**

| Folder | Upstream | Commit (pinned) | License |
|---|---|---|---|
| `openexecutive/` | https://github.com/SenteLabsAI/OpenExecutive | `dfbf00f2499f2d397dd60f9a12afabcb310c2c51` | Apache-2.0 (`openexecutive/LICENSE`, `openexecutive/NOTICE`) |
| `awesome-ai-agents/` | https://github.com/slavakurilyak/awesome-ai-agents | `a32e86f60db8dd9556218403532264e0794822c4` | MIT (`awesome-ai-agents/LICENSE`) |

## How it is kept apart (safety)
- Removed on copy: `.git`, `.claude/` (its hooks would auto-run `uv sync` / `npm ci` in a Claude session and pre-approve shell commands), `.github/` (outside CI workflows).
- Execute permission removed from every file.
- Excluded from TypeScript (`tsconfig.json` → `exclude: vendor`), from tests (Vitest runs `tests/` only), from deploys (`.vercelignore`), and marked vendored in `.gitattributes`.
- `tests/vendor-isolation.test.ts` fails the build if any app code imports from `vendor/`.
- The app uses this knowledge only through the cleaned data in `src/data/playbooks.json` and `src/data/agent-radar.json`, made by `scripts/import-*.mjs`.

## Security audit (static read, 3 Nov 2026 — nothing executed)

**Question: does any of this code send our data to another server?**
Answer: **not while it sits here** — it is never run. If someone ran these projects themselves, this is where data would go:

### OpenExecutive (Python FastAPI + Next.js app)
| Destination | When | Default |
|---|---|---|
| Anthropic API (`anthropic` SDK) or OpenRouter | every chat — prompts, company docs retrieved for the answer | **On** — it is an AI app; needs a paid Anthropic key (against our ₹0 rule) |
| Pydantic **Logfire** (observability) | traces: timings, model names, token counts (code says *never prompt/reply text*) | **Off** — only if `LOGFIRE_TOKEN` is set |
| **Honcho** (honcho.dev, per-person memory) | conversation turns for memory | **Off** — only if `HONCHO_ENABLED=true` + `HONCHO_API_KEY` |
| Google (Gmail, Drive, Calendar), Microsoft 365 (Graph), Slack, Discord, Telegram, Notion, Confluence | only the integrations you connect, with your OAuth tokens | **Off** until connected |
| OpenStax / OER sites, Yahoo Finance, news RSS | only when `openexecutive ingest-oer` or market tools are run | **Off** — manual command |
| ChromaDB, SQLite | local files | local only |

Other findings: no analytics/tracking pixels (no PostHog, Sentry, Segment, Mixpanel, GA); no hard-coded real secrets (one fake `xoxb-111-222-realistic` in a test); no `curl | sh`; no npm install hooks; `pickle.loads` is used only between its own parent and child process (`knowledge/isolated.py`) — fine as written, never feed it outside input.
Real-person "personas" (`personas/builtin/*.md`, e.g. famous CEOs) are present in the copy for completeness but are **not** used by our agents.

### awesome-ai-agents (Go tools + data)
- Network: only **GET** requests to `api.github.com`, `gitlab.com`, `codeberg.org` to refresh star counts; `GITHUB_TOKEN` (if set) goes only to the GitHub API.
- No telemetry, no secrets, no install hooks. The useful part is the data (`awesome-agents.json`).

### Verdict
Safe to keep as reference. **Do not run OpenExecutive as-is** next to our system: it needs paid AI keys and would hold its own copy of company data. To use more of it, port the specific idea into `src/modules/…` under our rules (runAgent, RLS, approvals), as was done for the playbooks.

## Updating
Re-clone at a new commit, repeat the same copy (excluding `.git .claude .github`, `chmod -x`), re-run this audit (grep for hosts, telemetry, install scripts, secrets), update the commit pins above, then re-run `scripts/import-open-executive.mjs` / `scripts/import-awesome-agents.mjs`.
