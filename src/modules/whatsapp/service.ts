import "server-only";
import { env } from "@/lib/env";
import { WahaError, type WaChat, type WaMessage } from "@/lib/integrations/waha";
import * as transport from "./transport";
import { UserFacingError } from "@/lib/utilities/action";
import { logEvent } from "@/modules/audit/service";
import type { AppContext } from "@/modules/auth/session";
import { founderFirstName } from "@/modules/board/service";
import { listAgents, runAgent } from "@/modules/orchestration/engine";
import { chatIdFor, checkSend, cleanDraft, draftPrompt, isWaOptOut, needsCare, sendKind } from "./logic";

export interface DeskState {
  configured: boolean;
  mode: transport.Mode;
  status: transport.LinkStatus | "NOT_CONFIGURED" | "UNREACHABLE";
  error: string | null;
  me: string | null;
  qr: string | null;
  pairingCode: string | null;
  lastSeen: string | null;
  chats: (WaChat & { optedOut: boolean; leadName: string | null })[];
  newToday: number;
  dailyNewLimit: number;
}

type LeadLite = { id: string; name: string; phone: string | null; country: string | null; ai_reason: string | null; status: string };

/** Leads with a phone, keyed by their WhatsApp chat id (to show who a chat is and give Iris context). */
async function leadsByChat(ctx: AppContext): Promise<Map<string, LeadLite>> {
  const { data } = await ctx.db.from("leads").select("id, name, phone, country, ai_reason, status").eq("organisation_id", ctx.organisation.id).not("phone", "is", null).limit(1000).returns<LeadLite[]>();
  const map = new Map<string, LeadLite>();
  for (const l of data ?? []) { const id = chatIdFor(l.phone, l.country ?? "India"); if (id && !map.has(id)) map.set(id, l); }
  return map;
}

async function optedOutSet(ctx: AppContext): Promise<Set<string>> {
  const { data } = await ctx.db.from("whatsapp_contacts").select("chat_id").eq("organisation_id", ctx.organisation.id).eq("opted_out", true).returns<{ chat_id: string }[]>();
  return new Set((data ?? []).map((r) => r.chat_id));
}

/** First contacts sent today (IST), for the daily cap. */
async function newContactsToday(ctx: AppContext): Promise<number> {
  const istMidnight = new Date(`${new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date())}T00:00:00+05:30`).toISOString();
  const { count } = await ctx.db.from("whatsapp_sends").select("id", { count: "exact", head: true }).eq("organisation_id", ctx.organisation.id).eq("kind", "first_contact").gte("created_at", istMidnight);
  return count ?? 0;
}

const friendly = (err: unknown) => (err instanceof WahaError ? err.message : "The WhatsApp gateway had a problem — try again in a minute.");

/** Everything the WhatsApp Desk shows: connection, QR when logging in, recent chats. */
export async function deskState(ctx: AppContext): Promise<DeskState> {
  const m = transport.mode();
  const base: DeskState = { configured: m !== "none", mode: m, status: "NOT_CONFIGURED", error: null, me: null, qr: null, pairingCode: null, lastSeen: null, chats: [], newToday: 0, dailyNewLimit: env.WHATSAPP_DAILY_NEW_LIMIT };
  if (m === "none") return base;
  try {
    const l = await transport.link(ctx);
    const state: DeskState = { ...base, status: l.status, me: l.me, qr: l.qr, pairingCode: l.pairingCode, lastSeen: l.lastSeen, newToday: await newContactsToday(ctx) };
    // Phone mode: past chats stay readable even while the phone is offline (replies wait in the queue).
    if (l.status === "WORKING" || m === "phone") {
      const [chats, leads, out] = await Promise.all([transport.listChats(ctx, 30), leadsByChat(ctx), optedOutSet(ctx)]);
      state.chats = chats.map((c) => ({ ...c, optedOut: out.has(c.id), leadName: leads.get(c.id)?.name ?? null }));
    }
    return state;
  } catch (err) {
    return { ...base, status: "UNREACHABLE", error: friendly(err) };
  }
}

/** One conversation. A client who asked to stop is remembered permanently. */
export async function openChat(ctx: AppContext, chatId: string): Promise<{ messages: WaMessage[]; optedOut: boolean; lead: LeadLite | null; error: string | null }> {
  const [leads, out] = await Promise.all([leadsByChat(ctx), optedOutSet(ctx)]);
  const lead = leads.get(chatId) ?? null;
  try {
    const messages = await transport.chatMessages(ctx, chatId, 40);
    let optedOut = out.has(chatId);
    if (!optedOut && messages.some((m) => !m.fromMe && isWaOptOut(m.body))) {
      await ctx.db.from("whatsapp_contacts").upsert({ organisation_id: ctx.organisation.id, chat_id: chatId, lead_id: lead?.id ?? null, opted_out: true, opted_out_at: new Date().toISOString() }, { onConflict: "organisation_id,chat_id" });
      if (lead) await ctx.db.from("leads").update({ status: "lost", outcome_note: "Asked to stop on WhatsApp" }).eq("id", lead.id).eq("organisation_id", ctx.organisation.id);
      await logEvent(ctx, { action: "whatsapp.opt_out", entity: "whatsapp_contacts", metadata: { chat: chatId.slice(-4) } });
      optedOut = true;
    }
    return { messages, optedOut, lead, error: null };
  } catch (err) {
    return { messages: [], optedOut: out.has(chatId), lead, error: friendly(err) };
  }
}

/** Iris (sales) drafts the next message — governed run, nothing is sent. */
export async function draftReply(ctx: AppContext, chatId: string): Promise<{ draft: string; care: string[]; agentId: string; agentName: string }> {
  const [agents, chat] = await Promise.all([listAgents(ctx), openChat(ctx, chatId)]);
  if (chat.optedOut) throw new UserFacingError("This person asked not to be messaged.");
  if (chat.error) throw new UserFacingError(chat.error);
  const active = agents.filter((a) => a.status === "active");
  const writer = active.find((a) => a.name === "Iris") ?? active.find((a) => /sales|outreach/i.test(a.designation)) ?? active.find((a) => a.tier === "ceo");
  if (!writer) throw new UserFacingError("No active sales agent to write the reply — activate Iris in the Agent Registry.");
  const leadNote = chat.lead ? `${chat.lead.name} (lead status: ${chat.lead.status})${chat.lead.ai_reason ? ` — ${chat.lead.ai_reason.slice(0, 300)}` : ""}` : null;
  const { execution, result } = await runAgent(ctx, {
    agent: writer, kind: "chat", maxTokens: 350, budgetMs: 30_000, attemptMs: 10_000,
    input: draftPrompt({ clientName: chat.lead?.name ?? null, history: chat.messages, leadNote, founder: founderFirstName(ctx) }),
    parse: (t) => cleanDraft(t),
  });
  if (!result) {
    console.warn("[whatsapp] draft failed", execution.error);
    throw new UserFacingError(`${writer.name} couldn't write a reply just now — try again in a minute.`);
  }
  const lastInbound = [...chat.messages].reverse().find((m) => !m.fromMe)?.body ?? "";
  return { draft: result, care: [...new Set([...needsCare(result), ...needsCare(lastInbound)])], agentId: writer.id, agentName: writer.name };
}

/** The Founder pressed Send: re-check opt-out and the daily cap, send, and keep an audit row. */
export async function sendMessage(ctx: AppContext, chatId: string, text: string, draftedBy: string | null): Promise<string> {
  const chat = await openChat(ctx, chatId);
  if (chat.error) throw new UserFacingError(chat.error);
  const kind = sendKind(chat.messages);
  const check = checkSend({ text, optedOut: chat.optedOut, kind, newToday: kind === "first_contact" ? await newContactsToday(ctx) : 0, dailyNewLimit: env.WHATSAPP_DAILY_NEW_LIMIT });
  if (!check.ok) throw new UserFacingError(check.reason);
  let waId: string | null;
  try { waId = await transport.send(ctx, chatId, text.trim()); } catch (err) { throw new UserFacingError(friendly(err)); }
  const { error } = await ctx.db.from("whatsapp_sends").insert({
    organisation_id: ctx.organisation.id, chat_id: chatId, body: text.trim().slice(0, 4000), kind, drafted_by: draftedBy, sent_by: ctx.userId, wa_message_id: waId,
  });
  if (error) console.error("[whatsapp] send not logged", error.message);
  if (kind === "first_contact") {
    await ctx.db.from("whatsapp_contacts").upsert({ organisation_id: ctx.organisation.id, chat_id: chatId, lead_id: chat.lead?.id ?? null, first_contact_at: new Date().toISOString() }, { onConflict: "organisation_id,chat_id", ignoreDuplicates: false });
  }
  if (chat.lead && ["approved", "pitch_ready", "qualified", "new"].includes(chat.lead.status)) {
    await ctx.db.from("leads").update({ status: "contacted", contacted_at: new Date().toISOString(), contact_channel: "whatsapp" }).eq("id", chat.lead.id).eq("organisation_id", ctx.organisation.id);
  }
  await logEvent(ctx, { action: "whatsapp.sent", entity: "whatsapp_sends", metadata: { kind, chat: chatId.slice(-4) } });
  const queued = transport.mode() === "phone" ? " (your phone sends it within seconds)" : "";
  return `${kind === "first_contact" ? "Sent — first message to a new contact" : "Sent"}${queued}`;
}

/** Opens (or starts) a chat from a phone number. */
export function chatFromPhone(phone: string): string {
  const id = chatIdFor(phone, "India");
  if (!id) throw new UserFacingError("That doesn't look like a WhatsApp number — use 10 digits or +country code.");
  return id;
}
