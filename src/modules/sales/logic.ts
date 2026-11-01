import { z } from "zod";
import { AiError } from "@/lib/ai/types";

/** Pure sales-engine rules: scoring, learning, message links, AI output validation. */

export const LEAD_STATUSES = ["new", "qualified", "disqualified", "pitch_ready", "approved", "contacted", "replied", "won", "lost"] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];
export const OUTCOMES = ["replied", "won", "lost"] as const;

export interface LeadFacts {
  category: string;
  city: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  instagram: string | null;
  address: string | null;
}

/**
 * Transparent fit score (0–100) for a website offer: no website is the core signal,
 * reachable contact channels make the lead actionable.
 */
export function scoreLead(l: LeadFacts & { hasHours?: boolean }, offer: "website" | "hr_services" | "ecommerce" = "website"): number {
  let s = 0;
  if (offer === "website") s += l.website ? 0 : 45;
  else s += 25;
  if (l.phone) s += 20;
  if (l.email) s += 15;
  if (l.instagram) s += 8;
  if (l.address) s += 7;
  if (l.hasHours) s += 5;
  return Math.min(100, s);
}

export interface Learning {
  contacted: number;
  replied: number;
  won: number;
  segments: { key: string; contacted: number; positive: number; rate: number }[];
  summary: string;
}

/** Learns which segments convert from recorded outcomes. Positive = replied or won. */
export function learnFromOutcomes(leads: { category: string; city: string | null; website: string | null; status: string }[], minSample = 3): Learning {
  const done = leads.filter((l) => ["contacted", "replied", "won", "lost"].includes(l.status));
  const positive = (l: { status: string }) => l.status === "replied" || l.status === "won";
  const buckets = new Map<string, { contacted: number; positive: number }>();
  const add = (key: string, l: { status: string }) => {
    const b = buckets.get(key) ?? { contacted: 0, positive: 0 };
    b.contacted++;
    if (positive(l)) b.positive++;
    buckets.set(key, b);
  };
  for (const l of done) {
    add(`category:${l.category}`, l);
    if (l.city) add(`city:${l.city}`, l);
    add(`website:${l.website ? "has" : "none"}`, l);
  }
  const segments = [...buckets.entries()]
    .map(([key, b]) => ({ key, ...b, rate: Math.round((b.positive / b.contacted) * 100) }))
    .filter((s) => s.contacted >= minSample)
    .sort((a, b) => b.rate - a.rate || b.contacted - a.contacted);
  const replied = done.filter(positive).length;
  const won = done.filter((l) => l.status === "won").length;
  const summary = done.length
    ? [`${done.length} contacted, ${replied} positive (${Math.round((replied / done.length) * 100)}%), ${won} won.`,
       segments.length ? `Best segments: ${segments.slice(0, 3).map((s) => `${s.key.replace(":", " = ")} ${s.rate}% (${s.positive}/${s.contacted})`).join("; ")}.` : `Not enough outcomes per segment yet (need ${minSample}+).`,
       segments.length > 1 ? `Weakest: ${segments.at(-1)!.key.replace(":", " = ")} ${segments.at(-1)!.rate}%.` : ""].filter(Boolean).join(" ")
    : "No outcomes recorded yet — prioritise leads with no website and a reachable phone or email.";
  return { contacted: done.length, replied, won, segments, summary };
}

/** International digits for wa.me. US/Canada numbers without a country code get +1. */
export function whatsappNumber(phone: string | null, country: string | null): string | null {
  if (!phone) return null;
  const first = phone.split(/[;,/]/)[0] ?? "";
  let digits = first.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) digits = digits.slice(1);
  else if (digits.startsWith("00")) digits = digits.slice(2);
  else if (digits.length === 10 && /united states|usa|canada/i.test(country ?? "")) digits = `1${digits}`;
  return /^\d{8,15}$/.test(digits) ? digits : null;
}

export function whatsappLink(phone: string | null, country: string | null, text: string): string | null {
  const n = whatsappNumber(phone, country);
  return n ? `https://wa.me/${n}?text=${encodeURIComponent(text)}` : null;
}

export function mailtoLink(email: string, subject: string, body: string): string {
  return `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

const decision = z.object({
  ref: z.coerce.number().int().min(1),
  pitch: z.boolean(),
  reason: z.string().trim().min(3).max(600),
  email_subject: z.string().trim().max(150).optional().default(""),
  email_body: z.string().trim().max(3000).optional().default(""),
  whatsapp: z.string().trim().max(700).optional().default(""),
});
export type QualificationDecision = z.infer<typeof decision>;
const decisions = z.object({ decisions: z.array(decision).min(1).max(20) });

export const QUALIFY_FORMAT = `Respond with ONLY JSON: {"decisions":[{"ref":number,"pitch":true|false,"reason":"why (1-2 sentences, based only on the given facts)",
"email_subject":"...","email_body":"short personal email, max 120 words, sign as the Founder's team, include a one-line opt-out",
"whatsapp":"max 60 words, friendly, no links"}]} — one entry per lead. If pitch is false, leave the message fields empty.`;

/** Validates AI qualification output; invalid output is retryable. Unknown refs are dropped. */
export function parseDecisions(text: string, maxRef: number): QualificationDecision[] {
  const unfenced = text.replace(/```(?:json)?/gi, "");
  const start = unfenced.indexOf("{");
  const end = unfenced.lastIndexOf("}");
  if (start < 0 || end <= start) throw new AiError("AI response contained no JSON decisions", true);
  let raw: unknown;
  try {
    raw = JSON.parse(unfenced.slice(start, end + 1));
  } catch {
    throw new AiError("AI response contained malformed JSON", true);
  }
  const parsed = decisions.safeParse(raw);
  if (!parsed.success) throw new AiError(`AI decisions failed validation: ${parsed.error.issues[0]?.message ?? "invalid"}`, true);
  const seen = new Set<number>();
  return parsed.data.decisions.filter((d) => d.ref <= maxRef && !seen.has(d.ref) && seen.add(d.ref) && (!d.pitch || (d.email_body || d.whatsapp)));
}
