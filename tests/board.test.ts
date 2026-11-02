import { describe, expect, it } from "vitest";
import { formatInrCompact, formatUsdCompact } from "@/lib/utilities/format";
import { cleanSpeech, closingPrompt, pickBoard, speakerPrompt, transcript } from "@/modules/board/logic";
import { growthStage, northStarLadder } from "@/modules/cockpit/metrics";
import { MISSION, northStarLabel } from "@/modules/orchestration/mission";

const agent = (name: string, tier: "ceo" | "coo" | "executive" | "manager" | "worker", designation: string, status = "active") => ({ name, tier, designation, status });

describe("board seating", () => {
  const team = [
    agent("Ledger", "executive", "Chief Financial Officer"),
    agent("Themis", "executive", "Chief Legal & Compliance Officer"),
    agent("Nova", "executive", "Chief Growth Officer"),
    agent("Orion", "coo", "Chief Operating Officer"),
    agent("Atlas", "ceo", "Chief Executive Officer"),
    agent("Iris", "manager", "Sales & Outreach Manager"),
  ];
  it("seats CEO, COO, CFO and Legal Head in speaking order", () => {
    expect(pickBoard(team).map((s) => `${s.role}:${s.agent.name}`)).toEqual(["ceo:Atlas", "coo:Orion", "cfo:Ledger", "legal:Themis"]);
  });
  it("skips suspended or missing members", () => {
    const seats = pickBoard(team.map((a) => (a.name === "Themis" ? { ...a, status: "suspended" } : a)).filter((a) => a.name !== "Orion"));
    expect(seats.map((s) => s.role)).toEqual(["ceo", "cfo"]);
  });
});

describe("board prompts", () => {
  const lines = [{ speaker: "Atlas · CEO", body: "Websites for gyms first." }, { speaker: "Orion · COO", body: "x", failed: true }];
  it("builds the transcript from successful turns only", () => {
    expect(transcript(lines)).toBe("Atlas · CEO: Websites for gyms first.");
    expect(transcript([])).toMatch(/nobody has spoken/);
  });
  it("gives each role its own brief and the discussion so far", () => {
    const p = speakerPrompt("legal", "Gym websites in Gurugram", lines);
    expect(p).toContain("Gym websites in Gurugram");
    expect(p).toContain("Websites for gyms first.");
    expect(p).toMatch(/allowed with conditions/);
    expect(speakerPrompt("cfo", "t", [])).toMatch(/₹0 until the profit gate/);
  });
  it("closes with the governed plan format", () => {
    const p = closingPrompt("t", lines, "Atlas (CEO)", "Lead generation");
    expect(p).toContain("Atlas (CEO)");
    expect(p).toContain("Lead generation");
    expect(p).toContain('"steps"');
  });
  it("caps speech length", () => {
    expect(cleanSpeech("```\nhi\n```")).toBe("hi");
    expect(cleanSpeech("a".repeat(7000)).length).toBe(6000);
  });
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
