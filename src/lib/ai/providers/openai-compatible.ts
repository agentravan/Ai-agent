import { requestJson, trimSlash } from "../http";
import type { AiProvider } from "../types";

const safeHost = (url: string) => { try { return new URL(url).hostname; } catch { return ""; } };

interface ChatResponse {
  choices?: { message?: { content?: string | null }; finish_reason?: string }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

/** Adapter for any OpenAI-compatible /chat/completions endpoint (LM Studio, vLLM, hosted free tiers…). */
export function openAiCompatibleProvider(baseUrl: string, model: string, apiKey?: string): AiProvider {
  const base = trimSlash(baseUrl);
  const headers: Record<string, string> = apiKey ? { authorization: `Bearer ${apiKey}` } : {};
  // OpenRouter: keep "thinking" models short so the answer arrives before the timeout (ignored by models without reasoning).
  const extra = /(^|\.)openrouter\.ai$/i.test(safeHost(base)) ? { reasoning: { effort: "low" } } : {};
  return {
    id: "openai-compatible",
    label: "OpenAI-compatible",
    model,
    async generate({ system, prompt, maxTokens = 1024, json, signal }) {
      const data = await requestJson<ChatResponse>(`${base}/chat/completions`, {
        method: "POST",
        headers,
        signal,
        body: JSON.stringify({
          model,
          max_tokens: maxTokens,
          temperature: 0.2,
          ...extra,
          ...(json ? { response_format: { type: "json_object" } } : {}),
          messages: [
            { role: "system", content: system },
            { role: "user", content: prompt },
          ],
        }),
      });
      const choice = data.choices?.[0];
      return {
        text: choice?.message?.content ?? "",
        finishReason: choice?.finish_reason,
        inputTokens: data.usage?.prompt_tokens ?? 0,
        outputTokens: data.usage?.completion_tokens ?? 0,
      };
    },
    async health(signal) {
      await requestJson(`${base}/models`, { method: "GET", headers, signal });
      return { ok: true, detail: `Endpoint reachable · model ${model}` };
    },
  };
}
