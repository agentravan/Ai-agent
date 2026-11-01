import { requestJson } from "../http";
import type { AiProvider } from "../types";

interface MessagesResponse {
  content?: { type: string; text?: string }[];
  usage?: { input_tokens?: number; output_tokens?: number };
}

const API = "https://api.anthropic.com/v1";

export function anthropicProvider(apiKey: string, model: string): AiProvider {
  const headers = { "x-api-key": apiKey, "anthropic-version": "2023-06-01" };
  return {
    id: "anthropic",
    label: "Claude (Anthropic)",
    model,
    async generate({ system, prompt, maxTokens = 1024, signal }) {
      const data = await requestJson<MessagesResponse>(`${API}/messages`, {
        method: "POST",
        headers,
        signal,
        body: JSON.stringify({ model, max_tokens: maxTokens, system, messages: [{ role: "user", content: prompt }] }),
      });
      return {
        text: (data.content ?? []).filter((b) => b.type === "text").map((b) => b.text ?? "").join(""),
        inputTokens: data.usage?.input_tokens ?? 0,
        outputTokens: data.usage?.output_tokens ?? 0,
      };
    },
    async health(signal) {
      // Listing models is free and validates the key without spending tokens.
      await requestJson(`${API}/models?limit=1`, { method: "GET", headers, signal });
      return { ok: true, detail: `API key valid · model ${model}` };
    },
  };
}
