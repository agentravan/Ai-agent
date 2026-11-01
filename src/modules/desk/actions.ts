"use server";

import { z } from "zod";
import { parseForm } from "@/lib/validation/forms";
import { must, runAction } from "@/lib/utilities/action";
import { requireContext } from "@/modules/auth/session";
import { FOUNDER_TASK_TYPES, PRIORITIES } from "@/types/domain";

const PATH = "/desk";
const blankToNull = (v: unknown) => (v === "" || v == null ? null : v);

const founderTaskSchema = z.object({
  title: z.string().trim().min(1, "What do you need to do?").max(200),
  description: z.string().trim().max(2000).optional(),
  task_type: z.enum(FOUNDER_TASK_TYPES).default("other"),
  priority: z.enum(PRIORITIES).default("medium"),
  due_date: z.preprocess(blankToNull, z.iso.date().nullable()),
});
const statusSchema = z.object({ id: z.uuid(), status: z.enum(["in_progress", "done", "cancelled"]) });
const goalsSchema = z.object({
  north_star_crore: z.coerce.number().positive().max(1e9),
  gate_inr: z.coerce.number().min(0).max(1e12),
});

export async function addFounderTaskAction(form: FormData) {
  await runAction(PATH, "Added to your desk", async () => {
    const ctx = await requireContext("operate");
    const t = parseForm(founderTaskSchema, form);
    must(await ctx.db.from("tasks").insert({ ...t, description: t.description || null, organisation_id: ctx.organisation.id, owner: "founder", assigned_agent_id: null, created_by: ctx.userId }).select("id").single());
  });
}

export async function setFounderTaskStatusAction(form: FormData) {
  await runAction(PATH, "Updated", async () => {
    const ctx = await requireContext("operate");
    const { id, status } = parseForm(statusSchema, form);
    must(await ctx.db.from("tasks").update({ status }).eq("id", id).eq("organisation_id", ctx.organisation.id).eq("owner", "founder").select("id").single());
    return status === "done" ? "Done ✓" : status === "cancelled" ? "Removed from your desk" : "Marked in progress";
  });
}

/** Only the Founder may change the company's North Star and spending gate (RLS enforces it too). */
export async function updateGoalsAction(form: FormData) {
  await runAction(PATH, "Goals updated", async () => {
    const ctx = await requireContext("own");
    const { north_star_crore, gate_inr } = parseForm(goalsSchema, form);
    must(await ctx.db.from("organisations").update({
      north_star_target_cents: Math.round(north_star_crore * 1e7 * 100),
      upgrade_profit_gate_cents: Math.round(gate_inr * 100),
    }).eq("id", ctx.organisation.id).select("id").single());
  });
}
