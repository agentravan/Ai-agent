import { describe, expect, it, vi } from "vitest";
import { withRetry } from "@/lib/ai/retry";
import { AiError } from "@/lib/ai/types";

const sleep = vi.fn(async () => {});

describe("withRetry", () => {
  it("retries retryable errors up to the bound, with backoff", async () => {
    const fn = vi.fn().mockRejectedValueOnce(new AiError("busy", true)).mockRejectedValueOnce(new AiError("busy", true)).mockResolvedValue("ok");
    await expect(withRetry(fn, { attempts: 3, sleep, baseDelayMs: 100 })).resolves.toEqual({ value: "ok", attempts: 3 });
    expect(sleep).toHaveBeenNthCalledWith(1, 100);
    expect(sleep).toHaveBeenNthCalledWith(2, 200);
  });
  it("stops after max attempts", async () => {
    const fn = vi.fn().mockRejectedValue(new AiError("down", true));
    await expect(withRetry(fn, { attempts: 2, sleep })).rejects.toThrow("down");
    expect(fn).toHaveBeenCalledTimes(2);
  });
  it("does not retry non-retryable errors", async () => {
    const fn = vi.fn().mockRejectedValue(new AiError("bad key", false, 401));
    await expect(withRetry(fn, { attempts: 5, sleep })).rejects.toThrow("bad key");
    expect(fn).toHaveBeenCalledTimes(1);
  });
  it("reports each attempt", async () => {
    const seen: number[] = [];
    await withRetry(async () => 1, { attempts: 3, onAttempt: (n) => void seen.push(n) });
    expect(seen).toEqual([1]);
  });
});
