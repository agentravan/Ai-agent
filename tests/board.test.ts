import { describe, expect, it } from "vitest";
import { formatInrCompact, formatUsdCompact } from "@/lib/utilities/format";
import { addressedSeats, friendlyFailure, routeTurn, cleanSpeech, spoken, dueStandup, isPass, istDate, momToPlan, openingPrompt, parseMom, pickBoard, pickTeam, replyPrompt, transcript } from "@/modules/board/logic";
import { growthStage, northStarLadder } from "@/modules/cockpit/metrics";
import { MISSION, northStarLabel } from "@/modules/orchestration/mission";
import { AiError } from "@/lib/ai/types";

type T = "ceo" | "coo" | "executive" | "manager" | "worker";
const agent = (name: string, tier: T, designation: string, status = "active", manager_id: string | null = null) => ({ id: name, name, tier, designation, status, manager_id });
const team = [
  agent("Ledger", "executive", "Chief Financial Officer"),
  agent("Themis", "executive", "Chief Legal & Compliance Officer"),
  agent("Nova", "executive", "Chief Growth Officer"),
  agent("Orion", "coo", "Chief Operating Officer"),
  agent("Atlas", "ceo", "Chief Executive Officer"),
  agent("Iris", "manager", "Sales & Outreach Manager", "active", "Nova"),
  agent("Hera", "manager", "HR Services Manager", "active", "Nova"),
  agent("Scribe", "worker", "Meeting Secretary", "active", "Nova"),
];

describe("who sits in the room", () => {
  it("seats CEO, COO, CFO and Legal Head in speaking order with their colours", () => {
    expect(pickBoard(team).map((s) => `${s.role}:${s.agent.name}`)).toEqual(["ceo:Atlas", "coo:Orion", "cfo:Ledger", "legal:Themis"]);
    expect(pickBoard(team)[0]!.color).toBe("#3b82f6");
  });
  it("seats the Idea Court's judge with the board when Nyaya is active", () => {
    const withJudge = [...team, agent("Nyaya", "worker", "Idea Court — Judge & Strategy Reviewer")];
    expect(pickBoard(withJudge).map((s) => s.role)).toEqual(["ceo", "coo", "cfo", "legal", "judge"]);
    expect(routeTurn("Nyaya, ye idea sahi hai kya?", pickBoard(withJudge)).answer).toEqual(["Nyaya"]);
    expect(routeTurn("Is idea ka verdict kya hai?", pickBoard(withJudge)).answer).toEqual(["Nyaya"]);
  });
  it("skips suspended or missing members", () => {
    const seats = pickBoard(team.map((a) => (a.name === "Themis" ? { ...a, status: "suspended" } : a)).filter((a) => a.name !== "Orion"));
    expect(seats.map((s) => s.role)).toEqual(["ceo", "cfo"]);
  });
  it("puts a team meeting's host first with their reports, never the Scribe", () => {
    expect(pickTeam(team, "Nova").map((s) => s.agent.name)).toEqual(["Nova", "Iris", "Hera"]);
    expect(pickTeam(team, "nobody")).toEqual([]);
  });
});

describe("live conversation", () => {
  const seats = pickBoard(team);
  const lines = [{ speaker: "Atlas · CEO", body: "Websites for gyms first." }, { speaker: "Orion · COO", body: "x", failed: true }];
  it("builds the transcript from successful turns only", () => {
    expect(transcript(lines)).toBe("Atlas · CEO: Websites for gyms first.");
    expect(transcript([])).toMatch(/nobody has spoken/);
  });
  it("asks every member for their lens, the risk and the profit angle", () => {
    const p = openingPrompt(seats[3]!, "Gym websites in Gurugram", lines, "From the last meeting: call 5 gyms", "Harshit");
    expect(p).toContain("Gym websites in Gurugram");
    expect(p).toContain("call 5 gyms");
    expect(p).toMatch(/one risk or profit point/);
    expect(p).toMatch(/allowed with conditions/);
    expect(p).toMatch(/Never invent colleagues/);
    expect(openingPrompt(seats[0]!, "t", [], "", "Harshit", true)).toMatch(/You are chairing/);
  });
  it("finds who the Founder is talking to by name or title", () => {
    expect([...addressedSeats("Ledger, price kya rakhein?", seats)]).toEqual(["Ledger"]);
    expect([...addressedSeats("CFO aur legal dono batao", seats)].sort()).toEqual(["Ledger", "Themis"]);
    expect(addressedSeats("sab log batao", seats).size).toBe(0);
  });
  it("lets members who were not asked pass", () => {
    expect(replyPrompt(seats[1]!, "t", lines, "Ledger?", "other")).toMatch(/exactly PASS/);
    expect(replyPrompt(seats[2]!, "t", lines, "Ledger?", "me", "Harshit")).toMatch(/Harshit is asking YOU/);
    expect(isPass("PASS")).toBe(true);
    expect(isPass(" pass. ")).toBe(true);
    expect(isPass("Pass karte hain is idea ko, but…")).toBe(false);
  });
  it("routes the Founder's line like a real meeting", () => {
    expect(routeTurn("kya meri awaaz aa rahi hai", seats)).toEqual({ answer: ["Atlas"], may: [] });
    expect(routeTurn("Gym website ka price kya rakhein?", seats).answer).toEqual(["Ledger"]);
    expect(routeTurn("GST lagega kya?", seats).answer).toEqual(["Themis"]);
    expect(routeTurn("Themis, contract chahiye?", seats)).toEqual({ answer: ["Themis"], may: ["Atlas", "Orion", "Ledger"] });
    expect(routeTurn("Is hafte ka focus kya ho?", seats)).toEqual({ answer: ["Atlas"], may: ["Orion", "Ledger", "Themis"] });
  });
  it("keeps spoken turns short, without lists or a cut-off word", () => {
    expect(spoken("Founder, 1. Pehle leads. 2. Phir pitch.")).toBe("Pehle leads. Phir pitch.");
    const long = "Dekho, ye plan theek hai. ".repeat(30);
    const out = spoken(long);
    expect(out.length).toBeLessThanOrEqual(320);
    expect(out.endsWith(".")).toBe(true);
  });
  it("explains failures in plain words", () => {
    expect(friendlyFailure('AI provider returned 401: {"error":{"message":"No cookie auth credentials found"}}')).toMatch(/key problem/);
    expect(friendlyFailure("AI provider returned 429: rate-limited")).toMatch(/free limit/);
    expect(friendlyFailure("503 Service temporarily overloaded")).toMatch(/overloaded/);
  });
  it("cleans speech for reading aloud", () => {
    expect(cleanSpeech("```\n**hi**\n```")).toBe("hi");
    expect(cleanSpeech("a".repeat(7000)).length).toBe(6000);
  });
});

describe("minutes of meeting", () => {
  const mom = parseMom(`Here: {"summary":"Gym websites first","decisions":["Target Gurugram gyms"],
    "action_items":[{"owner":"Iris","task":"Find 20 gyms","due":"Friday","needs_approval":false},
      {"owner":"Founder","task":"Call 3 gyms","due":"today","needs_approval":false},
      {"owner":"Atlas (CEO)","task":"Email pitches","due":"","needs_approval":true},
      {"owner":"Stranger","task":"Ignore me","due":"","needs_approval":false}],
    "risks":["Spam complaints"],"opportunities":[],"follow_ups":["Replies count"],"next_agenda":["Pricing"]}`);
  it("parses the minutes and rejects garbage as retryable", () => {
    expect(mom.decisions).toEqual(["Target Gurugram gyms"]);
    expect(() => parseMom("no json")).toThrow(AiError);
  });
  it("turns action items into governed steps; unknown owners are dropped", () => {
    const plan = momToPlan(mom, ["Atlas", "Iris"])!;
    expect(plan.steps.map((s) => `${s.action}:${s.assignee ?? "-"}:${s.risk}`)).toEqual(["create_task:Iris:low", "create_founder_task:-:low", "create_task:Atlas:high"]);
    expect(momToPlan({ ...mom, action_items: [] }, ["Atlas"])).toBeNull();
  });
});

describe("daily stand-ups (IST)", () => {
  const at = (iso: string) => new Date(iso);
  it("holds the morning one from 09:00 and the evening one from 19:00, once each", () => {
    expect(dueStandup(at("2026-11-02T02:00:00Z"), [])).toBeNull(); // 07:30 IST
    expect(dueStandup(at("2026-11-02T03:35:00Z"), [])).toBe("morning"); // 09:05 IST
    expect(dueStandup(at("2026-11-02T03:35:00Z"), ["morning"])).toBeNull();
    expect(dueStandup(at("2026-11-02T13:40:00Z"), ["morning"])).toBe("evening"); // 19:10 IST
    expect(dueStandup(at("2026-11-02T13:40:00Z"), ["morning", "evening"])).toBeNull();
  });
  it("uses the Indian calendar date", () => expect(istDate(at("2026-11-02T20:00:00Z"))).toBe("2026-11-03"));
});

describe("$100B North Star", () => {
  const usd = 100_000_000_000;
  const cents = usd * 95 * 100;
  it("labels the target in dollars and rupees", () => {
    expect(formatUsdCompact(usd)).toBe("$100 billion");
    expect(formatInrCompact(cents)).toBe("₹9.5 lakh crore");
    expect(northStarLabel(usd, 95, cents)).toBe("$100 billion (≈ ₹9.5 lakh crore at ₹95/$)");
    expect(formatInrCompact(8_000_000)).toBe("₹80,000");
  });
  it("ends the ladder at the North Star and keeps the ₹80k gate first", () => {
    const ladder = northStarLadder(cents, "$100 billion — North Star");
    expect(ladder[0]!.cents).toBe(8_000_000);
    expect(ladder.at(-1)).toEqual({ label: "$100 billion — North Star", cents });
    expect(ladder.at(-2)!.label).toBe("₹5 lakh crore");
    expect(growthStage(cents, cents)).toMatchObject({ next: null, pctToNext: 100 });
    expect(growthStage(0, cents).next!.cents).toBe(8_000_000);
  });
  it("tells every agent the mission", () => {
    expect(MISSION).toMatch(/Revenue is the survival metric/);
    expect(MISSION).toMatch(/Legal Head/);
  });
});
