# Outside repos: what we kept, what we dropped, and why

Reviewed 3 Nov 2026 by reading the code (nothing was executed).
OpenExecutive `dfbf00f` (Apache-2.0) · awesome-ai-agents `a32e86f` (MIT).

## Kept — in the app now (as cleaned data, never as outside code)

| What | Where | Why it helps |
|---|---|---|
| 9 specialists' **expert rules** (CFO, CSO, COO, CMO, CPO, Head of Sales, General Counsel, CHRO, Board) | `src/data/specialist-rules.json` → every agent of that field | How an experienced exec decides; includes bootstrapped / solo-founder guidance that fits our ₹0 stage (work from cash, price before cost cuts, founder-led sales) |
| 88 **playbooks** + 16 **skill templates** | `src/data/playbooks.json` → matching passage before each task, `/playbooks` | MBA-level know-how per field: pricing, unit economics, contracts, hiring, OKRs, market sizing… |
| 18 **lessons from failures** | same file (`kind: lesson`) | Agents learn from real failure patterns |
| **Chief Strategy Officer** and **Chief Product Officer** roles | migration `20261103000000` (Chanakya, Pragati) | Two specialist seats we did not have |
| **Agent directory** (303 projects) | `src/data/agent-radar.json`, `/playbooks/radar` | Research list for future tools — nothing installed |
| Ideas (re-implemented in our code): relevance recall, learning from decisions | `src/modules/learning` | Agents remember what matters, at ₹0 |

## Dropped — not useful for us, or unsafe

| What | Why not |
|---|---|
| Python FastAPI backend, its Next.js UI, Docker | Duplicates what AI Empire OS already does (board, approvals, memory, scheduler); needs its own server |
| Anthropic-only model calls, ChromaDB + PyTorch embeddings | Paid AI key and heavy hosting — breaks the ₹0 rule; our word-matching recall needs neither |
| Integrations (Gmail, Microsoft 365, Slack, Discord, Telegram, Notion, Confluence) | Each needs OAuth/app setup and would send data to that service; add only when the Founder asks, through our approval flow |
| Logfire telemetry, Honcho memory service | Send data to outside companies (off by default there); not needed |
| Real-person "personas" (famous CEOs) | Impersonating real people — never used |
| Fake company fixtures, evals that need Claude API, token-minting scripts | Test material for their product only |
| `.claude/` hooks and settings | Would auto-run installs and pre-approve shell commands in a Claude session |
| awesome-ai-agents Go tools | Only refresh their own star counts; the data is what matters |

## Data-flow check (if someone ran these projects themselves)
- OpenExecutive: chat text goes to its AI provider (by design). Logfire and Honcho only with their keys set. Integrations only when connected. No analytics or tracking code, no real secrets, no install hooks.
- awesome-ai-agents: GET requests to GitHub / GitLab / Codeberg APIs only.
- **In AI Empire OS none of their code runs**: only the cleaned JSON above, produced by `scripts/import-*.mjs`, which strip links, HTML and instruction-like lines. Tests (`tests/knowledge.test.ts`) re-check the shipped data.
