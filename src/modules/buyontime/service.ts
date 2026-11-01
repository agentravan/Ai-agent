import "server-only";
import { buyontimeConfigured, buyontimeSummary, type BuyontimeSummary } from "@/lib/integrations/buyontime";
import { fetchTrends } from "@/lib/integrations/trends";
import { UserFacingError } from "@/lib/utilities/action";
import { logEvent } from "@/modules/audit/service";
import type { AppContext } from "@/modules/auth/session";
import { listAgents, runAgent } from "@/modules/orchestration/engine";
import { IDEAS_FORMAT, meeshoSearch, orderRef, orderTask, parseIdeas } from "./logic";

/** Live store summary, or null with a reason when Buyontime is not reachable/connected. */
export async function storeSummary(hours = 24): Promise<{ data: BuyontimeSummary | null; error: string | null }> {
  if (!buyontimeConfigured()) return { data: null, error: "Buyontime not connected" };
  try {
    return { data: await buyontimeSummary(hours), error: null };
  } catch (err) {
    return { data: null, error: (err as Error).message };
  }
}

/**
 * One desk task per order that still has to be placed on Meesho; tasks for orders that have moved on
 * (shipped/cancelled) are closed automatically. Idempotent via tasks.external_ref.
 */
export async function syncOrderTasks(ctx: AppContext, summary: BuyontimeSummary): Promise<{ created: number; closed: number }> {
  const org = ctx.organisation.id;
  const { data: open } = await ctx.db.from("tasks").select("id, external_ref, status").eq("organisation_id", org).like("external_ref", "buyontime:%")
    .returns<{ id: string; external_ref: string; status: string }[]>();
  const known = new Set((open ?? []).map((t) => t.external_ref));
  const pending = new Set(summary.toFulfil.map((o) => orderRef(o.orderNumber)));
  let created = 0;
  for (const o of summary.toFulfil) {
    if (known.has(orderRef(o.orderNumber))) continue;
    const t = orderTask(o);
    const { error } = await ctx.db.from("tasks").insert({ ...t, organisation_id: org, owner: "founder", task_type: "order", assigned_agent_id: null });
    if (!error) created++;
    else if (error.code !== "23505") throw new Error(`Could not create order task: ${error.message}`);
  }
  const stale = (open ?? []).filter((t) => ["todo", "in_progress", "blocked"].includes(t.status) && !pending.has(t.external_ref)).map((t) => t.id);
  if (stale.length) {
    await ctx.db.from("tasks").update({ status: "done", result: "Order moved past placement in Buyontime (closed automatically)." }).eq("organisation_id", org).in("id", stale);
  }
  if (created || stale.length) await logEvent(ctx, { action: "buyontime.order_tasks_synced", entity: "tasks", actorType: "agent", metadata: { created, closed: stale.length } });
  return { created, closed: stale.length };
}

/** Mercury turns today's Google Trends signals into Meesho-sourceable product ideas (saved as opportunities). */
export async function generateProductIdeas(ctx: AppContext): Promise<number> {
  const agents = await listAgents(ctx);
  const mercury = agents.find((a) => a.name === "Mercury" && a.status === "active") ?? agents.find((a) => a.tier === "coo" && a.status === "active");
  if (!mercury) throw new UserFacingError("Mercury (E-Commerce Operations Manager) is not active");
  const trends = await fetchTrends("IN").catch((e: Error) => { throw new UserFacingError(`Could not read Google Trends: ${e.message}`); });
  const { data: existing } = await ctx.db.from("opportunities").select("title").eq("organisation_id", ctx.organisation.id).like("title", "Buyontime: %").returns<{ title: string }[]>();
  const { execution, result } = await runAgent(ctx, {
    agent: mercury, kind: "task", json: true, maxTokens: 1800,
    input: `Buyontime is an Indian online store; every product is sourced from Meesho and must earn at least ₹120 profit, so prefer items that sell above ~₹349 and suit impulse/gift/seasonal buying.
Today's Google Trends (India) trending searches: ${trends.map((t) => `${t.title}${t.traffic ? ` (${t.traffic})` : ""}`).join("; ") || "unavailable"}.
Already suggested before (do not repeat): ${(existing ?? []).map((e) => e.title.replace("Buyontime: ", "")).join("; ") || "none"}.
Suggest products we can find on Meesho that match these trends, the season or upcoming Indian festivals. Skip trends that are news/sports with no product angle.
${IDEAS_FORMAT}`,
    parse: parseIdeas,
  });
  if (execution.status === "failed" || !result) throw new UserFacingError(`Idea generation failed: ${execution.error}`);
  let saved = 0;
  for (const i of result) {
    const { error } = await ctx.db.from("opportunities").insert({
      organisation_id: ctx.organisation.id, title: `Buyontime: ${i.product}`.slice(0, 200), proposed_by_agent_id: mercury.id, created_by: ctx.userId,
      summary: `${i.why}\nFind on Meesho: ${meeshoSearch(i.meesho_query)}${i.category ? `\nCategory: ${i.category}` : ""}`,
    });
    if (!error) saved++;
  }
  return saved;
}
