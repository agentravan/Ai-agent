#!/usr/bin/env node
/**
 * Builds src/data/specialist-rules.json from a local clone of https://github.com/SenteLabsAI/OpenExecutive (Apache-2.0).
 * Usage: node scripts/import-specialist-rules.mjs <path-to-OpenExecutive-clone>
 *
 * Reads packages/core/openexecutive/prompts/domain_prompts.py AS TEXT (never runs it) and keeps the nine
 * specialists' decision rules (CFO benchmarks, sales rules of thumb, legal checks, …), one per field.
 * Adapted for AI Empire OS: written as "think like…" (each agent keeps its own identity), references to blocks
 * we do not send are removed, links/HTML and instruction-like lines are stripped.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const SRC = process.argv[2];
if (!SRC) { console.error("usage: node scripts/import-specialist-rules.mjs <path-to-OpenExecutive-clone>"); process.exit(1); }
const OUT = new URL("../src/data/specialist-rules.json", import.meta.url);
const commit = (() => { try { return execFileSync("git", ["-C", SRC, "rev-parse", "HEAD"], { encoding: "utf8" }).trim(); } catch { return "unknown"; } })();

const FIELD = { CSO: "strategy", CFO: "finance", CHRO: "hr", GC: "legal", COO: "operations", CMO: "marketing", CPO: "product", SALES: "sales", BOARD_COMMS: "board" };
const INJECTION = /(ignore|disregard|forget)\b.{0,30}\b(previous|above|prior)\b|system prompt|jailbreak|<\/?(script|iframe|style)/i;

const text = readFileSync(join(SRC, "packages/core/openexecutive/prompts/domain_prompts.py"), "utf8");
const rules = {};
for (const m of text.matchAll(/^([A-Z_]+)_PROMPT = """([\s\S]*?)"""/gm)) {
  const field = FIELD[m[1]];
  if (!field) continue;
  const body = m[2]
    .split(/\n{2,}/)
    .filter((p) => !/^If a <failure_cases> block/.test(p.trim()))
    .join("\n\n")
    .replace(/^You are (the |a |an )?/, "Think like an experienced ")
    .replace(/a <company_stage> block in the user message \(or the question itself\) says/g, "the company stage in your briefing (or the question itself) says")
    .replace(/a <company_stage> block in the user message says/g, "the company stage in your briefing says")
    .replace(/<[^>]+>/g, "")
    .replace(/https?:\/\/\S+/g, "")
    .split("\n").filter((l) => !INJECTION.test(l)).join("\n")
    .trim();
  rules[field] = body.slice(0, 3600);
}

const missing = Object.values(FIELD).filter((f) => !rules[f]);
if (missing.length) { console.error(`missing fields: ${missing.join(", ")}`); process.exit(1); }

writeFileSync(OUT, `${JSON.stringify({
  source: "https://github.com/SenteLabsAI/OpenExecutive",
  license: "Apache-2.0",
  attribution: "Specialist decision rules © Open Executive Contributors, Apache License 2.0. Adapted for AI Empire OS.",
  commit,
  rules,
}, null, 1)}\n`);
console.log(`wrote ${Object.keys(rules).length} specialist rule sets from ${commit.slice(0, 7)}`);
