"use server";

import { z } from "zod";
import { parseForm } from "@/lib/validation/forms";
import { must, runAction, UserFacingError } from "@/lib/utilities/action";
import { requireContext } from "@/modules/auth/session";
import { logEvent } from "@/modules/audit/service";
import { divisionLabel, templateBySlug } from "./catalog";
import { agentFromTemplate, departmentFor } from "./logic";

const PATH = "/workforce/library";
const hireSchema = z.object({ slug: z.string().regex(/^[a-z0-9/-]{3,120}$/, "Unknown role") });
/** Safe starting permissions; the Founder can grant more in the Agent Registry. */
const DEFAULT_PERMISSIONS = ["ai.execute", "tasks.create", "approvals.request", "reports.create"];

export async function hireFromLibraryAction(form: FormData) {
  await runAction(PATH, "Agent hired", async () => {
    const ctx = await requireContext("govern");
    const { slug } = parseForm(hireSchema, form);
    const template = templateBySlug(slug);
    if (!template) throw new UserFacingError("That role is not in the library");
    const org = ctx.organisation.id;

    // Friendly pre-check; the unique indexes on (organisation, name) and (organisation, template_slug) are the real guard.
    const [{ data: bySlug }, { data: byName }] = await Promise.all([
      ctx.db.from("agents").select("name").eq("organisation_id", org).eq("template_slug", slug).limit(1).returns<{ name: string }[]>(),
      ctx.db.from("agents").select("name").eq("organisation_id", org).eq("name", template.name.slice(0, 80)).limit(1).returns<{ name: string }[]>(),
    ]);
    const existing = bySlug?.[0] ?? byName?.[0];
    if (existing) throw new UserFacingError(`${existing.name} is already on your team — find them in the Agent Registry`);

    const deptName = departmentFor(template.division);
    const [{ data: dept }, { data: coo }] = await Promise.all([
      deptName ? ctx.db.from("departments").select("id").eq("organisation_id", org).eq("name", deptName).maybeSingle<{ id: string }>() : Promise.resolve({ data: null }),
      ctx.db.from("agents").select("id").eq("organisation_id", org).eq("tier", "coo").maybeSingle<{ id: string }>(),
    ]);

    const saved = must(await ctx.db.from("agents").insert({
      ...agentFromTemplate(template, divisionLabel(template.division)),
      organisation_id: org, tier: "worker", department_id: dept?.id ?? null, manager_id: coo?.id ?? null, monthly_cost_limit_cents: 0,
    }).select("id").single<{ id: string }>());
    must(await ctx.db.from("agent_permissions").insert(DEFAULT_PERMISSIONS.map((permission) => ({ organisation_id: org, agent_id: saved.id, permission }))).select("agent_id"));
    await logEvent(ctx, { action: "agent.hired_from_library", entity: "agents", entityId: saved.id, metadata: { template: slug } });
    return `${template.name} hired — they report to your COO. Assign them tasks in Projects or chat in Empire Command.`;
  });
}
