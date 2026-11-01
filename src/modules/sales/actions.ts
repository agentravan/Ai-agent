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
import { discoverForTarget, qualifyLeads, runProspectingCycle, type Lead, type Target } from "./service";

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
  });
}

export async function approveAllAction() {
  await runAction(PATH, "Pitches approved", async () => {
    const ctx = await requireContext("govern");
    const { data } = await ctx.db.from("leads").update({ status: "approved", approved_by: ctx.userId }).eq("organisation_id", ctx.organisation.id).eq("status", "pitch_ready").select("id");
    await logEvent(ctx, { action: "sales.pitches_approved", entity: "leads", metadata: { count: data?.length ?? 0 } });
    return `${data?.length ?? 0} pitches approved — send them from the Ready to send list`;
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
    if (!emailConfigured()) throw new UserFacingError("Email sending is not set up yet — use WhatsApp, or ask to connect Resend");
    try {
      await sendEmail({ to: lead.email, subject: lead.pitch_subject ?? `Hello ${lead.name}`, text: lead.pitch_email, replyTo: ctx.email });
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
