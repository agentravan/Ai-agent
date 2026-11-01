import "server-only";
import type { AppContext } from "@/modules/auth/session";
import type { AuditLog } from "@/types/domain";

/**
 * Semantic audit events (commands, executions, decisions). Row-level changes are captured
 * automatically by database triggers; this records intent that triggers cannot see.
 * For agent events actor_id is the accountable human who triggered the agent.
 */
export async function logEvent(
  ctx: AppContext,
  e: { action: string; entity: string; entityId?: string | null; actorType?: "user" | "agent"; metadata?: Record<string, unknown> },
): Promise<void> {
  const { error } = await ctx.db.from("audit_logs").insert({
    organisation_id: ctx.organisation.id,
    actor_type: e.actorType ?? "user",
    actor_id: ctx.userId,
    action: e.action,
    entity: e.entity,
    entity_id: e.entityId ?? null,
    metadata: e.metadata ?? {},
  });
  // Audit failure must be visible but must not mask the business outcome.
  if (error) console.error("[audit] failed to record event", e.action, error.message);
}

export async function listAudit(ctx: AppContext, opts: { limit?: number; entity?: string; actorType?: string } = {}) {
  let q = ctx.db.from("audit_logs").select("*").order("created_at", { ascending: false }).limit(opts.limit ?? 50);
  if (opts.entity) q = q.eq("entity", opts.entity);
  if (opts.actorType) q = q.eq("actor_type", opts.actorType);
  const { data } = await q.returns<AuditLog[]>();
  return data ?? [];
}
