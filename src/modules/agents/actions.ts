"use server";

import { agentSchema, agentStatusSchema, parseForm } from "@/lib/validation/forms";
import { must, runAction } from "@/lib/utilities/action";
import { requireContext } from "@/modules/auth/session";
import { logEvent } from "@/modules/audit/service";

const PATH = "/workforce";

export async function saveAgentAction(form: FormData) {
  await runAction(PATH, "Agent saved", async () => {
    const ctx = await requireContext("govern");
    const { id, permissions, ...fields } = parseForm(agentSchema, form, ["permissions"]);
    const row = { ...fields, organisation_id: ctx.organisation.id };
    const saved = id
      ? must(await ctx.db.from("agents").update(row).eq("id", id).select("id").single<{ id: string }>())
      : must(await ctx.db.from("agents").insert(row).select("id").single<{ id: string }>());

    // Replace permission set (audited per row by DB triggers).
    must(await ctx.db.from("agent_permissions").delete().eq("agent_id", saved.id).select("agent_id"));
    if (permissions.length) {
      must(await ctx.db.from("agent_permissions").insert(permissions.map((permission) => ({ organisation_id: ctx.organisation.id, agent_id: saved.id, permission }))).select("agent_id"));
    }
    await logEvent(ctx, { action: id ? "agent.updated" : "agent.created", entity: "agents", entityId: saved.id, metadata: { permissions } });
    return `${fields.name} ${id ? "updated" : "hired"}`;
  });
}

export async function setAgentStatusAction(form: FormData) {
  await runAction(PATH, "Agent status updated", async () => {
    const ctx = await requireContext("govern");
    const { id, status } = parseForm(agentStatusSchema, form);
    must(await ctx.db.from("agents").update({ status }).eq("id", id).select("id").single());
    await logEvent(ctx, { action: `agent.${status === "active" ? "activated" : "suspended"}`, entity: "agents", entityId: id });
    return status === "active" ? "Agent activated" : "Agent suspended";
  });
}
