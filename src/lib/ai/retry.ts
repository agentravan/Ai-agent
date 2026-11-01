import { AiError } from "./types";

export interface RetryOptions {
  attempts: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  onAttempt?: (attempt: number) => void | Promise<void>;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export const isRetryable = (err: unknown) => err instanceof AiError && err.retryable;

/** Bounded retry with exponential backoff. Non-retryable errors fail immediately. */
export async function withRetry<T>(fn: (attempt: number) => Promise<T>, opts: RetryOptions): Promise<{ value: T; attempts: number }> {
  const attempts = Math.max(1, Math.floor(opts.attempts));
  const { baseDelayMs = 500, maxDelayMs = 8_000, sleep = defaultSleep } = opts;
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    await opts.onAttempt?.(attempt);
    try {
      return { value: await fn(attempt), attempts: attempt };
    } catch (err) {
      lastError = err;
      if (!isRetryable(err) || attempt === attempts) break;
      await sleep(Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1)));
    }
  }
  throw lastError;
}
