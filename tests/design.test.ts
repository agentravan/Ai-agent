import { describe, expect, it } from "vitest";
import { AiError } from "@/lib/ai/types";
import {
  approvalBlockers, briefPrompt, challengePrompt, draftPrompt, LENS_KEYS, nextLens, parseBrief, parseChallenge, parseDraft, parseReview,
  REVIEWERS, reviewPrompt, revisePrompt, specMarkdown, tallyFindings,
} from "@/modules/design/logic";

const sections = (n: number) => Array.from({ length: n }, (_, i) => `## Section ${i + 1}\nText ${i + 1}.`).join("\n\n");

describe("Design Studio (Elephant–Goldfish)", () => {
  it("has the four goldfish lenses the database guard expects", () => {
    expect(LENS_KEYS).toEqual(["zoom_out", "comprehension", "design", "readiness"]);
    expect(new Set(REVIEWERS.map((r) => r.label)).size).toBe(4);
  });

  it("gives a goldfish only the document — never the idea, brief or company context", () => {
    const draft = "## Overview\nCandidate tracker for recruiters.";
    for (const lens of LENS_KEYS) {
      const p = reviewPrompt(lens, draft);
      expect(p).toContain(draft);
      expect(p).toContain("no memory");
      expect(p).not.toContain("Net profit");
      expect(p).not.toContain("APPROVED BRIEF");
    }
    expect(reviewPrompt("comprehension", draft)).toContain('"paraphrase"');
    expect(reviewPrompt("design", draft)).not.toContain('"paraphrase"');
    expect(challengePrompt("## Problem\nX")).toContain("=== BRIEF START ===");
  });

  it("gives the elephant the company context and the brief challenges", () => {
    expect(briefPrompt("CRM", "track clients", "Net profit ₹0")).toContain("Net profit ₹0");
    const d = draftPrompt("CRM", "## Problem\nX", [{ severity: "blocker", title: "No roles", detail: "", fix: "Define roles" }], "ctx");
    expect(d).toContain("[blocker] No roles — Define roles");
    expect(d).toContain("## Detailed Implementation Plan");
    expect(revisePrompt("## A", [{ severity: "major", title: "Vague data", detail: "d", fix: "" }], "note")).toContain("decide the simplest fix");
  });

  it("parses reviews leniently: drops broken findings, normalises severity, sorts and caps", () => {
    const raw = {
      paraphrase: "  A tracker for candidates.  ",
      findings: [
        { severity: "minor", title: "Typo in heading", detail: "x", fix: "y" },
        { severity: "BLOCKER", title: "No data fields", where: "Data", detail: "Fields missing", fix: "List fields" },
        { title: "x" },
        "junk",
        { severity: "weird", title: "Unknown severity", detail: "d", fix: "f" },
        ...Array.from({ length: 8 }, (_, i) => ({ severity: "minor", title: `Minor ${i}`, detail: "", fix: "" })),
      ],
    };
    const r = parseReview(`Here you go:\n\`\`\`json\n${JSON.stringify(raw)}\n\`\`\``);
    expect(r.paraphrase).toBe("A tracker for candidates.");
    expect(r.findings).toHaveLength(8);
    expect(r.findings[0]).toMatchObject({ severity: "blocker", title: "No data fields", detail: "Data: Fields missing" });
    expect(r.findings[1]).toMatchObject({ severity: "major", title: "Unknown severity" });
    expect(parseReview('{"findings": []}').findings).toEqual([]);
    expect(() => parseReview("no json")).toThrow(AiError);
    expect(() => parseReview('{"notes": "x"}')).toThrow(AiError);
    expect(() => parseChallenge('{"findings": []}')).toThrow(AiError);
  });

  it("accepts a Markdown document, strips fences and preambles, rejects thin ones", () => {
    expect(parseBrief(`Sure! Here is the brief:\n\n${sections(7)}`)).toMatch(/^## Section 1/);
    expect(parseDraft(`\`\`\`markdown\n# Title\n\n${sections(11)}\n\`\`\``)).toMatch(/^# Title/);
    expect(() => parseDraft(sections(3))).toThrow(AiError);
  });

  it("runs lenses in order and blocks approval until every rule is met", () => {
    expect(nextLens([])).toBe("zoom_out");
    expect(nextLens(["zoom_out", "comprehension"])).toBe("design");
    expect(nextLens([...LENS_KEYS])).toBeNull();

    expect(approvalBlockers(["zoom_out"], [])[0]).toContain("Waiting for 3 goldfish reviews");
    const all = [...LENS_KEYS];
    expect(approvalBlockers(all, [{ severity: "blocker", decision: "open" }])).toEqual(["1 blocker still undecided — mark each Fix or Skip"]);
    expect(approvalBlockers(all, [{ severity: "minor", decision: "fix" }])).toEqual(["1 finding marked Fix — revise the draft first"]);
    expect(approvalBlockers(all, [{ severity: "blocker", decision: "skip" }, { severity: "major", decision: "open" }])).toEqual([]);
  });

  it("tallies findings and renders the approved spec with accepted findings", () => {
    expect(tallyFindings([{ severity: "blocker" }, { severity: "minor" }, { severity: "minor" }])).toEqual({ blocker: 1, major: 0, minor: 2 });
    const md = specMarkdown({ title: "CRM", draft: "## Overview\nX", round: 2, approved_at: "2026-11-10T10:00:00Z" }, [{ severity: "major", title: "No export", lens: "readiness" }]);
    expect(md).toContain("# CRM");
    expect(md).toContain("approved 2026-11-10");
    expect(md).toContain("- [major] No export (Ready to build?)");
  });
});
