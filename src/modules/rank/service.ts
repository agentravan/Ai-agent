import "server-only";
import { findBusiness, googlePlacesConfigured, MAX_RANK_DEPTH, rankForKeyword } from "@/lib/integrations/google-places";
import { logEvent } from "@/modules/audit/service";
import type { AppContext } from "@/modules/auth/session";
import type { RankKeyword } from "@/types/domain";
import { isDue, trend } from "./logic";

export interface CheckResult { position: number | null; scanned: number; previous: number | null; error?: string }

/** Matches the business on Google (once), then records where it ranks for the keyword. */
export async function checkKeyword(ctx: AppContext, kw: RankKeyword): Promise<CheckResult> {
  const org = ctx.organisation.id;
  const now = new Date().toISOString();
  const fail = async (error: string): Promise<CheckResult> => {
    await ctx.db.from("rank_keywords").update({ last_error: error.slice(0, 300), last_checked_at: now }).eq("id", kw.id).eq("organisation_id", org);
    return { position: null, scanned: 0, previous: kw.last_position, error };
  };
  try {
    let placeId = kw.place_id;
    if (!placeId) {
      const match = await findBusiness(kw.business);
      if (!match) return fail(`"${kw.business}" was not found on Google Maps — add the area, e.g. "Iron Gym Bandra Mumbai"`);
      placeId = match.id;
      await ctx.db.from("rank_keywords").update({ place_id: match.id, place_name: match.name, place_address: match.address }).eq("id", kw.id).eq("organisation_id", org);
    }
    const { position, scanned } = await rankForKeyword(kw.keyword, placeId);
    const safePosition = position !== null && position <= MAX_RANK_DEPTH ? position : null;
    await ctx.db.from("rank_checks").insert({ organisation_id: org, keyword_id: kw.id, position: safePosition, scanned });
    await ctx.db.from("rank_keywords").update({ last_position: safePosition, last_checked_at: now, last_error: null }).eq("id", kw.id).eq("organisation_id", org);
    return { position: safePosition, scanned, previous: kw.last_position };
  } catch (err) {
    return fail((err as Error).message);
  }
}

/** Autopilot step: checks keywords not checked in the last ~day, within a small per-cycle cap. Quiet when nothing is due. */
export async function checkDueKeywords(ctx: AppContext, now = new Date(), max = 5): Promise<{ checked: number; up: number; down: number; failed: number }> {
  const totals = { checked: 0, up: 0, down: 0, failed: 0 };
  if (!googlePlacesConfigured()) return totals;
  const { data } = await ctx.db.from("rank_keywords").select("*").eq("organisation_id", ctx.organisation.id).eq("active", true)
    .order("last_checked_at", { ascending: true, nullsFirst: true }).limit(50).returns<RankKeyword[]>();
  for (const kw of (data ?? []).filter((k) => isDue(k.last_checked_at, now)).slice(0, max)) {
    const r = await checkKeyword(ctx, kw);
    totals.checked++;
    if (r.error) { totals.failed++; continue; }
    const t = trend(kw.last_checked_at ? kw.last_position : undefined, r.position);
    if (t === "up" || t === "entered") totals.up++;
    if (t === "down" || t === "lost") totals.down++;
  }
  if (totals.checked) await logEvent(ctx, { action: "rank.checked", entity: "rank_keywords", actorType: "agent", metadata: { ...totals } });
  return totals;
}
