/**
 * Design Studio rules — the Elephant–Goldfish Model (adapted from google/elephant-goldfish-model, Apache-2.0).
 * Design with an elephant (Gaja: full company context), review with a goldfish (Meen: only the document).
 * Pure: prompts, output schemas, approval rules. Unit-tested.
 */
import { z } from "zod";
import { AiError } from "@/lib/ai/types";
import type { DesignDecision, DesignSeverity, DesignStage } from "@/types/domain";

export type Stage = DesignStage;
export type Severity = DesignSeverity;
export type Decision = DesignDecision;
export type Lens = (typeof REVIEWERS)[number]["key"];

/**
 * The four goldfish reviewers (EGM: Zoom Out, Comprehension, Design Critic, Implementation Readiness).
 * Keep the count in step with private.guard_design_doc() in the Design Studio migration.
 */
export const REVIEWERS = [
  {
    key: "zoom_out", label: "Simplicity check", who: "Skeptical architect",
    brief: `Look at the big picture and enforce simplicity. Are we building something we don't need yet? Is it over-built for a small team on free tools?
Could an existing free tool, or a part of the system that already exists (as described in the document), do this instead? Is anything a dead end
that will be hard to change later? Does the document drown in detail instead of explaining the main idea?`,
  },
  {
    key: "comprehension", label: "New team member", who: "Fresh reader",
    brief: `Read as someone who joined today and knows nothing about the company. FIRST, in "paraphrase", explain in your own words what the document
proposes and how it works. If you cannot explain a section, report it as a blocker. Then flag every term, abbreviation, system or role that is
used but never explained, every step that assumes knowledge the document does not give, and every place where parts don't connect.`,
  },
  {
    key: "design", label: "Design critic", who: "Hostile senior engineer",
    brief: `Stress-test the design. Which claims are asserted without reason? What fails when data is wrong, missing or duplicated, when two people act
at once, or when a free-tier limit is hit? Who can see or change what — are roles and permissions defined? Is personal data (candidates, clients,
phone numbers) protected, and is consent and deletion handled (India's DPDP Act)? What happens on errors, backups and restore?`,
  },
  {
    key: "readiness", label: "Ready to build?", who: "Developer who must build it",
    brief: `You are the developer who must build this tomorrow. Could you start without making your own design decisions? Check that the data
(every table/record and its fields), screens, user actions, rules, error messages and the order of work are spelled out, and that each step of
the implementation plan says exactly what to build and how to check it works. Flag every decision left to the builder.`,
  },
] as const;

export const LENS_KEYS = REVIEWERS.map((r) => r.key) as readonly Lens[];
export const lensLabel = (key: string) => REVIEWERS.find((r) => r.key === key)?.label ?? key;

export const STAGES: readonly { key: Stage; label: string }[] = [
  { key: "brief", label: "Brief" },
  { key: "draft", label: "Draft" },
  { key: "review", label: "Goldfish review" },
  { key: "approved", label: "Approved" },
];

/** EGM's reviewer stance: critique first, no flattery, plain words. */
const STANCE = `Rules for you:
- Lead with what is wrong, missing or risky. Never call the work great, smart or perfect. No apologies, no filler.
- Plain, simple words. Explain mechanisms directly; no buzzwords like seamless or robust.
- Only real problems you can point to in the text — never pad the list. Each finding needs a concrete fix.
- Write in the same language as the document (Hinglish if it is in Hinglish).`;

const WRITER = `Rules for you:
- Write in the same language the Founder used for the idea (Hinglish if they wrote Hinglish), in plain simple words.
- A stranger with no background must be able to follow it: define every term, state every assumption.
- Prefer the simplest design that works on free tools (₹0 budget). Never invent numbers, customers or results; write "data needed" instead.
- Output only the Markdown document — no preamble, no code fences around it.`;

export function briefPrompt(title: string, idea: string, context: string, notes = ""): string {
  return `DESIGN STUDIO — you are the ELEPHANT. Turn the Founder's idea into a short concepts brief before anything is designed or built.
Project: ${title}
The Founder's idea: """${idea}"""
${context ? `What you know about the company:\n${context}\n` : ""}${notes ? `Founder's notes:\n${notes}\n` : ""}
Write a Markdown brief with exactly these sections:
## Problem — what hurts today and for whom
## Who uses it — each type of user and what they need to do
## Must have (first version) — the smallest set that solves the problem
## Not now — what we deliberately leave out
## Key trade-offs — for each real choice: the options, and which one you recommend and why
## Open questions for the Founder — what only the Founder can decide
## How we know it works — simple checks after launch
${WRITER}`;
}

/** Goldfish brainstorm: one fresh reader challenges the brief before the draft is written. */
export function challengePrompt(brief: string): string {
  return `DESIGN STUDIO — you are a GOLDFISH. You have no background: below is everything you know. Challenge this brief before anyone designs it.
Ask: does this need to exist now (or can a free tool do 90% of it)? What will confuse the users? What will break or cost money as it grows?
What breaks when old data has to move into it, or when we need to undo a change?
=== BRIEF START ===
${brief}
=== BRIEF END ===
${STANCE}
Respond with ONLY JSON: {"findings": [{"severity": "blocker"|"major"|"minor", "title": "max 14 words", "detail": "why it matters, max 45 words", "fix": "the concrete change, max 40 words"}]}
Between 2 and 8 findings, most serious first.`;
}

export function draftPrompt(title: string, brief: string, challenges: readonly Finding[], context: string): string {
  return `DESIGN STUDIO — you are the ELEPHANT. Write the design document for this software, from the approved brief.
Project: ${title}
${context ? `What you know about the company:\n${context}\n` : ""}=== APPROVED BRIEF ===
${brief}
=== END BRIEF ===
${challenges.length ? `A fresh reviewer challenged the brief — address these in the design (or say why not):\n${challenges.map((c, i) => `${i + 1}. [${c.severity}] ${c.title} — ${c.fix}`).join("\n")}\n` : ""}
Write a Markdown design document with these sections:
## Overview — what it is, who it is for, in 3–5 sentences
## Terms — every word a newcomer might not know, one line each
## Users and permissions — each role and exactly what it can see and change
## Features — each feature as: what the user does → what the system does → what they see
## Data — every record type and its fields (name, type, required?), and how records link
## Screens — each screen: purpose, what it shows, actions on it
## Rules and edge cases — duplicates, missing data, two people acting at once, mistakes and undo
## Privacy and safety — personal data, consent, deletion, backups
## Out of scope — what this version will not do
## Risks — what could go wrong and how we reduce it
## Detailed Implementation Plan — numbered steps in build order; each step: what to build, and how to check it works
${WRITER}`;
}

/** A goldfish review: the reviewer sees the document and nothing else. */
export function reviewPrompt(lens: Lens, draft: string): string {
  const r = REVIEWERS.find((x) => x.key === lens)!;
  return `DESIGN STUDIO — you are a GOLDFISH reviewer: ${r.who} (${r.label}). You have no memory and no background: the document below is all you know.
${r.brief}
=== DOCUMENT START ===
${draft}
=== DOCUMENT END ===
${STANCE}
Severity: blocker = cannot build or approve until fixed; major = will cause real trouble; minor = worth improving.
Respond with ONLY JSON: {${lens === "comprehension" ? `"paraphrase": "the whole proposal in your own words, max 120 words", ` : ""}"findings": [{"severity": "blocker"|"major"|"minor", "title": "max 14 words", "where": "section name", "detail": "what is wrong, max 45 words", "fix": "the concrete change, max 40 words"}]}
Between 0 and 8 findings, most serious first. An empty list is allowed only if you truly found nothing.`;
}

export function revisePrompt(draft: string, toFix: readonly Finding[], notes: string): string {
  return `DESIGN STUDIO — you are the ELEPHANT. Revise the design document to fix the findings the Founder chose. Keep everything else as it is.
=== CURRENT DOCUMENT ===
${draft}
=== END DOCUMENT ===
Fix these findings from the fresh reviewers:
${toFix.map((f, i) => `${i + 1}. [${f.severity}] ${f.title}${f.detail ? ` — ${f.detail}` : ""}\n   Suggested fix: ${f.fix || "(reviewer gave none — decide the simplest fix)"}`).join("\n")}
${notes ? `Founder's notes:\n${notes}\n` : ""}
Return the COMPLETE revised document (all sections, not just the changes).
${WRITER}`;
}

// ---------- parsing ----------

function extractJson(text: string, what: string): unknown {
  const unfenced = text.replace(/```(?:json)?/gi, "");
  const start = unfenced.indexOf("{");
  const end = unfenced.lastIndexOf("}");
  if (start < 0 || end <= start) throw new AiError(`${what}: no JSON`, true);
  try { return JSON.parse(unfenced.slice(start, end + 1)); } catch { throw new AiError(`${what}: malformed JSON`, true); }
}

const severitySchema = z.string().trim().toLowerCase().pipe(z.enum(["blocker", "major", "minor"])).catch("major");
const findingSchema = z.object({
  severity: severitySchema,
  title: z.string().trim().min(2).transform((s) => s.slice(0, 300)),
  where: z.string().trim().max(120).optional().catch(undefined),
  detail: z.string().trim().catch("").transform((s) => s.slice(0, 1500)),
  fix: z.string().trim().catch("").transform((s) => s.slice(0, 1500)),
});
export type Finding = z.infer<typeof findingSchema>;

const RANK: Record<Severity, number> = { blocker: 0, major: 1, minor: 2 };

/** Keeps the valid findings (drops a broken one instead of failing the review), most serious first, at most 8. */
function findingsFrom(raw: unknown): Finding[] {
  const list = z.array(z.unknown()).catch([]).parse(raw);
  return list
    .flatMap((x) => { const r = findingSchema.safeParse(x); return r.success ? [r.data] : []; })
    .map((f) => (f.where ? { ...f, detail: `${f.where}: ${f.detail}`.slice(0, 1500) } : f))
    .sort((a, b) => RANK[a.severity] - RANK[b.severity])
    .slice(0, 8);
}

export interface Review { paraphrase: string | null; findings: Finding[] }

export function parseReview(text: string): Review {
  const raw = extractJson(text, "Review");
  const obj = z.object({ findings: z.unknown(), paraphrase: z.unknown().optional() }).safeParse(raw);
  if (!obj.success || !Array.isArray(obj.data.findings)) throw new AiError("Review: no findings list", true);
  const paraphrase = typeof obj.data.paraphrase === "string" && obj.data.paraphrase.trim().length > 1 ? obj.data.paraphrase.trim().slice(0, 4000) : null;
  return { paraphrase, findings: findingsFrom(obj.data.findings) };
}

/** The brainstorm challenge must produce at least one finding (a fresh reader always has questions). */
export function parseChallenge(text: string): Finding[] {
  const r = parseReview(text);
  if (!r.findings.length) throw new AiError("Challenge: no findings", true);
  return r.findings;
}

/** A Markdown document from the elephant: unfenced, with at least `minSections` "## " headings. */
export function parseDoc(minSections: number, max: number) {
  return (text: string): string => {
    let doc = text.trim();
    const fenced = /^```(?:markdown|md)?\s*\n([\s\S]*?)\n```\s*$/i.exec(doc);
    if (fenced) doc = fenced[1]!.trim();
    const first = doc.search(/^#{1,2} /m);
    if (first > 0) doc = doc.slice(first); // drop "Sure, here is…" preambles
    const sections = (doc.match(/^## /gm) ?? []).length;
    if (sections < minSections) throw new AiError(`Document has ${sections} sections, expected at least ${minSections}`, true);
    if (doc.length > max) throw new AiError("Document too long", true);
    return doc;
  };
}
export const parseBrief = parseDoc(5, 20000);
export const parseDraft = parseDoc(8, 60000);

// ---------- workflow rules ----------

export interface FindingRow { id: string; lens: string; severity: Severity; title: string; detail: string; fix: string; decision: Decision; round: number }

/** The next goldfish lens still to run this round, or null when the review is complete. */
export function nextLens(done: readonly string[]): Lens | null {
  return LENS_KEYS.find((k) => !done.includes(k)) ?? null;
}

/** Why the design cannot be approved yet (empty = it can). Mirrors private.guard_design_doc(). */
export function approvalBlockers(doneLenses: readonly string[], findings: readonly Pick<FindingRow, "severity" | "decision">[]): string[] {
  const out: string[] = [];
  const missing = LENS_KEYS.filter((k) => !doneLenses.includes(k));
  if (missing.length) out.push(`Waiting for ${missing.length} goldfish review${missing.length === 1 ? "" : "s"}: ${missing.map(lensLabel).join(", ")}`);
  const open = findings.filter((f) => f.severity === "blocker" && f.decision === "open").length;
  if (open) out.push(`${open} blocker${open === 1 ? "" : "s"} still undecided — mark each Fix or Skip`);
  const toFix = findings.filter((f) => f.decision === "fix").length;
  if (toFix) out.push(`${toFix} finding${toFix === 1 ? "" : "s"} marked Fix — revise the draft first`);
  return out;
}

export function tallyFindings(findings: readonly Pick<FindingRow, "severity">[]): Record<Severity, number> {
  return findings.reduce((t, f) => ({ ...t, [f.severity]: t[f.severity] + 1 }), { blocker: 0, major: 0, minor: 0 } as Record<Severity, number>);
}

/** The approved spec as one Markdown file (to paste into Claude Code, a developer brief, or docs/designs/). */
export function specMarkdown(d: { title: string; draft: string | null; round: number; approved_at: string | null }, skipped: readonly Pick<FindingRow, "severity" | "title" | "lens">[] = []): string {
  const head = `# ${d.title}\n\n> Design Studio (Elephant–Goldfish Model) · review round ${d.round}${d.approved_at ? ` · approved ${d.approved_at.slice(0, 10)}` : " · not approved yet"}\n\n`;
  const accepted = skipped.length
    ? `\n\n## Known and accepted findings\n${skipped.map((f) => `- [${f.severity}] ${f.title} (${lensLabel(f.lens)})`).join("\n")}\n`
    : "";
  return `${head}${(d.draft ?? "").trim()}${accepted}`;
}
