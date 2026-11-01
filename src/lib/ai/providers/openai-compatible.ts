import { requestJson, trimSlash } from "../http";
import type { AiProvider } from "../types";

interface ChatResponse {
  choices?: { message?: { content?: string } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

/** Adapter for any OpenAI-compatible /chat/completions endpoint (LM Studio, vLLM, hosted free tiers…). */
export function openAiCompatibleProvider(baseUrl: string, model: string, apiKey?: string): AiProvider {
  const base = trimSlash(baseUrl);
  const headers: Record<string, string> = apiKey ? { authorization: `Bearer ${apiKey}` } : {};
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
          ...(json ? { response_format: { type: "json_object" } } : {}),
          messages: [
            { role: "system", content: system },
            { role: "user", content: prompt },
          ],
        }),
      });
      return {
        text: data.choices?.[0]?.message?.content ?? "",
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
