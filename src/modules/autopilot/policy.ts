/** Pure self-healing rules for the scheduled autopilot. No I/O: fully unit-tested. */

/** A task gets this many automatic retries before it waits for the Founder. */
export const MAX_AUTO_RETRIES = 3;
/** Wait after the 1st failure; doubles after each further failure (30 min → 1 h → 2 h). */
export const RETRY_BASE_MS = 30 * 60_000;
/** At most one "autopilot needs you" email per window, so a lasting problem doesn't flood the inbox. */
export const ALERT_COOLDOWN_MS = 12 * 60 * 60_000;

export type RetryDecision = { retry: true } | { retry: false; reason: "exhausted" | "cooling_down" };

/** Decides whether a failed task should be put back in the queue now. */
export function autoRetryDecision(failedRuns: number, lastFailureAt: Date | null, now: Date): RetryDecision {
  if (failedRuns >= MAX_AUTO_RETRIES) return { retry: false, reason: "exhausted" };
  if (failedRuns <= 0) return { retry: true }; // marked failed without an AI run: nothing to back off from
  const wait = RETRY_BASE_MS * 2 ** (failedRuns - 1);
  if (lastFailureAt && now.getTime() - lastFailureAt.getTime() < wait) return { retry: false, reason: "cooling_down" };
  return { retry: true };
}

export interface AutopilotSummary {
  /** Failed tasks put back in the queue this cycle. */
  requeued: number;
  /** Failed tasks that used up their automatic retries and now need the Founder. */
  needsFounder: number;
  /** Tasks attempted this cycle, and how they ended. */
  ran: number;
  succeeded: number;
  failed: number;
  /** Ready tasks left waiting because no AI provider is configured. */
  waitingForAi: number;
  aiConfigured: boolean;
}

/** Problems worth the Founder's attention, in plain words. Routine failures that will retry are not problems. */
export function alertProblems(s: AutopilotSummary): string[] {
  const out: string[] = [];
  if (!s.aiConfigured && s.waitingForAi > 0)
    out.push(`${s.waitingForAi} task(s) are waiting, but no AI provider is configured, so agents cannot work.`);
  if (s.ran > 0 && s.succeeded === 0)
    out.push(`All ${s.ran} task(s) attempted this cycle failed. The AI provider may be down or out of limits; autopilot will retry.`);
  if (s.needsFounder > 0)
    out.push(`${s.needsFounder} task(s) failed ${MAX_AUTO_RETRIES} times and have stopped retrying. Open Projects, check the error, then press Run.`);
  return out;
}

export function shouldAlert(problemCount: number, lastAlertAt: Date | null, now: Date): boolean {
  if (problemCount === 0) return false;
  return !lastAlertAt || now.getTime() - lastAlertAt.getTime() >= ALERT_COOLDOWN_MS;
}

/** Whether a cycle did anything worth an audit entry (quiet cycles are not logged, to keep the audit trail readable). */
export const isEventfulCycle = (s: AutopilotSummary) => s.requeued > 0 || s.ran > 0;
