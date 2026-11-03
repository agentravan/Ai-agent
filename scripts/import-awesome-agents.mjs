#!/usr/bin/env node
/**
 * Builds src/data/agent-radar.json from a local clone of https://github.com/slavakurilyak/awesome-ai-agents (MIT).
 * Usage: git clone --depth 1 https://github.com/slavakurilyak/awesome-ai-agents /tmp/awe && node scripts/import-awesome-agents.mjs /tmp/awe
 *
 * This is a DIRECTORY of other people's projects, not code to run. We keep name, description, categories,
 * GitHub link and stars so the Founder can review tools before ever adopting one. Nothing is installed.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const SRC = process.argv[2];
if (!SRC) { console.error("usage: node scripts/import-awesome-agents.mjs <path-to-awesome-ai-agents-clone>"); process.exit(1); }
const OUT = new URL("../src/data/agent-radar.json", import.meta.url);
const commit = (() => { try { return execFileSync("git", ["-C", SRC, "rev-parse", "HEAD"], { encoding: "utf8" }).trim(); } catch { return "unknown"; } })();

const text = (v, n) => String(v ?? "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim().slice(0, n);
const { agents } = JSON.parse(readFileSync(join(SRC, "awesome-agents.json"), "utf8"));

const radar = agents.flatMap((a) => {
  const gh = (a.sources ?? []).find((s) => s.source === "github" && /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+/.test(s.source_url ?? ""));
  if (!gh || gh.repository_status === "archived") return [];
  return [{
    id: text(a.id, 80),
    name: text(a.project, 80),
    description: text(a.project_description, 260),
    categories: (a.categories ?? []).map((c) => text(c, 60)).slice(0, 4),
    url: gh.source_url,
    stars: Number(gh.stars) || 0,
  }];
}).sort((x, y) => y.stars - x.stars);

writeFileSync(OUT, `${JSON.stringify({
  source: "https://github.com/slavakurilyak/awesome-ai-agents",
  license: "MIT",
  attribution: "Directory data © Slava Kurilyak and contributors, MIT License.",
  commit,
  agents: radar,
}, null, 1)}\n`);
console.log(`wrote ${radar.length} radar entries from ${commit.slice(0, 7)}`);
