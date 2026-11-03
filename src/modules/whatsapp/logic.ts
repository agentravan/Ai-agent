/** WhatsApp Desk rules — pure and unit-tested. */
import type { WaMessage } from "@/lib/integrations/waha";
import { whatsappNumber } from "@/modules/sales/logic";

/** A WhatsApp chat id for a phone (Indian 10-digit numbers get +91). Null when it can't be a real number. */
export function chatIdFor(phone: string | null, country: string | null = "India"): string | null {
  if (!phone) return null;
  const digits = phone.replace(/[^\d+]/g, "");
  const local = digits.replace(/^0+/, "");
  const indian = /india/i.test(country ?? "") && /^[6-9]\d{9}$/.test(local) ? `91${local}` : null;
  const n = indian ?? whatsappNumber(phone, country);
  return n ? `${n}@c.us` : null;
}

export const phoneOf = (chatId: string) => `+${chatId.split("@")[0]}`;

/** "STOP", "unsubscribe", "message mat karo", "band karo" … — honoured permanently. */
export function isWaOptOut(text: string): boolean {
  return /\b(stop|unsubscribe|remove me|not interested|do not (contact|message)|don'?t (contact|message))\b/i.test(text)
    || /(message|msg|mat|band)\s*(mat|band)\s*(karo|kijiye|karna)|mat bhejo|nahi chahiye|disturb mat/i.test(text);
}

/** Customer-service window: a free-form reply is fine within 24 h of the client's last message. */
export function lastInboundAt(messages: readonly WaMessage[]): number | null {
  const inbound = messages.filter((m) => !m.fromMe);
  return inbound.length ? inbound[inbound.length - 1]!.at : null;
}

export type SendKind = "reply" | "first_contact";

/** A message to someone who has never written to us is a first contact (counted against the daily cap). */
export function sendKind(messages: readonly WaMessage[]): SendKind {
  return messages.some((m) => !m.fromMe) ? "reply" : "first_contact";
}

export type SendCheck = { ok: true } | { ok: false; reason: string };

export function checkSend(input: { text: string; optedOut: boolean; kind: SendKind; newToday: number; dailyNewLimit: number }): SendCheck {
  const text = input.text.trim();
  if (!text) return { ok: false, reason: "Write a message first" };
  if (text.length > 1500) return { ok: false, reason: "Keep WhatsApp messages under 1,500 characters" };
  if (input.optedOut) return { ok: false, reason: "This person asked not to be messaged — the team will not message them again" };
  if (input.kind === "first_contact" && input.newToday >= input.dailyNewLimit) {
    return { ok: false, reason: `Daily limit reached: ${input.dailyNewLimit} new people per day keeps your number safe. Try tomorrow.` };
  }
  return { ok: true };
}

/** Topics that need the Founder's eye before anything is promised (price, money, legal, dates). */
export function needsCare(text: string): string[] {
  const hits: [RegExp, string][] = [
    [/₹|\brs\.?\s?\d|\binr\b|price|pricing|cost|rate|quote|discount|offer|paisa|kitne ka|kitna/i, "price"],
    [/refund|payment|invoice|advance|bank|upi/i, "money"],
    [/contract|agreement|legal|gst|tax|terms/i, "legal"],
    [/deadline|deliver(y|ed)? by|kab tak|date|guarantee|guaranteed/i, "promise"],
  ];
  return hits.filter(([re]) => re.test(text)).map(([, label]) => label);
}

/** Iris drafts the reply: short, human, in the client's language, never inventing prices or promises. */
export function draftPrompt(input: { clientName: string | null; history: readonly WaMessage[]; leadNote: string | null; founder: string }): string {
  const lines = input.history.slice(-14).map((m) => `${m.fromMe ? "Us" : input.clientName ?? "Client"}: ${m.hasMedia && !m.body ? "[media]" : m.body}`).join("\n");
  return `WHATSAPP REPLY. You write on behalf of ${input.founder}'s team to a client on WhatsApp.
${input.leadNote ? `What we know about this client: ${input.leadNote}\n` : ""}Conversation (oldest first):
${lines || "(no messages yet — this is the first message to them)"}

Write the next message from Us:
- Solve their problem or move it one clear step forward. If you don't know something, say we'll check and get back today.
- Same language and tone as the client (Hinglish if they wrote Hinglish). Short: 1–4 lines, friendly, like a real person. No markdown, no lists, no links unless they asked.
- NEVER invent prices, discounts, dates, guarantees or results. If they ask price, ask what they need or say ${input.founder} will share the exact quote.
- First message to someone new: introduce yourself in one line, one helpful line, end with a simple question. No hard selling.
Reply with ONLY the message text.`;
}

/** Cleans a model draft into a WhatsApp-ready message. */
export function cleanDraft(text: string): string {
  return text.replace(/```[a-z]*\n?|```/gi, "").replace(/^\s*(us|reply|message)\s*:\s*/i, "").replace(/\*\*(.+?)\*\*/g, "*$1*").trim().slice(0, 1500);
}
