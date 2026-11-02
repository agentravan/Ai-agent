#!/usr/bin/env node
/**
 * Builds src/data/agency-agents.json from a local clone of https://github.com/msitarzewski/agency-agents (MIT).
 * Usage: git clone --depth 1 https://github.com/msitarzewski/agency-agents /tmp/aa && node scripts/import-agency-agents.mjs /tmp/aa
 * Only real agent files (frontmatter with name + description) inside listed divisions are imported.
 * Instructions are capped to fit the agents.instructions column (8000 chars) with room for our footer.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const SRC = process.argv[2];
if (!SRC) { console.error("usage: node scripts/import-agency-agents.mjs <path-to-agency-agents-clone>"); process.exit(1); }
const OUT = new URL("../src/data/agency-agents.json", import.meta.url);
const MAX_BODY = 7400;

const divisions = JSON.parse(readFileSync(join(SRC, "divisions.json"), "utf8")).divisions;
const commit = (() => { try { return execFileSync("git", ["-C", SRC, "rev-parse", "HEAD"], { encoding: "utf8" }).trim(); } catch { return "unknown"; } })();

function walk(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith(".md") ? [p] : [];
  });
}

function parse(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(text);
  if (!m) return null;
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([a-zA-Z_]+):\s*(.*)$/.exec(line);
    if (kv) meta[kv[1]] = kv[2].trim().replace(/^["']|["']$/g, "");
  }
  return { meta, body: m[2].trim() };
}

/** Cuts at the last section heading (or paragraph) before the limit so instructions never end mid-sentence. */
function cap(body) {
  if (body.length <= MAX_BODY) return body;
  const slice = body.slice(0, MAX_BODY);
  const cut = Math.max(slice.lastIndexOf("\n## "), slice.lastIndexOf("\n### "));
  const at = cut > MAX_BODY * 0.5 ? cut : slice.lastIndexOf("\n\n");
  return slice.slice(0, at > 0 ? at : MAX_BODY).trim();
}

const clean = (s, n) => s.replace(/\s+/g, " ").trim().slice(0, n);
const seen = new Set();
const agents = [];
for (const division of Object.keys(divisions)) {
  for (const file of walk(join(SRC, division)).sort()) {
    const parsed = parse(readFileSync(file, "utf8"));
    if (!parsed?.meta.name || !parsed.meta.description) continue;
    const slug = relative(SRC, file).replace(/\.md$/, "").replace(/[^a-z0-9/-]/gi, "-").toLowerCase();
    if (seen.has(slug)) continue;
    seen.add(slug);
    agents.push({
      slug,
      division,
      name: clean(parsed.meta.name, 70),
      emoji: clean(parsed.meta.emoji ?? "", 8),
      description: clean(parsed.meta.description, 400),
      vibe: clean(parsed.meta.vibe ?? "", 200),
      instructions: cap(parsed.body),
    });
  }
}

const out = {
  source: "https://github.com/msitarzewski/agency-agents",
  commit,
  license: "MIT License. Copyright (c) 2025 AgentLand Contributors. Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files, to deal in the Software without restriction, subject to including this notice. THE SOFTWARE IS PROVIDED \"AS IS\", WITHOUT WARRANTY OF ANY KIND.",
  divisions: Object.fromEntries(Object.entries(divisions).map(([k, v]) => [k, v.label])),
  agents,
};
writeFileSync(OUT, JSON.stringify(out));
console.log(`Imported ${agents.length} agents across ${Object.keys(divisions).length} divisions (commit ${commit.slice(0, 7)})`);
