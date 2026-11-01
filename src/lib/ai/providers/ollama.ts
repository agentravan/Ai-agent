import { requestJson, trimSlash } from "../http";
import type { AiProvider } from "../types";

interface ChatResponse { message?: { content?: string }; prompt_eval_count?: number; eval_count?: number }

export function ollamaProvider(baseUrl: string, model: string): AiProvider {
  const base = trimSlash(baseUrl);
  return {
    id: "ollama",
    label: "Ollama (local)",
    model,
    async generate({ system, prompt, maxTokens = 1024, json, signal }) {
      const data = await requestJson<ChatResponse>(`${base}/api/chat`, {
        method: "POST",
        signal,
        body: JSON.stringify({
          model,
          stream: false,
          ...(json ? { format: "json" } : {}),
          options: { num_predict: maxTokens, temperature: 0.2 },
          messages: [
            { role: "system", content: system },
            { role: "user", content: prompt },
          ],
        }),
      });
      return {
        text: data.message?.content ?? "",
        inputTokens: data.prompt_eval_count ?? 0,
        outputTokens: data.eval_count ?? 0,
      };
    },
    async health(signal) {
      const data = await requestJson<{ models?: { name: string }[] }>(`${base}/api/tags`, { method: "GET", signal });
      const names = data.models?.map((m) => m.name) ?? [];
      const found = names.some((n) => n === model || n.startsWith(`${model}:`));
      return found
        ? { ok: true, detail: `Model ${model} available` }
        : { ok: false, detail: `Ollama reachable but model "${model}" is not pulled (run: ollama pull ${model})` };
    },
  };
}
