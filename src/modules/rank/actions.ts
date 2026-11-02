"use server";

import { z } from "zod";
import { googlePlacesConfigured } from "@/lib/integrations/google-places";
import { parseForm } from "@/lib/validation/forms";
import { must, runAction, UserFacingError } from "@/lib/utilities/action";
import { requireContext } from "@/modules/auth/session";
import type { RankKeyword } from "@/types/domain";
import { describeRank, MAX_ACTIVE_KEYWORDS } from "./logic";
import { checkKeyword } from "./service";

const PATH = "/rank";
const keywordSchema = z.object({
  keyword: z.string().trim().min(2, "Enter what customers search, e.g. best gym in bandra").max(200),
  business: z.string().trim().min(2, "Enter your business name and area as on Google Maps").max(200),
});
const idSchema = z.object({ id: z.uuid() });

const requireGoogle = () => {
  if (!googlePlacesConfigured()) throw new UserFacingError("Add GOOGLE_PLACES_API_KEY in Vercel settings to start rank tracking");
};

export async function addKeywordAction(form: FormData) {
  await runAction(PATH, "Keyword added", async () => {
    const ctx = await requireContext("operate");
    requireGoogle();
    const k = parseForm(keywordSchema, form);
    const { count } = await ctx.db.from("rank_keywords").select("id", { count: "exact", head: true }).eq("organisation_id", ctx.organisation.id).eq("active", true);
    if ((count ?? 0) >= MAX_ACTIVE_KEYWORDS) throw new UserFacingError(`You can track up to ${MAX_ACTIVE_KEYWORDS} active keywords — pause one first`);
    const kw = must(await ctx.db.from("rank_keywords").insert({ ...k, organisation_id: ctx.organisation.id }).select("*").single<RankKeyword>());
    const r = await checkKeyword(ctx, kw);
    return r.error ? `Keyword saved, but: ${r.error}` : `Tracking "${k.keyword}" — you are ${describeRank(r.position, r.scanned)} today`;
  });
}

export async function checkNowAction(form: FormData) {
  await runAction(PATH, "Checked", async () => {
    const ctx = await requireContext("operate");
    requireGoogle();
    const { id } = parseForm(idSchema, form);
    const kw = must(await ctx.db.from("rank_keywords").select("*").eq("id", id).eq("organisation_id", ctx.organisation.id).single<RankKeyword>());
    const r = await checkKeyword(ctx, kw);
    if (r.error) throw new UserFacingError(r.error);
    return `"${kw.keyword}": ${describeRank(r.position, r.scanned)}`;
  });
}

/** Clears the matched Google place so the next check matches the business again (after fixing a wrong match). */
export async function rematchAction(form: FormData) {
  await runAction(PATH, "Business will be matched again on the next check", async () => {
    const ctx = await requireContext("operate");
    const { id } = parseForm(idSchema, form);
    must(await ctx.db.from("rank_keywords").update({ place_id: null, place_name: null, place_address: null, last_position: null }).eq("id", id).eq("organisation_id", ctx.organisation.id).select("id").single());
  });
}

export async function toggleKeywordAction(form: FormData) {
  await runAction(PATH, "Keyword updated", async () => {
    const ctx = await requireContext("operate");
    const { id } = parseForm(idSchema, form);
    const kw = must(await ctx.db.from("rank_keywords").select("active").eq("id", id).eq("organisation_id", ctx.organisation.id).single<{ active: boolean }>());
    if (!kw.active) {
      const { count } = await ctx.db.from("rank_keywords").select("id", { count: "exact", head: true }).eq("organisation_id", ctx.organisation.id).eq("active", true);
      if ((count ?? 0) >= MAX_ACTIVE_KEYWORDS) throw new UserFacingError(`You can track up to ${MAX_ACTIVE_KEYWORDS} active keywords — pause one first`);
    }
    must(await ctx.db.from("rank_keywords").update({ active: !kw.active }).eq("id", id).eq("organisation_id", ctx.organisation.id).select("id").single());
  });
}

export async function deleteKeywordAction(form: FormData) {
  await runAction(PATH, "Keyword removed", async () => {
    const ctx = await requireContext("govern");
    const { id } = parseForm(idSchema, form);
    must(await ctx.db.from("rank_keywords").delete().eq("id", id).eq("organisation_id", ctx.organisation.id).select("id").single());
  });
}
