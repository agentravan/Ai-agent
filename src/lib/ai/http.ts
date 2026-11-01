import { AiError } from "./types";

/** JSON POST/GET with status-aware retry classification. */
export async function requestJson<T>(url: string, init: RequestInit & { body?: string }): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, headers: { "content-type": "application/json", ...init.headers } });
  } catch (err) {
    if (init.signal?.aborted) throw new AiError("AI request timed out", true);
    throw new AiError(`AI provider unreachable: ${(err as Error).message}`, true);
  }
  if (!res.ok) {
    const body = (await res.text().catch(() => "")).slice(0, 300);
    const retryable = res.status === 408 || res.status === 429 || res.status >= 500;
    throw new AiError(`AI provider returned ${res.status}: ${body}`, retryable, res.status);
  }
  return (await res.json()) as T;
}

export const trimSlash = (u: string) => u.replace(/\/+$/, "");
