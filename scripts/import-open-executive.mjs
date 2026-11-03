#!/usr/bin/env node
/**
 * Builds src/data/playbooks.json from a local clone of https://github.com/SenteLabsAI/OpenExecutive (Apache-2.0).
 * Usage: git clone --depth 1 https://github.com/SenteLabsAI/OpenExecutive /tmp/oe && node scripts/import-open-executive.mjs /tmp/oe
 *
 * Imports ONLY the built-in Markdown knowledge (packages/core/openexecutive/knowledge/builtin): executive playbooks,
 * skill templates and failure lessons. No code, prompts or personas are imported, nothing is executed.
 * Safety: text is treated as data — links, HTML, and any line that looks like an instruction to an AI
 * ("ignore previous…", "system prompt", …) are removed; sections are size-capped.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

const SRC = process.argv[2];
if (!SRC) { console.error("usage: node scripts/import-open-executive.mjs <path-to-OpenExecutive-clone>"); process.exit(1); }
const ROOT = join(SRC, "packages/core/openexecutive/knowledge/builtin");
const OUT = new URL("../src/data/playbooks.json", import.meta.url);
const MAX_SECTION = 1400;
const DOMAINS = new Set(["strategy", "finance", "legal", "hr", "marketing", "operations", "product", "sales", "board"]);
const commit = (() => { try { return execFileSync("git", ["-C", SRC, "rev-parse", "HEAD"], { encoding: "utf8" }).trim(); } catch { return "unknown"; } })();

const INJECTION = /(ignore|disregard|forget)\b.{0,30}\b(previous|above|prior|all)\b|system prompt|jailbreak|you are now|act as (an? )?(ai|assistant|dan)\b|<\/?(script|iframe|style)/i;

export function clean(text) {
  return text
    .replace(/<[^>]+>/g, "")
    .replace(/\[([^\]]+)\]\((?:https?:)?[^)]*\)/g, "$1") // keep link text, drop the URL
    .replace(/https?:\/\/\S+/g, "")
    .split("\n").filter((l) => !INJECTION.test(l)).join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function walk(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith(".md") ? [p] : [];
  });
}

function frontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(text);
  if (!m) return { meta: {}, body: text };
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([a-z_]+):\s*(.*)$/.exec(line);
    if (kv) meta[kv[1]] = kv[2].replace(/^["']|["']$/g, "").trim();
  }
  return { meta, body: m[2] };
}

function sections(body) {
  const out = [];
  let heading = "Overview";
  let buf = [];
  const flush = () => {
    const text = clean(buf.join("\n"));
    if (text.length > 40) {
      for (let i = 0; i < text.length; i += MAX_SECTION) out.push({ heading, text: text.slice(i, i + MAX_SECTION) });
    }
    buf = [];
  };
  for (const line of body.split(/\r?\n/)) {
    const h = /^#{2,3}\s+(.+)$/.exec(line);
    if (h) { flush(); heading = clean(h[1]).slice(0, 120) || heading; } else if (!/^#\s/.test(line)) buf.push(line);
  }
  flush();
  return out;
}

const playbooks = walk(ROOT).sort().flatMap((file) => {
  const rel = relative(ROOT, file).split(sep);
  const isSkill = rel[0] === "skills";
  const isLesson = rel[0] === "failures"; // case studies of what went wrong — the "learn from mistakes" shelf
  const domain = isSkill || isLesson ? rel[1] : rel[0];
  if (!DOMAINS.has(domain)) return [];
  const { meta, body } = frontmatter(readFileSync(file, "utf8"));
  const title = clean(meta.name && isSkill ? (/^#\s+(.+)$/m.exec(body)?.[1] ?? meta.name) : (/^#\s+(.+)$/m.exec(body)?.[1] ?? rel.at(-1).replace(/\.md$/, ""))).slice(0, 140);
  const secs = sections(body);
  if (!secs.length) return [];
  return [{
    slug: `${isSkill ? "skill-" : isLesson ? "lesson-" : ""}${domain}-${rel.at(-1).replace(/\.md$/, "").replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`,
    domain,
    kind: isSkill ? "skill" : isLesson ? "lesson" : "guide",
    title,
    description: clean(meta.description ?? "").slice(0, 300),
    whenToUse: clean(meta.when_to_use ?? "").slice(0, 300),
    sections: secs,
  }];
});

writeFileSync(OUT, `${JSON.stringify({
  source: "https://github.com/SenteLabsAI/OpenExecutive",
  license: "Apache-2.0",
  attribution: "Executive knowledge © Open Executive Contributors, licensed under the Apache License 2.0. Adapted (cleaned and split into sections) for AI Empire OS.",
  commit,
  playbooks,
}, null, 1)}\n`);
console.log(`wrote ${playbooks.length} playbooks (${playbooks.filter((p) => p.kind === "skill").length} skills) from ${commit.slice(0, 7)}`);
