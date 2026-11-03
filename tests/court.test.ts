import { describe, expect, it } from "vitest";
import { AiError } from "@/lib/ai/types";
import { defencePrompt, deliberationPrompt, hearingPrompt, JURY, majority, ownedUpgrades, parseHearing, rulingText, RISK_LABEL, parseDefence, parseProsecution, parseRuling, prosecutionPrompt, tally } from "@/modules/court/logic";

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


describe("Idea Court upgrade: weak points → upgrades, defence for the team, honest risk", () => {
  const hearing = parseHearing(JSON.stringify({
    opening: "Ye idea abhi kachcha hai.",
    weaknesses: [{ point: "No proof gyms will pay", why: "Demand unknown" }, { point: "Cold email gets ignored", why: "Reach" }, { bad: true }],
    questions: [{ q: "Pay kaun karega?", why: "Demand" }],
    answers: ["5 gyms se pre-order lo is hafte."],
    team: [{ who: "Atlas (Chief Executive Officer)", do: "Pick one city", dont: "Spread thin" }, { who: "Ledger (Chief Financial Officer)", do: "Take 50% advance" }],
    closing: "Chhota test, bada sabak.",
  }));
  it("splits one hearing call into prosecution and defence, dropping broken items", () => {
    expect(hearing.prosecution.weaknesses?.map((w) => w.point)).toEqual(["No proof gyms will pay", "Cold email gets ignored"]);
    expect(hearing.defence.team?.[1]).toEqual({ who: "Ledger (Chief Financial Officer)", do: "Take 50% advance", dont: "" });
    expect(() => parseHearing(JSON.stringify({ opening: "x y", weaknesses: [], questions: [{ q: "q?", why: "w" }], answers: ["a b"], team: [], closing: "c d" }))).toThrow(AiError);
  });
  it("asks for every real weak point (3-10, never padded) and the defence for each executive", () => {
    const p = hearingPrompt("Gym websites", "Atlas", "", ["Atlas (CEO)", "Themis (Legal Head)"]);
    expect(p).toMatch(/between 3 and 10, only real ones, never padded/);
    expect(p).toContain("Atlas (CEO); Themis (Legal Head)");
    expect(p).toMatch(/must NOT do/);
  });
  it("the judge upgrades every weak point and rates risk without inventing a percentage", () => {
    const d = deliberationPrompt("idea", [{ q: "q" }], ["a"], "", hearing.prosecution.weaknesses, hearing.defence.team);
    expect(d).toMatch(/W1\. No proof gyms will pay/);
    expect(d).toMatch(/never invent a percentage/);
    const votes = JURY.map((j) => ({ juror: j.key, vote: "fix", reason: "ok ok" }));
    const r = parseRuling(JSON.stringify({ votes, verdict: "fix", summary: "Fix first.", fix: "One city", next_test: "Email 30 gyms, pass = 3 replies", vision: "Proof first.",
      upgrades: [{ weakness: "No proof", upgrade: "Pre-sell to 5 gyms", owner: "Atlas" }, { weakness: "Reach", upgrade: "WhatsApp intros", owner: "Iris (Sales)" }, { weakness: "x" }],
      plan: ["Pick one city", "Pre-sell"], failure_risk: "Medium", risk_reason: "Demand unproven", stop_if: "0 replies after 30 emails" }));
    expect(r.upgrades).toHaveLength(2);
    expect(r.failure_risk).toBe("medium");
    expect(RISK_LABEL[r.failure_risk!]).toBe("Medium risk");
    const legacy = parseRuling(JSON.stringify({ votes, verdict: "fix", summary: "Fix first.", next_test: "t ok", vision: "v ok", failure_risk: "2%" }));
    expect(legacy.failure_risk).toBeUndefined();
    expect(legacy.upgrades ?? []).toEqual([]);
  });
  it("turns upgrades into tasks only for real owners, and shares one clear ruling", () => {
    const owned = ownedUpgrades([{ weakness: "a", upgrade: "b", owner: "Iris (Sales)" }, { weakness: "c", upgrade: "d", owner: "Founder" }, { weakness: "e", upgrade: "f", owner: "Ghost" }], [{ name: "Iris" }, { name: "Atlas" }]);
    expect(owned.map((o) => o.agent.name)).toEqual(["Iris"]);
    const text = rulingText({ idea: "Gym websites", verdict: "fix", defence: hearing.defence,
      ruling: { summary: "Fix first.", fix: "One city", next_test: "Email 30 gyms", vision: "Proof first.", upgrades: [{ weakness: "No proof", upgrade: "Pre-sell", owner: "Atlas" }], plan: ["Pick one city"], failure_risk: "low", risk_reason: "Small test", stop_if: "0 replies" } });
    expect(text).toMatch(/FIX\. Fix first\./);
    expect(text).toMatch(/Upgrades: 1\) No proof → Pre-sell \[Atlas\]/);
    expect(text).toMatch(/Low risk — Small test/);
    expect(text).toMatch(/Atlas \(Chief Executive Officer\): do Pick one city; don't Spread thin/);
    expect(rulingText({ idea: "x", verdict: null, ruling: null, defence: null })).toBe("");
  });
});
