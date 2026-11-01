import { describe, expect, it } from "vitest";
import { providerChain } from "@/lib/ai/registry";
import { readEnv } from "@/lib/env";
import {
  ALERT_COOLDOWN_MS,
  MAX_AUTO_RETRIES,
  RETRY_BASE_MS,
  alertProblems,
  autoRetryDecision,
  isEventfulCycle,
  shouldAlert,
  type AutopilotSummary,
} from "@/modules/autopilot/policy";

const now = new Date("2026-11-01T12:00:00Z");
const ago = (ms: number) => new Date(now.getTime() - ms);

describe("autoRetryDecision", () => {
  it("retries a task with no recorded failed run straight away", () => {
    expect(autoRetryDecision(0, now, now)).toEqual({ retry: true });
  });
  it("waits 30 min after the first failure", () => {
    expect(autoRetryDecision(1, ago(RETRY_BASE_MS - 1), now)).toEqual({ retry: false, reason: "cooling_down" });
    expect(autoRetryDecision(1, ago(RETRY_BASE_MS), now)).toEqual({ retry: true });
  });
  it("doubles the wait after each further failure", () => {
    expect(autoRetryDecision(2, ago(RETRY_BASE_MS * 2 - 1), now)).toMatchObject({ retry: false });
    expect(autoRetryDecision(2, ago(RETRY_BASE_MS * 2), now)).toEqual({ retry: true });
  });
  it("stops after the retry budget is used and hands over to the Founder", () => {
    expect(autoRetryDecision(MAX_AUTO_RETRIES, ago(10 * RETRY_BASE_MS), now)).toEqual({ retry: false, reason: "exhausted" });
  });
});

const quiet: AutopilotSummary = { requeued: 0, needsFounder: 0, ran: 0, succeeded: 0, failed: 0, waitingForAi: 0, aiConfigured: true };

describe("alerts", () => {
  it("stays silent on routine cycles, including single failures that will retry", () => {
    expect(alertProblems(quiet)).toEqual([]);
    expect(alertProblems({ ...quiet, ran: 2, succeeded: 1, failed: 1 })).toEqual([]);
  });
  it("flags a cycle where every attempted task failed", () => {
    expect(alertProblems({ ...quiet, ran: 2, failed: 2 })).toHaveLength(1);
  });
  it("flags tasks that used up their retries", () => {
    expect(alertProblems({ ...quiet, needsFounder: 1 })[0]).toContain("stopped retrying");
  });
  it("flags waiting work when no AI provider is configured", () => {
    expect(alertProblems({ ...quiet, aiConfigured: false, waitingForAi: 3 })[0]).toContain("no AI provider");
    expect(alertProblems({ ...quiet, aiConfigured: false, waitingForAi: 0 })).toEqual([]);
  });
  it("sends at most one alert per cooldown window", () => {
    expect(shouldAlert(0, null, now)).toBe(false);
    expect(shouldAlert(1, null, now)).toBe(true);
    expect(shouldAlert(1, ago(ALERT_COOLDOWN_MS - 1), now)).toBe(false);
    expect(shouldAlert(1, ago(ALERT_COOLDOWN_MS), now)).toBe(true);
  });
  it("only audits cycles that did something", () => {
    expect(isEventfulCycle(quiet)).toBe(false);
    expect(isEventfulCycle({ ...quiet, ran: 1 })).toBe(true);
    expect(isEventfulCycle({ ...quiet, requeued: 1 })).toBe(true);
  });
});

describe("providerChain (AI failover)", () => {
  const all = { OLLAMA_BASE_URL: "http://localhost:11434", OPENAI_COMPATIBLE_BASE_URL: "https://free.example/v1", OPENAI_COMPATIBLE_MODEL: "m", ANTHROPIC_API_KEY: "k" };
  const ids = (e: Record<string, string>) => providerChain(readEnv(e)).map((p) => p.id);

  it("is empty when nothing is configured", () => {
    expect(ids({})).toEqual([]);
  });
  it("puts the main provider first and keeps paid Anthropic out of the free fallback", () => {
    expect(ids(all)).toEqual(["ollama", "openai-compatible"]);
  });
  it("respects AI_PROVIDER as the main provider", () => {
    expect(ids({ ...all, AI_PROVIDER: "openai-compatible" })).toEqual(["openai-compatible", "ollama"]);
    expect(ids({ ...all, AI_PROVIDER: "anthropic" })).toEqual(["anthropic", "ollama", "openai-compatible"]);
  });
  it("only falls back to Anthropic when AI_FALLBACK=all", () => {
    expect(ids({ ...all, AI_FALLBACK: "all" })).toEqual(["ollama", "openai-compatible", "anthropic"]);
  });
  it("never falls back when AI_FALLBACK=off, and treats bad values as the safe default", () => {
    expect(ids({ ...all, AI_FALLBACK: "off" })).toEqual(["ollama"]);
    expect(readEnv({ AI_FALLBACK: "everything" }).AI_FALLBACK).toBe("free");
  });
});
