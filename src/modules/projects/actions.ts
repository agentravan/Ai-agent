"use server";

import { parseForm, projectSchema, projectStatusSchema } from "@/lib/validation/forms";
import { must, runAction } from "@/lib/utilities/action";
import { requireContext } from "@/modules/auth/session";

export async function createProjectAction(form: FormData) {
  await runAction("/projects", "Project created", async () => {
    const ctx = await requireContext("operate");
    const project = parseForm(projectSchema, form);
    must(await ctx.db.from("projects").insert({ ...project, organisation_id: ctx.organisation.id }).select("id").single());
  });
}

export async function setProjectStatusAction(form: FormData) {
  await runAction("/projects", "Project updated", async () => {
    const ctx = await requireContext("operate");
    const { id, status } = parseForm(projectStatusSchema, form);
    must(await ctx.db.from("projects").update({ status }).eq("id", id).select("id").single());
  });
}
