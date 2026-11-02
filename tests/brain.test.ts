import { describe, expect, it } from "vitest";
import { readEnv } from "@/lib/env";
import { backupServices, fallbackModels, providerChain } from "@/lib/ai/registry";
import { speedHints } from "@/lib/ai/providers/openai-compatible";

const base = { AI_PROVIDER: "openai-compatible", OPENAI_COMPATIBLE_BASE_URL: "https://openrouter.ai/api/v1", OPENAI_COMPATIBLE_MODEL: "main:free" };

describe("backup models (free-tier resilience)", () => {
  it("parses, dedupes, drops the main model and caps at 3", () => {
    expect(fallbackModels(readEnv({ ...base, OPENAI_COMPATIBLE_FALLBACK_MODELS: " b:free, c:free ,b:free,main:free,d:free,e:free" }))).toEqual(["b:free", "c:free", "d:free"]);
    expect(fallbackModels(readEnv(base))).toEqual([]);
  });
  it("tries the main model first, then each backup on the same endpoint", () => {
    const chain = providerChain(readEnv({ ...base, OPENAI_COMPATIBLE_FALLBACK_MODELS: "b:free,c:free" }));
    expect(chain.map((p) => `${p.id}/${p.model}`)).toEqual(["openai-compatible/main:free", "openai-compatible/b:free", "openai-compatible/c:free"]);
  });
  it("respects AI_FALLBACK=off", () => {
    expect(providerChain(readEnv({ ...base, OPENAI_COMPATIBLE_FALLBACK_MODELS: "b:free", AI_FALLBACK: "off" }))).toHaveLength(1);
  });
  it("bounds the total run time under the function limit", () => {
    expect(readEnv({}).AI_RUN_BUDGET_MS).toBe(240_000);
    expect(readEnv({ AI_RUN_BUDGET_MS: "999999" }).AI_RUN_BUDGET_MS).toBe(240_000);
  });
});

describe("backup services on other endpoints", () => {
  const env = readEnv({
    ...base, OPENAI_COMPATIBLE_FALLBACK_MODELS: "b:free",
    AI_BACKUP_1_BASE_URL: "https://integrate.api.nvidia.com/v1", AI_BACKUP_1_API_KEY: "k1", AI_BACKUP_1_MODEL: "nv-model",
    AI_BACKUP_2_BASE_URL: "https://openrouter.ai/api/v1", AI_BACKUP_2_MODEL: "main:free",
    AI_BACKUP_3_BASE_URL: "https://ignored.example/v1",
  });
  it("orders main model → same-service backups → other services, keeping same model ids on other services", () => {
    expect(providerChain(env).map((p) => p.model)).toEqual(["main:free", "b:free", "nv-model", "main:free"]);
  });
  it("skips incomplete slots", () => {
    expect(backupServices(readEnv({ AI_BACKUP_1_BASE_URL: "https://x.example/v1" }))).toEqual([]);
  });
  it("turns off long thinking only where the service supports it", () => {
    expect(speedHints("integrate.api.nvidia.com")).toEqual({ chat_template_kwargs: { enable_thinking: false } });
    expect(speedHints("openrouter.ai")).toEqual({ reasoning: { effort: "low" } });
    expect(speedHints("generativelanguage.googleapis.com")).toEqual({});
  });
});
