import { env as defaultEnv, type Env } from "@/lib/env";
import { anthropicProvider } from "./providers/anthropic";
import { ollamaProvider } from "./providers/ollama";
import { openAiCompatibleProvider } from "./providers/openai-compatible";
import type { AiProvider, ProviderId } from "./types";

/** All providers that have the configuration they need, in preference order (free first). */
export function configuredProviders(e: Env = defaultEnv): AiProvider[] {
  const list: AiProvider[] = [];
  if (e.OLLAMA_BASE_URL) list.push(ollamaProvider(e.OLLAMA_BASE_URL, e.OLLAMA_MODEL));
  if (e.OPENAI_COMPATIBLE_BASE_URL && e.OPENAI_COMPATIBLE_MODEL)
    list.push(openAiCompatibleProvider(e.OPENAI_COMPATIBLE_BASE_URL, e.OPENAI_COMPATIBLE_MODEL, e.OPENAI_COMPATIBLE_API_KEY));
  if (e.ANTHROPIC_API_KEY) list.push(anthropicProvider(e.ANTHROPIC_API_KEY, e.ANTHROPIC_MODEL));
  return list;
}

/** The active provider: AI_PROVIDER if configured, else the first configured one, else null. */
export function activeProvider(e: Env = defaultEnv): AiProvider | null {
  const list = configuredProviders(e);
  if (e.AI_PROVIDER) return list.find((p) => p.id === e.AI_PROVIDER) ?? null;
  return list[0] ?? null;
}

/**
 * Providers to try in order when running an agent: the active one first, then the other configured
 * providers allowed by AI_FALLBACK. Anthropic (paid) is only a fallback when AI_FALLBACK="all".
 */
export function providerChain(e: Env = defaultEnv): AiProvider[] {
  const primary = activeProvider(e);
  if (!primary) return [];
  if (e.AI_FALLBACK === "off") return [primary];
  const backups = configuredProviders(e).filter((p) => p.id !== primary.id && (e.AI_FALLBACK === "all" || p.id !== "anthropic"));
  return [primary, ...backups];
}

export interface AiStatus {
  available: boolean;
  provider: ProviderId | null;
  label: string;
  model: string | null;
  detail: string;
}

/** Live connectivity probe (short timeout). Never throws. */
export async function aiStatus(e: Env = defaultEnv, timeoutMs = 3_000): Promise<AiStatus> {
  const p = activeProvider(e);
  if (!p) {
    const detail = e.AI_PROVIDER
      ? `AI_PROVIDER="${e.AI_PROVIDER}" is selected but not configured.`
      : "No AI provider configured. AI execution is unavailable; all other features work.";
    return { available: false, provider: null, label: "Not configured", model: null, detail };
  }
  try {
    const h = await p.health(AbortSignal.timeout(timeoutMs));
    return { available: h.ok, provider: p.id, label: p.label, model: p.model, detail: h.detail };
  } catch (err) {
    return { available: false, provider: p.id, label: p.label, model: p.model, detail: (err as Error).message };
  }
}

export function estimateCostCents(inputTokens: number, outputTokens: number, e: Env = defaultEnv): number {
  const cents = (inputTokens * e.AI_COST_INPUT_CENTS_PER_MTOK + outputTokens * e.AI_COST_OUTPUT_CENTS_PER_MTOK) / 1_000_000;
  return Math.round(cents * 10_000) / 10_000;
}
