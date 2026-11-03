import "server-only";
import { env } from "@/lib/env";
import * as waha from "@/lib/integrations/waha";
import type { WaChat, WaMessage } from "@/lib/integrations/waha";
import { chatsFromHistory, mergeHistory, phoneLink, type In, type Link, type Out } from "./transport-logic";
export type { Link, LinkStatus } from "./transport-logic";
import type { AppContext } from "@/modules/auth/session";

/**
 * How WhatsApp is connected:
 *  - "waha":  a WAHA server the app calls (WAHA_URL + WAHA_API_KEY).
 *  - "phone": the gateway runs in Termux on the Founder's own phone and only calls the app (signed with
 *             WHATSAPP_WEBHOOK_SECRET). Replies are queued; the phone collects and sends them. History comes
 *             from what the app recorded (incoming messages + our replies).
 *  - "none":  not set up.
 */
export type Mode = "waha" | "phone" | "none";
export const mode = (): Mode => (waha.wahaConfigured() ? "waha" : env.WHATSAPP_WEBHOOK_SECRET ? "phone" : "none");

export async function link(ctx: AppContext): Promise<Link> {
  if (mode() === "waha") {
    let { status, me } = await waha.sessionStatus();
    if (status === "STOPPED") { await waha.startSession(); status = "STARTING"; }
    return { status, me, qr: status === "SCAN_QR_CODE" ? await waha.qrDataUrl().catch(() => null) : null, pairingCode: null, lastSeen: null };
  }
  const { data } = await ctx.db.from("whatsapp_gateway").select("status, pairing_code, me, last_seen").eq("organisation_id", ctx.organisation.id).maybeSingle<{ status: string; pairing_code: string | null; me: string | null; last_seen: string }>();
  return phoneLink(data);
}

export async function listChats(ctx: AppContext, limit = 30): Promise<WaChat[]> {
  if (mode() === "waha") return waha.listChats(limit);
  const org = ctx.organisation.id;
  const [{ data: inbound }, { data: outbound }] = await Promise.all([
    ctx.db.from("whatsapp_inbound").select("wa_message_id, chat_id, body, created_at").eq("organisation_id", org).order("created_at", { ascending: false }).limit(400).returns<In[]>(),
    ctx.db.from("whatsapp_outbox").select("id, chat_id, body, status, created_at").eq("organisation_id", org).order("created_at", { ascending: false }).limit(400).returns<Out[]>(),
  ]);
  return chatsFromHistory(inbound ?? [], outbound ?? []).slice(0, limit);
}

export async function chatMessages(ctx: AppContext, chatId: string, limit = 40): Promise<WaMessage[]> {
  if (mode() === "waha") return waha.chatMessages(chatId, limit);
  const org = ctx.organisation.id;
  const [{ data: inbound }, { data: outbound }] = await Promise.all([
    ctx.db.from("whatsapp_inbound").select("wa_message_id, chat_id, body, created_at").eq("organisation_id", org).eq("chat_id", chatId).order("created_at", { ascending: false }).limit(limit).returns<In[]>(),
    ctx.db.from("whatsapp_outbox").select("id, chat_id, body, status, created_at").eq("organisation_id", org).eq("chat_id", chatId).order("created_at", { ascending: false }).limit(limit).returns<Out[]>(),
  ]);
  return mergeHistory(inbound ?? [], outbound ?? []).slice(-limit);
}

/** Sends now (WAHA) or queues for the phone to send within seconds. Returns the WhatsApp id when known. */
export async function send(ctx: AppContext, chatId: string, text: string): Promise<string | null> {
  if (mode() === "waha") return waha.sendText(chatId, text);
  if (mode() === "none") throw new waha.WahaError("WhatsApp is not connected yet.");
  const { data, error } = await ctx.db.from("whatsapp_outbox").insert({ organisation_id: ctx.organisation.id, chat_id: chatId, body: text, created_by: ctx.userId }).select("id").single<{ id: string }>();
  if (error || !data) throw new waha.WahaError("Couldn't queue the message for your phone — try again.");
  return null;
}
