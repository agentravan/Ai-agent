import { describe, expect, it } from "vitest";
import { AiError } from "@/lib/ai/types";
import { defencePrompt, deliberationPrompt, JURY, majority, parseDefence, parseProsecution, parseRuling, prosecutionPrompt, tally } from "@/modules/court/logic";

describe("Idea Court", () => {
  it("has twelve distinct jurors", () => {
    expect(JURY).toHaveLength(12);
    expect(new Set(JURY.map((j) => j.key)).size).toBe(12);
  });

  it("parses the prosecution and rejects junk as retryable", () => {
    const p = parseProsecution('Sure! {"opening":"Ye idea risky hai.","questions":[{"q":"Pay kaun karega?","why":"No demand proof"},{"q":"Free tools kyun nahi?","why":"Alternatives"},{"q":"Leads kahan se?","why":"Reach"}]}');
    expect(p.questions).toHaveLength(3);
    expect(() => parseProsecution("no json here")).toThrow(AiError);
  });

  it("parses the defence", () => {
    expect(parseDefence('{"answers":["A1","A2","A3"],"closing":"Test karke dekhte hain."}').answers).toEqual(["A1", "A2", "A3"]);
  });

  it("keeps one vote per real juror, in panel order, and ignores invented jurors", () => {
    const votes = JURY.map((j, i) => ({ juror: j.key.toUpperCase(), vote: i < 7 ? "FIX" : "build", reason: "r" }));
    const r = parseRuling(JSON.stringify({ votes: [...votes, { juror: "alien", vote: "kill", reason: "x" }], verdict: "Fix", summary: "Fix it first.", fix: "Narrow the niche", next_test: "Email 30 salons, pass = 3 replies", vision: "Pehle proof, phir scale." }));
    expect(r.votes.map((v) => v.juror)).toEqual(JURY.map((j) => j.key));
    expect(r.verdict).toBe("fix");
    expect(() => parseRuling(JSON.stringify({ votes: votes.slice(0, 3), verdict: "build", summary: "s ok", next_test: "t ok", vision: "v ok" }))).toThrow(AiError);
  });

  it("decides by jury majority; ties go to the more careful option", () => {
    const v = (b: number, f: number, k: number) => [...Array(b).fill({ vote: "build" }), ...Array(f).fill({ vote: "fix" }), ...Array(k).fill({ vote: "kill" })];
    expect(majority(v(7, 3, 2))).toBe("build");
    expect(majority(v(5, 5, 2))).toBe("fix");
    expect(majority(v(2, 5, 5))).toBe("kill");
    expect(majority(v(4, 4, 4))).toBe("kill");
    expect(tally(v(1, 2, 3))).toEqual({ build: 1, fix: 2, kill: 3 });
  });

  it("tells every role not to invent data and to speak plainly", () => {
    for (const p of [prosecutionPrompt("idea", "Atlas", ""), defencePrompt("idea", [{ q: "q", why: "w" }], ""), deliberationPrompt("idea", [{ q: "q" }], ["a"], "")]) {
      expect(p).toMatch(/Never invent customers/);
      expect(p).toMatch(/no jargon/);
    }
    expect(prosecutionPrompt("idea", "Atlas", "")).toContain("proposed by Atlas");
  });
});
