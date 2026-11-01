import { describe, expect, it } from "vitest";
import { AiError } from "@/lib/ai/types";
import { parsePlan } from "@/modules/orchestration/plan";

const valid = { summary: "Grow", steps: [{ action: "create_task", title: "Write landing page" }] };

describe("parsePlan", () => {
  it("parses bare JSON and applies safe defaults", () => {
    const plan = parsePlan(JSON.stringify(valid));
    expect(plan.steps[0]).toMatchObject({ priority: "medium", risk: "low", description: "" });
  });
  it("extracts JSON from fenced, chatty output", () => {
    expect(parsePlan(`Sure!\n\`\`\`json\n${JSON.stringify(valid)}\n\`\`\`\nDone.`).summary).toBe("Grow");
  });
  it("treats an unknown risk value as high (fail-safe)", () => {
    const plan = parsePlan(JSON.stringify({ summary: "x", steps: [{ action: "create_task", title: "t", risk: "extreme" }] }));
    expect(plan.steps[0]?.risk).toBe("high");
  });
  it("rejects unknown actions as retryable", () => {
    const err = (() => { try { parsePlan(JSON.stringify({ summary: "x", steps: [{ action: "wire_money", title: "t" }] })); } catch (e) { return e; } })();
    expect(err).toBeInstanceOf(AiError);
    expect((err as AiError).retryable).toBe(true);
  });
  it("rejects missing or malformed JSON", () => {
    expect(() => parsePlan("no plan here")).toThrow(AiError);
    expect(() => parsePlan("{ not json }")).toThrow(/malformed/);
  });
  it("caps plans at 10 steps", () => {
    const steps = Array.from({ length: 11 }, (_, i) => ({ action: "create_task", title: `t${i}` }));
    expect(() => parsePlan(JSON.stringify({ summary: "x", steps }))).toThrow(AiError);
  });
});
