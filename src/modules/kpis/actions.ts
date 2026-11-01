"use server";

import { kpiSchema, kpiValueSchema, kraSchema, parseForm } from "@/lib/validation/forms";
import { must, runAction } from "@/lib/utilities/action";
import { requireContext } from "@/modules/auth/session";

export async function createKraAction(form: FormData) {
  await runAction("/kpis", "KRA created", async () => {
    const ctx = await requireContext("govern");
    must(await ctx.db.from("kras").insert({ ...parseForm(kraSchema, form), organisation_id: ctx.organisation.id }).select("id").single());
  });
}

export async function createKpiAction(form: FormData) {
  await runAction("/kpis", "KPI created", async () => {
    const ctx = await requireContext("operate");
    must(await ctx.db.from("kpis").insert({ ...parseForm(kpiSchema, form), organisation_id: ctx.organisation.id }).select("id").single());
  });
}

export async function updateKpiValueAction(form: FormData) {
  await runAction("/kpis", "KPI updated", async () => {
    const ctx = await requireContext("operate");
    const { id, current_value } = parseForm(kpiValueSchema, form);
    must(await ctx.db.from("kpis").update({ current_value }).eq("id", id).select("id").single());
  });
}
