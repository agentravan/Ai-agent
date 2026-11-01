"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { emailConfigured, sendEmail } from "@/lib/integrations/email";
import { LEAD_CATEGORIES } from "@/lib/integrations/osm";
import { parseForm } from "@/lib/validation/forms";
import { must, runAction, UserFacingError } from "@/lib/utilities/action";
import { requireContext } from "@/modules/auth/session";
import { logEvent } from "@/modules/audit/service";
import { OUTCOMES, whatsappLink } from "./logic";
import { checkReplies, discoverForTarget, qualifyLeads, runProspectingCycle, sendApprovedEmails, type Lead, type Target } from "./service";

const PATH = "/sales";
const categoryKeys = Object.keys(LEAD_CATEGORIES) as [string, ...string[]];

const targetSchema = z.object({
  category: z.enum(categoryKeys, { message: "Choose a business category" }),
  city: z.string().trim().min(2, "Enter a city").max(120),
  country: z.string().trim().min(2).max(80).default("United States"),
  offer: z.enum(["website", "hr_services", "ecommerce"]).default("website"),
});
const idSchema = z.object({ id: z.uuid() });
const outcomeSchema = z.object({ id: z.uuid(), outcome: z.enum(OUTCOMES), note: z.string().trim().max(1000).optional() });
const manualLeadSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(200),
  category: z.string().trim().min(2).max(40).default("other"),
  city: z.string().trim().max(120).optional(),
  phone: z.string().trim().max(40).optional(),
  email: z.union([z.email("Enter a valid email"), z.literal("")]).optional(),
  website: z.string().trim().max(300).optional(),
});
const blank = (v?: string) => (v ? v : null);

export async function addTargetAction(form: FormData) {
  await runAction(PATH, "Target saved — the engine will hunt it daily", async () => {
    const ctx = await requireContext("operate");
    const t = parseForm(targetSchema, form);
    must(await ctx.db.from("prospect_targets").insert({ ...t, organisation_id: ctx.organisation.id }).select("id").single());
  });
}

export async function toggleTargetAction(form: FormData) {
  await runAction(PATH, "Target updated", async () => {
    const ctx = await requireContext("operate");
    const { id } = parseForm(idSchema, form);
    const t = must(await ctx.db.from("prospect_targets").select("active").eq("id", id).single<{ active: boolean }>());
    must(await ctx.db.from("prospect_targets").update({ active: !t.active }).eq("id", id).select("id").single());
  });
}

export async function discoverTargetAction(form: FormData) {
  await runAction(PATH, "Discovery complete", async () => {
    const ctx = await requireContext("operate");
    const { id } = parseForm(idSchema, form);
    const t = must(await ctx.db.from("prospect_targets").select("*").eq("id", id).single<Target>());
    try {
      const r = await discoverForTarget(ctx, t);
      return `Found ${r.found} businesses in ${r.area.split(",")[0]}; added ${r.added} new leads that fit`;
    } catch (err) {
      throw err instanceof UserFacingError ? err : new UserFacingError((err as Error).message);
    }
  });
}

export async function qualifyAction() {
  await runAction(PATH, "Qualification complete", async () => {
    const ctx = await requireContext("operate");
    const r = await qualifyLeads(ctx);
    return r.reviewed ? `Iris reviewed ${r.reviewed}: ${r.pitched} pitches ready for your approval, ${r.skipped} skipped` : "No new leads to qualify — run discovery first";
  });
}

export async function runCycleAction() {
  await runAction(PATH, "Prospecting cycle complete", async () => {
    const ctx = await requireContext("operate");
    return runProspectingCycle(ctx);
  });
}

export async function addManualLeadAction(form: FormData) {
  await runAction(PATH, "Lead added", async () => {
    const ctx = await requireContext("operate");
    const l = parseForm(manualLeadSchema, form);
    must(await ctx.db.from("leads").insert({
      organisation_id: ctx.organisation.id, name: l.name, category: l.category, city: blank(l.city), phone: blank(l.phone),
      email: blank(l.email), website: blank(l.website), source: "manual", score: 50,
    }).select("id").single());
  });
}

/** Founder approval of outreach (external client communication). Enforced again by a DB trigger. */
export async function approveLeadAction(form: FormData) {
  await runAction(PATH, "Pitch approved", async () => {
    const ctx = await requireContext("govern");
    const { id } = parseForm(idSchema, form);
    const { data } = await ctx.db.from("leads").update({ status: "approved", approved_by: ctx.userId }).eq("id", id).eq("status", "pitch_ready").select("id");
    if (!data?.length) throw new UserFacingError("Lead is not waiting for approval");
    const s = await sendApprovedEmails(ctx, id);
    return s.sent ? "Approved — Iris emailed them from your mailbox" : "Pitch approved";
  });
}

export async function approveAllAction() {
  await runAction(PATH, "Pitches approved", async () => {
    const ctx = await requireContext("govern");
    const { data } = await ctx.db.from("leads").update({ status: "approved", approved_by: ctx.userId }).eq("organisation_id", ctx.organisation.id).eq("status", "pitch_ready").select("id");
    await logEvent(ctx, { action: "sales.pitches_approved", entity: "leads", metadata: { count: data?.length ?? 0 } });
    const s = await sendApprovedEmails(ctx);
    return `${data?.length ?? 0} approved · Iris emailed ${s.sent} from your mailbox${s.limitReached ? " (daily limit reached — the rest go tomorrow)" : ""}. WhatsApp-only leads are in Ready to send.`;
  });
}

export async function rejectLeadAction(form: FormData) {
  await runAction(PATH, "Lead skipped", async () => {
    const ctx = await requireContext("operate");
    const { id } = parseForm(idSchema, form);
    must(await ctx.db.from("leads").update({ status: "disqualified", outcome_note: "Skipped by Founder" }).eq("id", id).in("status", ["new", "qualified", "pitch_ready", "approved"]).select("id").single());
  });
}

/** Marks an approved lead as contacted via WhatsApp, then opens WhatsApp with the approved message. */
export async function whatsappAction(form: FormData) {
  const ctx = await requireContext("operate");
  const { id } = parseForm(idSchema, form);
  const lead = must(await ctx.db.from("leads").select("*").eq("id", id).single<Lead>());
  const link = whatsappLink(lead.phone, lead.country, lead.pitch_whatsapp ?? "");
  if (lead.status !== "approved" || !link) redirect(`${PATH}?error=${encodeURIComponent("This lead is not approved or has no valid phone number")}`);
  await ctx.db.from("leads").update({ status: "contacted", contacted_at: new Date().toISOString(), contact_channel: "whatsapp" }).eq("id", id).eq("status", "approved");
  redirect(link);
}

export async function sendEmailAction(form: FormData) {
  await runAction(PATH, "Email sent", async () => {
    const ctx = await requireContext("operate");
    const { id } = parseForm(idSchema, form);
    const lead = must(await ctx.db.from("leads").select("*").eq("id", id).single<Lead>());
    if (lead.status !== "approved") throw new UserFacingError("Only approved pitches can be sent");
    if (!lead.email || !lead.pitch_email) throw new UserFacingError("This lead has no email address or email pitch");
    if (!emailConfigured()) throw new UserFacingError("Your mailbox is not connected yet — use WhatsApp for now");
    try {
      await sendEmail({ to: lead.email, subject: lead.pitch_subject ?? `Hello ${lead.name}`, text: lead.pitch_email, replyTo: ctx.email, outreach: true });
    } catch (err) {
      throw new UserFacingError((err as Error).message);
    }
    await ctx.db.from("leads").update({ status: "contacted", contacted_at: new Date().toISOString(), contact_channel: "email" }).eq("id", id).eq("status", "approved");
    await logEvent(ctx, { action: "sales.email_sent", entity: "leads", entityId: id });
    return `Email sent to ${lead.name}`;
  });
}

/** Outcomes feed the learning loop (which segments convert). */
export async function recordOutcomeAction(form: FormData) {
  await runAction(PATH, "Outcome recorded — the engine learns from this", async () => {
    const ctx = await requireContext("operate");
    const { id, outcome, note } = parseForm(outcomeSchema, form);
    must(await ctx.db.from("leads").update({ status: outcome, outcome_note: note || null }).eq("id", id).in("status", ["contacted", "replied"]).select("id").single());
    if (outcome === "won") {
      const lead = must(await ctx.db.from("leads").select("name, email, phone, prospect_targets(offer)").eq("id", id).single<{ name: string; email: string | null; phone: string | null; prospect_targets: { offer: string } | null }>());
      // The delivering unit owns the client (website deals → Web Development, etc.).
      const unitName = { website: "Web Development & Tech", hr_services: "HR Services & Consulting", ecommerce: "Buyontime E-Commerce" }[lead.prospect_targets?.offer ?? "website"] ?? "Web Development & Tech";
      const { data: unit } = await ctx.db.from("business_units").select("id").eq("organisation_id", ctx.organisation.id).eq("name", unitName).maybeSingle<{ id: string }>();
      await ctx.db.from("clients").insert({ organisation_id: ctx.organisation.id, name: lead.name, email: lead.email, phone: lead.phone, status: "active", business_unit_id: unit?.id ?? null, notes: "Won via Sales Engine" });
      return `${lead.name} won and added as an active client`;
    }
  });
}

export async function checkRepliesAction() {
  await runAction(PATH, "Inbox checked", async () => {
    const ctx = await requireContext("operate");
    try {
      const r = await checkReplies(ctx);
      return `Iris checked your inbox: ${r.replies} new replies, ${r.optOuts} opt-outs`;
    } catch (err) {
      throw new UserFacingError(`Could not read your inbox: ${(err as Error).message}`);
    }
  });
}

const waAssistSchema = z.object({
  lead_id: z.preprocess((v) => (v === "" ? undefined : v), z.uuid().optional()),
  phone: z.string().trim().max(40).optional(),
  name: z.string().trim().max(200).optional(),
  message: z.string().trim().min(1, "Paste the client's WhatsApp message").max(4000),
});

/**
 * WhatsApp reply assistant (no Meta setup): the Founder pastes a client's WhatsApp message, Iris drafts the
 * reply, the lead is updated (replied → call task on the desk; opt-out → never contacted again), and the
 * Founder sends it with one tap from their own WhatsApp.
 */
export async function whatsappAssistAction(form: FormData) {
  await runAction("/desk", "Reply ready — tap Send on WhatsApp", async () => {
    const ctx = await requireContext("operate");
    const input = parseForm(waAssistSchema, form);
    const org = ctx.organisation.id;
    const { isOptOut, whatsappNumber: waNum } = await import("./logic");
    const { listAgents, runAgent } = await import("@/modules/orchestration/engine");

    // 1. Find the lead (chosen, or by phone), or create one for a new enquiry.
    let lead: Lead | null = null;
    if (input.lead_id) lead = must(await ctx.db.from("leads").select("*").eq("id", input.lead_id).eq("organisation_id", org).single<Lead>());
    const digits = waNum(input.phone ?? null, "India") ?? waNum(input.phone ?? null, null);
    if (!lead && digits) {
      const { data } = await ctx.db.from("leads").select("*").eq("organisation_id", org).not("phone", "is", null).limit(2000).returns<Lead[]>();
      lead = (data ?? []).find((l) => waNum(l.phone, l.country) === digits || waNum(l.phone, "India") === digits) ?? null;
    }
    if (!lead) {
      if (!digits) throw new UserFacingError("Choose a contact or enter their WhatsApp number with country code");
      lead = must(await ctx.db.from("leads").insert({
        organisation_id: org, name: input.name || `WhatsApp +${digits}`, phone: `+${digits}`, source: "manual", category: "other", score: 60,
      }).select("*").single<Lead>());
    }

    // 2. Opt-outs are honoured immediately and permanently.
    if (isOptOut(input.message)) {
      await ctx.db.from("leads").update({ status: "lost", outcome_note: "Unsubscribed", pitch_whatsapp: null }).eq("id", lead.id).eq("organisation_id", org);
      return `${lead.name} asked not to be contacted — marked and will never be messaged again`;
    }

    // 3. Iris drafts the reply.
    const agents = await listAgents(ctx);
    const iris = agents.find((a) => a.name === "Iris" && a.status === "active") ?? agents.find((a) => a.name === "Nova" && a.status === "active");
    if (!iris) throw new UserFacingError("Iris (Sales Manager) is not active");
    const { execution } = await runAgent(ctx, {
      agent: iris, kind: "chat", maxTokens: 500,
      input: `[WA] Write the next WhatsApp reply to this client for Teamwork HR Solutions. Reply in the client's language and tone, max 70 words, friendly and clear.
Never invent prices, dates or promises: if they ask price or timing, say the Founder will confirm on a quick call and ask a good time to call.
Goal: move them to a short call. No links unless they asked.
Client: ${lead.name}${lead.category && lead.category !== "other" ? ` (${lead.category}${lead.city ? `, ${lead.city}` : ""})` : ""}
Our earlier message: ${lead.pitch_whatsapp ?? lead.pitch_email ?? "none"}
Their message: ${input.message}
Output ONLY the reply text.`,
    });
    if (execution.status === "failed" || !execution.output) throw new UserFacingError(`Iris could not draft a reply: ${execution.error}`);
    const reply = execution.output.trim().replace(/^["']|["']$/g, "").slice(0, 1000);

    // 4. Record the conversation; moving to "replied" puts a call task with their number on the desk.
    const note = `WhatsApp: ${input.message}`.slice(0, 1000);
    const toReplied = ["new", "qualified", "pitch_ready", "approved", "contacted"].includes(lead.status);
    await ctx.db.from("leads").update({ pitch_whatsapp: reply, outcome_note: note, ...(toReplied ? { status: "replied" } : {}) }).eq("id", lead.id).eq("organisation_id", org);
    await logEvent(ctx, { action: "sales.whatsapp_reply_drafted", entity: "leads", entityId: lead.id, actorType: "agent", metadata: { agent_id: iris.id } });
    return `Iris wrote a reply for ${lead.name} — it is at the top of “People to call”. Tap WhatsApp to send.`;
  });
}
