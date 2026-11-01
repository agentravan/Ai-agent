"use server";

import { opportunitySchema, opportunityStatusSchema, parseForm } from "@/lib/validation/forms";
import { must, runAction } from "@/lib/utilities/action";
import { requireContext } from "@/modules/auth/session";

const back = (form: FormData) => (String(form.get("return_to") ?? "") === "/ceo" ? "/ceo" : "/opportunities");

export async function createOpportunityAction(form: FormData) {
  await runAction(back(form), "Opportunity recorded", async () => {
    const ctx = await requireContext("operate");
    const { estimated_value_inr, ...o } = parseForm(opportunitySchema, form);
    must(
      await ctx.db
        .from("opportunities")
        .insert({ ...o, organisation_id: ctx.organisation.id, created_by: ctx.userId, estimated_value_cents: estimated_value_inr == null ? null : Math.round(estimated_value_inr * 100) })
        .select("id")
        .single(),
    );
  });
}

export async function setOpportunityStatusAction(form: FormData) {
  await runAction(back(form), "Opportunity updated", async () => {
    const ctx = await requireContext("operate");
    const { id, status } = parseForm(opportunityStatusSchema, form);
    must(await ctx.db.from("opportunities").update({ status }).eq("id", id).select("id").single());
  });
}
