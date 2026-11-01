import "server-only";
import { discoverBusinesses, LEAD_CATEGORIES, type LeadCategory } from "@/lib/integrations/osm";
import { agentHas } from "@/lib/permissions";
import { UserFacingError } from "@/lib/utilities/action";
import { logEvent } from "@/modules/audit/service";
import type { AppContext } from "@/modules/auth/session";
import { listAgents, permissionsOf, runAgent } from "@/modules/orchestration/engine";
import { learnFromOutcomes, parseDecisions, QUALIFY_FORMAT, scoreLead } from "./logic";

export interface Target { id: string; category: string; city: string; country: string; offer: "website" | "hr_services" | "ecommerce"; active: boolean; last_run_at: string | null }
export interface Lead {
  id: string; name: string; category: string; city: string | null; country: string | null; address: string | null;
  phone: string | null; email: string | null; website: string | null; instagram: string | null;
  source: string; score: number; status: string; ai_reason: string | null;
  pitch_subject: string | null; pitch_email: string | null; pitch_whatsapp: string | null;
  contacted_at: string | null; contact_channel: string | null; outcome_note: string | null; created_at: string; updated_at: string;
}

const OFFER_TEXT = {
  website: "a professional website (design, build, hosting setup, Google Maps & booking integration)",
  hr_services: "HR services (recruitment, compliance, payroll)",
  ecommerce: "an online store / e-commerce setup",
} as const;

async function salesUnitId(ctx: AppContext): Promise<string | null> {
  const { data } = await ctx.db.from("business_units").select("id").eq("organisation_id", ctx.organisation.id).eq("name", "Sales & Social Media Engine").maybeSingle<{ id: string }>();
  return data?.id ?? null;
}

/** Finds real businesses for a target and stores the best-fitting new ones as leads (deduplicated). */
export async function discoverForTarget(ctx: AppContext, target: Target, max = 25): Promise<{ found: number; added: number; area: string }> {
  if (!(target.category in LEAD_CATEGORIES)) throw new UserFacingError(`Unknown category "${target.category}"`);
  const { leads, area } = await discoverBusinesses(target.category as LeadCategory, target.city, target.country);
  const unitId = await salesUnitId(ctx);
  const candidates = leads
    .map((l) => ({ l, score: scoreLead({ ...l, category: target.category, city: target.city }, target.offer) }))
    // For website offers, businesses that already have a website are not a fit.
    .filter(({ l }) => target.offer !== "website" || !l.website)
    .sort((a, b) => b.score - a.score)
    .slice(0, max);

  let added = 0;
  if (candidates.length) {
    const { data, error } = await ctx.db
      .from("leads")
      .upsert(
        candidates.map(({ l, score }) => ({
          organisation_id: ctx.organisation.id, target_id: target.id, business_unit_id: unitId, name: l.name, category: target.category,
          city: target.city, country: target.country, address: l.address, phone: l.phone, email: l.email, website: l.website,
          instagram: l.instagram, source: "openstreetmap", source_ref: l.sourceRef, score,
        })),
        { onConflict: "organisation_id,source,source_ref", ignoreDuplicates: true },
      )
      .select("id");
    if (error) throw new Error(`Saving leads failed: ${error.message}`);
    added = data?.length ?? 0;
  }
  await ctx.db.from("prospect_targets").update({ last_run_at: new Date().toISOString() }).eq("id", target.id).eq("organisation_id", ctx.organisation.id);
  await logEvent(ctx, { action: "sales.leads_discovered", entity: "prospect_targets", entityId: target.id, actorType: "agent", metadata: { found: leads.length, added, area } });
  return { found: leads.length, added, area };
}

/** AI qualification: decides pitch/skip with reasons and drafts messages, using what past outcomes taught. */
export async function qualifyLeads(ctx: AppContext, limit = 8): Promise<{ reviewed: number; pitched: number; skipped: number }> {
  const org = ctx.organisation.id;
  const [agents, { data: pending }, { data: history }, { data: targets }] = await Promise.all([
    listAgents(ctx),
    ctx.db.from("leads").select("*").eq("organisation_id", org).eq("status", "new").order("score", { ascending: false }).limit(limit).returns<(Lead & { target_id: string | null })[]>(),
    ctx.db.from("leads").select("category, city, website, status").eq("organisation_id", org).in("status", ["contacted", "replied", "won", "lost"]).limit(2000).returns<{ category: string; city: string | null; website: string | null; status: string }[]>(),
    ctx.db.from("prospect_targets").select("id, offer").eq("organisation_id", org).returns<{ id: string; offer: Target["offer"] }[]>(),
  ]);
  const batch = pending ?? [];
  if (!batch.length) return { reviewed: 0, pitched: 0, skipped: 0 };

  const agent = agents.find((a) => a.name === "Iris" && a.status === "active") ?? agents.find((a) => a.name === "Nova" && a.status === "active");
  if (!agent) throw new UserFacingError("No active sales agent (Iris or Nova). Activate one in the Agent Registry.");
  if (!agentHas(permissionsOf(agent), "leads.qualify")) throw new UserFacingError(`${agent.name} lacks the "leads.qualify" permission`);

  const offerOf = new Map((targets ?? []).map((t) => [t.id, t.offer]));
  const learning = learnFromOutcomes(history ?? []);
  const facts = batch.map((l, i) =>
    `${i + 1}. ${l.name} — ${l.category} in ${l.city ?? "?"}; offer: ${OFFER_TEXT[offerOf.get(l.target_id ?? "") ?? "website"]}; website: ${l.website ?? "none"}; phone: ${l.phone ? "yes" : "no"}; email: ${l.email ? "yes" : "no"}; instagram: ${l.instagram ?? "none"}; address: ${l.address ?? "unknown"}; fit score ${l.score}/100`,
  ).join("\n");

  const { execution, result } = await runAgent(ctx, {
    agent,
    kind: "task",
    json: true,
    maxTokens: 4000,
    input: `Qualify these leads for outreach. Pitch only businesses that are a genuine fit and reachable; skip the rest with a reason.
What we have learned from past outreach: ${learning.summary}
Leads:
${facts}

${QUALIFY_FORMAT}`,
    parse: (text) => parseDecisions(text, batch.length),
  });
  if (execution.status === "failed" || !result) throw new UserFacingError(`Qualification failed: ${execution.error}`);

  let pitched = 0;
  let skipped = 0;
  for (const d of result) {
    const lead = batch[d.ref - 1];
    if (!lead) continue;
    const patch = d.pitch
      ? { status: "pitch_ready", ai_reason: d.reason, pitch_subject: d.email_subject || `A website for ${lead.name}`, pitch_email: d.email_body || null, pitch_whatsapp: d.whatsapp || null }
      : { status: "disqualified", ai_reason: d.reason };
    const { error } = await ctx.db.from("leads").update(patch).eq("id", lead.id).eq("organisation_id", org).eq("status", "new");
    if (!error) d.pitch ? pitched++ : skipped++;
  }
  await logEvent(ctx, { action: "sales.leads_qualified", entity: "leads", actorType: "agent", metadata: { agent_id: agent.id, reviewed: batch.length, pitched, skipped, execution_id: execution.id } });
  return { reviewed: batch.length, pitched, skipped };
}

/** One autonomous prospecting cycle: discover for active targets (bounded), then qualify. */
export async function runProspectingCycle(ctx: AppContext, maxTargets = 2): Promise<string> {
  const { data: targets } = await ctx.db.from("prospect_targets").select("*").eq("organisation_id", ctx.organisation.id).eq("active", true)
    .order("last_run_at", { ascending: true, nullsFirst: true }).limit(maxTargets).returns<Target[]>();
  const parts: string[] = [];
  for (const t of targets ?? []) {
    try {
      const r = await discoverForTarget(ctx, t);
      parts.push(`${LEAD_CATEGORIES[t.category as LeadCategory]?.label ?? t.category} in ${t.city}: ${r.added} new of ${r.found} found`);
    } catch (err) {
      parts.push(`${t.category} in ${t.city}: ${(err as Error).message}`);
    }
  }
  const q = await qualifyLeads(ctx).catch((err: Error) => ({ error: err.message }));
  parts.push("error" in q ? `Qualification: ${q.error}` : `Qualified ${q.reviewed}: ${q.pitched} pitches ready for your approval, ${q.skipped} skipped`);
  // Mailbox work: send anything you already approved (within today's limit), then read replies.
  const s = await sendApprovedEmails(ctx).catch((err: Error) => ({ error: err.message }));
  if ("error" in s) parts.push(`Email: ${s.error}`);
  else if (s.sent || s.failed) parts.push(`Emailed ${s.sent} approved leads${s.failed ? ` (${s.failed} failed)` : ""}`);
  const r = await checkReplies(ctx).catch((err: Error) => ({ error: err.message }));
  if ("error" in r) parts.push(`Inbox: ${r.error}`);
  else if (r.replies || r.optOuts) parts.push(`Inbox: ${r.replies} new replies, ${r.optOuts} opt-outs`);
  return parts.join(" · ");
}

const startOfTodayIso = () => { const d = new Date(); d.setUTCHours(0, 0, 0, 0); return d.toISOString(); };

/** Sends approved email pitches from the Founder's own mailbox, within the daily limit. Approval is already given. */
export async function sendApprovedEmails(ctx: AppContext, onlyId?: string): Promise<{ sent: number; failed: number; skipped: number; limitReached: boolean }> {
  const { emailConfigured, sendEmail } = await import("@/lib/integrations/email");
  const { env } = await import("@/lib/env");
  const { remainingToday } = await import("./logic");
  if (!emailConfigured()) return { sent: 0, failed: 0, skipped: 0, limitReached: false };
  const org = ctx.organisation.id;
  const [{ count: sentToday }, { data: optedOut }] = await Promise.all([
    ctx.db.from("leads").select("id", { count: "exact", head: true }).eq("organisation_id", org).eq("contact_channel", "email").gte("contacted_at", startOfTodayIso()),
    ctx.db.from("leads").select("email").eq("organisation_id", org).eq("outcome_note", "Unsubscribed").returns<{ email: string | null }[]>(),
  ]);
  const blocked = new Set((optedOut ?? []).map((o) => o.email?.toLowerCase()).filter(Boolean));
  let budget = remainingToday(sentToday ?? 0, env.OUTREACH_DAILY_LIMIT);
  let q = ctx.db.from("leads").select("*").eq("organisation_id", org).eq("status", "approved").not("email", "is", null).not("pitch_email", "is", null).order("score", { ascending: false }).limit(50);
  if (onlyId) q = q.eq("id", onlyId);
  const { data: queue } = await q.returns<Lead[]>();
  let sent = 0, failed = 0, skipped = 0;
  for (const lead of queue ?? []) {
    if (budget <= 0) break;
    if (blocked.has(lead.email!.toLowerCase())) { skipped++; continue; }
    try {
      await sendEmail({ to: lead.email!, subject: lead.pitch_subject ?? `Hello ${lead.name}`, text: lead.pitch_email!, replyTo: ctx.email, outreach: true });
      await ctx.db.from("leads").update({ status: "contacted", contacted_at: new Date().toISOString(), contact_channel: "email" }).eq("id", lead.id).eq("organisation_id", org).eq("status", "approved");
      sent++; budget--;
    } catch (err) {
      failed++;
      await logEvent(ctx, { action: "sales.email_failed", entity: "leads", entityId: lead.id, actorType: "agent", metadata: { error: (err as Error).message } });
      if (/login failed/i.test((err as Error).message)) break; // credentials problem: stop, don't hammer the mailbox
    }
  }
  if (sent) await logEvent(ctx, { action: "sales.emails_sent", entity: "leads", actorType: "agent", metadata: { sent, failed, skipped } });
  return { sent, failed, skipped, limitReached: budget <= 0 && (queue?.length ?? 0) > sent + skipped };
}

/** Reads the Founder's inbox for replies from contacted leads; marks replies and honours opt-outs. */
export async function checkReplies(ctx: AppContext): Promise<{ replies: number; optOuts: number }> {
  const { findReplies } = await import("@/lib/integrations/inbox");
  const { isOptOut, stripQuoted } = await import("./logic");
  const org = ctx.organisation.id;
  const { data: open } = await ctx.db.from("leads").select("id, email, contacted_at, status").eq("organisation_id", org).eq("status", "contacted").not("email", "is", null)
    .returns<{ id: string; email: string; contacted_at: string | null; status: string }[]>();
  if (!open?.length) return { replies: 0, optOuts: 0 };
  const oldest = open.reduce((m, l) => (l.contacted_at && l.contacted_at < m ? l.contacted_at : m), new Date().toISOString());
  const since = new Date(Math.max(new Date(oldest).getTime(), Date.now() - 30 * 86_400_000));
  const messages = await findReplies(open.map((l) => l.email), since);
  let replies = 0, optOuts = 0;
  for (const lead of open) {
    const msg = messages.filter((m) => m.from === lead.email.toLowerCase() && (!lead.contacted_at || m.date >= lead.contacted_at)).at(-1);
    if (!msg) continue;
    // Analyse only what the client wrote — never our quoted pitch (its footer mentions "unsubscribe").
    const fresh = stripQuoted(msg.snippet).replace(/\s+/g, " ").trim();
    const optOut = isOptOut(`${msg.subject.replace(/^(re|fwd?):\s*/gi, "")} ${fresh}`);
    const patch = optOut ? { status: "lost", outcome_note: "Unsubscribed" } : { status: "replied", outcome_note: `Reply: ${fresh || msg.subject}`.slice(0, 1000) };
    const { error } = await ctx.db.from("leads").update(patch).eq("id", lead.id).eq("organisation_id", org).eq("status", "contacted");
    if (!error) optOut ? optOuts++ : replies++;
  }
  if (replies || optOuts) await logEvent(ctx, { action: "sales.replies_detected", entity: "leads", actorType: "agent", metadata: { replies, optOuts } });
  return { replies, optOuts };
}
