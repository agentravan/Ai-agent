import { describe, expect, it, vi } from "vitest";
import { aiStatus, activeProvider, configuredProviders, estimateCostCents } from "@/lib/ai/registry";
import { isEmailAllowed, readEnv, supabaseConfig } from "@/lib/env";

describe("env", () => {
  it("degrades gracefully when nothing is configured", () => {
    const e = readEnv({});
    expect(supabaseConfig(e)).toBeNull();
    expect(e.AI_MAX_ATTEMPTS).toBe(3);
    expect(isEmailAllowed("x@y.com", e)).toBe(true);
  });
  it("clamps invalid numeric settings to safe defaults", () => {
    const e = readEnv({ AI_MAX_ATTEMPTS: "99", AI_TIMEOUT_MS: "abc" });
    expect(e.AI_MAX_ATTEMPTS).toBe(3);
    expect(e.AI_TIMEOUT_MS).toBe(60000);
  });
  it("enforces the founder allowlist case-insensitively", () => {
    const e = readEnv({ FOUNDER_EMAILS: "Founder@Empire.com, ops@empire.com" });
    expect(isEmailAllowed("founder@empire.com", e)).toBe(true);
    expect(isEmailAllowed("intruder@x.com", e)).toBe(false);
    expect(isEmailAllowed(undefined, e)).toBe(false);
  });
});

describe("AI registry", () => {
  it("has no provider when unconfigured and reports unavailable", async () => {
    const e = readEnv({});
    expect(activeProvider(e)).toBeNull();
    await expect(aiStatus(e)).resolves.toMatchObject({ available: false, provider: null });
  });
  it("prefers free providers and honours AI_PROVIDER", () => {
    const e = readEnv({ OLLAMA_BASE_URL: "http://localhost:11434", ANTHROPIC_API_KEY: "k" });
    expect(configuredProviders(e).map((p) => p.id)).toEqual(["ollama", "anthropic"]);
    expect(activeProvider(e)?.id).toBe("ollama");
    expect(activeProvider(readEnv({ OLLAMA_BASE_URL: "http://localhost:11434", ANTHROPIC_API_KEY: "k", AI_PROVIDER: "anthropic" }))?.id).toBe("anthropic");
    expect(activeProvider(readEnv({ AI_PROVIDER: "anthropic" }))).toBeNull();
  });
  it("reports unreachable providers without throwing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    const s = await aiStatus(readEnv({ OLLAMA_BASE_URL: "http://localhost:11434" }));
    expect(s).toMatchObject({ available: false, provider: "ollama" });
    expect(s.detail).toMatch(/unreachable/);
    vi.unstubAllGlobals();
  });
  it("parses Ollama chat responses", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: { content: "hi" }, prompt_eval_count: 5, eval_count: 2 }))));
    const p = activeProvider(readEnv({ OLLAMA_BASE_URL: "http://localhost:11434" }))!;
    await expect(p.generate({ system: "s", prompt: "p" })).resolves.toEqual({ text: "hi", inputTokens: 5, outputTokens: 2 });
    vi.unstubAllGlobals();
  });
  it("classifies 429 as retryable and 401 as fatal", async () => {
    const p = activeProvider(readEnv({ ANTHROPIC_API_KEY: "k" }))!;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("slow down", { status: 429 })));
    await expect(p.generate({ system: "s", prompt: "p" })).rejects.toMatchObject({ retryable: true, status: 429 });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("bad key", { status: 401 })));
    await expect(p.generate({ system: "s", prompt: "p" })).rejects.toMatchObject({ retryable: false, status: 401 });
    vi.unstubAllGlobals();
  });
  it("computes cost from configured rates", () => {
    expect(estimateCostCents(1_000_000, 500_000, readEnv({ AI_COST_INPUT_CENTS_PER_MTOK: "100", AI_COST_OUTPUT_CENTS_PER_MTOK: "500" }))).toBe(350);
    expect(estimateCostCents(1000, 1000, readEnv({}))).toBe(0);
  });
});
