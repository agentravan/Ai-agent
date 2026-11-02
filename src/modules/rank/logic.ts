/** Pure rank-tracker rules. No I/O: unit-tested. */

/** Each keyword is checked at most once per this window (Google rankings move daily, not hourly). */
export const CHECK_INTERVAL_MS = 20 * 60 * 60_000;
/** Bounded so one organisation can't run up Google usage. */
export const MAX_ACTIVE_KEYWORDS = 25;

export function isDue(lastCheckedAt: string | null, now: Date): boolean {
  return !lastCheckedAt || now.getTime() - Date.parse(lastCheckedAt) >= CHECK_INTERVAL_MS;
}

export type Trend = "new" | "up" | "down" | "same" | "entered" | "lost" | "absent";

/** Compares two positions (null = not in Google's top 60). Lower number = better. */
export function trend(previous: number | null | undefined, current: number | null): Trend {
  if (previous === undefined) return current === null ? "absent" : "new";
  if (previous === null && current === null) return "absent";
  if (previous === null) return "entered";
  if (current === null) return "lost";
  return current < previous ? "up" : current > previous ? "down" : "same";
}

export function describeRank(position: number | null, scanned: number): string {
  if (position !== null) return `#${position}`;
  return scanned ? `not in top ${scanned}` : "no results";
}
