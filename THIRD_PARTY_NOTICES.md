# Third-party notices

AI Empire OS includes data (not code) from these open-source projects. Each was imported by a script in
`scripts/` that keeps only plain text, removes links/HTML and anything that looks like an instruction to an AI,
and records the upstream commit in the generated JSON. Agents treat this content as background, never as orders.

## Open Executive — `src/data/playbooks.json`, `src/data/specialist-rules.json`
Source: https://github.com/SenteLabsAI/OpenExecutive (built-in knowledge Markdown and the specialists' decision rules from `prompts/domain_prompts.py`, read as text; real-person personas not imported)
License: Apache License 2.0 — https://www.apache.org/licenses/LICENSE-2.0
NOTICE (reproduced as required):

    Open Executive
    Copyright 2025 Open Executive Contributors

    This product is licensed under the Apache License, Version 2.0 (see LICENSE).

Changes: files were split into sections, cleaned (links/HTML removed) and tagged by field and type; specialist rules reworded as "think like…" and references to blocks we do not use removed. What was kept and dropped: `docs/THIRD_PARTY_AUDIT.md`.

## awesome-ai-agents — `src/data/agent-radar.json`
Source: https://github.com/slavakurilyak/awesome-ai-agents — MIT License, Copyright (c) 2024 Slava Kurilyak.
Only names, descriptions, categories, GitHub links and star counts are kept. Nothing listed is installed.

## Agency Agents — `src/data/agency-agents.json`
Source: https://github.com/msitarzewski/agency-agents — MIT License.

## Ideas only (no code or text copied)
- Open Duet (https://github.com/Anil-matcha/open-duet, Apache-2.0): relevance recall of agent notes and learning
  from decisions, re-implemented in `src/modules/learning/logic.ts`.
