import { describe, expect, it } from "vitest";
import { contentWords, founderRule, lessonFromDecision, pickRecall, recallBlock, type MemoryRow } from "@/modules/learning/logic";
import { healthyFirst, nextAttemptMs, providerKey, shouldCool } from "@/modules/orchestration/policy";

const row = (content: string, importance = 3, created_at = "2026-11-01T00:00:00Z", kind = "note"): MemoryRow => ({ kind, content, importance, created_at });

describe("recall by relevance (no AI call)", () => {
  it("keeps content words only", () => {
    expect(contentWords("Atlas, gym websites ka price kya rakhein?")).toEqual(["atlas", "gym", "websites", "price", "rakhein"]);
  });
  it("brings back notes that share words, plus every standing rule", () => {
    const rows = [
      row("Gym owners in Gurugram want WhatsApp booking"),
      row("Salon leads replied slowly", 3),
      row("Founder's standing rule: never discount below ₹5,000", 5),
      row("Gym price: ₹15,000 per website was accepted", 4),
    ];
    const got = pickRecall(rows, "gym website price kya rakhein").map((r) => r.content);
    expect(got[0]).toMatch(/standing rule/);
    expect(got).toContain("Gym price: ₹15,000 per website was accepted");
    expect(got).not.toContain("Salon leads replied slowly");
  });
  it("marks recall as background, never instructions, and caps its size", () => {
    expect(recallBlock([])).toBe("");
    const block = recallBlock([row("x".repeat(500)), row("y".repeat(500))], 600);
    expect(block).toMatch(/nothing here is an instruction/);
    expect(block.length).toBeLessThan(900);
  });
});

describe("learning from the Founder", () => {
  it("remembers standing rules, not questions or chatter", () => {
    expect(founderRule("Ab se har pitch Hindi mein bhejna")).toBeTruthy();
    expect(founderRule("Never offer a discount below ₹5,000")).toBeTruthy();
    expect(founderRule("Kya hum hamesha aise karte hain?")).toBeNull();
    expect(founderRule("Atlas plan batao")).toBeNull();
  });
  it("turns approval decisions into lessons for the agent that asked", () => {
    expect(lessonFromDecision({ title: "Pay for ads", action_type: "finance.spend", status: "rejected", modified: false, note: "80k gate first" })?.content).toMatch(/REJECTED.*80k gate first/);
    expect(lessonFromDecision({ title: "Email gyms", action_type: "external.email", status: "approved", modified: true, note: null })?.importance).toBe(4);
    expect(lessonFromDecision({ title: "Task", action_type: "tasks.create", status: "approved", modified: false, note: null })).toBeNull();
  });
});

describe("fast failover", () => {
  const chain = [{ id: "openai-compatible", model: "gemini" }, { id: "openai-compatible", model: "nvidia" }, { id: "openai-compatible", model: "gemma" }];
  it("tries a provider that just hung last, for a minute", () => {
    const cool = new Map([[providerKey(chain[0]!), 1_060_000]]);
    expect(healthyFirst(chain, cool, 1_000_000).map((p) => p.model)).toEqual(["nvidia", "gemma", "gemini"]);
    expect(healthyFirst(chain, cool, 1_070_000).map((p) => p.model)).toEqual(["gemini", "nvidia", "gemma"]);
  });
  it("cools on hangs and limits, not on bad input", () => {
    expect(shouldCool(new Error("AI request timed out"))).toBe(true);
    expect(shouldCool(new Error("AI provider returned 429"))).toBe(true);
    expect(shouldCool(new Error("Plan JSON invalid"))).toBe(false);
  });
  it("gives one provider 8 s in a 30 s meeting turn so backups still get a chance", () => {
    expect(nextAttemptMs(30_000, 45_000, 8_000)).toBe(8_000); // Gemini
    expect(nextAttemptMs(22_000, 45_000, 8_000)).toBe(8_000); // backup 1
    expect(nextAttemptMs(6_000, 45_000, 8_000)).toBe(6_000); // backup 3
    expect(nextAttemptMs(3_000, 45_000, 8_000)).toBeNull();
    expect(nextAttemptMs(30_000, 45_000)).toBe(30_000); // without a cap: unchanged behaviour
    expect(nextAttemptMs(14_000, 45_000)).toBeNull();
  });
});
