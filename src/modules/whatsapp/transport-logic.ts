/** Pure parts of the WhatsApp transport (unit-tested). */
import type { WaChat, WaMessage, WahaStatus } from "@/lib/integrations/waha";

export type LinkStatus = WahaStatus | "PAIRING" | "OFFLINE" | "LOGGED_OUT";
export interface Link { status: LinkStatus; me: string | null; qr: string | null; pairingCode: string | null; lastSeen: string | null }

/** The phone counts as online if it checked in during the last 3 minutes (it polls every ~10 s). */
export const PHONE_ONLINE_MS = 3 * 60_000;

export function phoneLink(row: { status: string; pairing_code: string | null; me: string | null; last_seen: string } | null, now = Date.now()): Link {
  if (!row) return { status: "OFFLINE", me: null, qr: null, pairingCode: null, lastSeen: null };
  const online = now - new Date(row.last_seen).getTime() < PHONE_ONLINE_MS;
  const status: LinkStatus = !online ? "OFFLINE"
    : row.status === "connected" ? "WORKING" : row.status === "pairing" ? "PAIRING" : row.status === "logged_out" ? "LOGGED_OUT" : "STARTING";
  return { status, me: row.me, qr: null, pairingCode: status === "PAIRING" ? row.pairing_code : null, lastSeen: row.last_seen };
}

export type In = { wa_message_id: string; chat_id: string; body: string | null; created_at: string };
export type Out = { id: string; chat_id: string; body: string; status: string; created_at: string };
const unix = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);

/** Phone mode: chats and messages from what the app recorded (incoming + queued/sent replies). */
export function mergeHistory(inbound: readonly In[], outbound: readonly Out[]): WaMessage[] {
  return [
    ...inbound.map((m) => ({ id: m.wa_message_id, fromMe: false, body: m.body ?? "", at: unix(m.created_at), hasMedia: !m.body })),
    ...outbound.map((m) => ({ id: m.id, fromMe: true, body: m.status === "sent" ? m.body : `${m.body}${m.status === "failed" ? "  ⚠ not sent" : "  ⏳"}`, at: unix(m.created_at), hasMedia: false })),
  ].sort((a, b) => a.at - b.at);
}

export function chatsFromHistory(inbound: readonly In[], outbound: readonly Out[]): WaChat[] {
  const map = new Map<string, WaChat>();
  const add = (chatId: string, at: number, text: string, fromMe: boolean) => {
    const c = map.get(chatId);
    if (!c || (c.lastAt ?? 0) < at) map.set(chatId, { id: chatId, name: null, lastAt: at, lastText: text.slice(0, 200), lastFromMe: fromMe, unread: 0 });
  };
  inbound.forEach((m) => add(m.chat_id, unix(m.created_at), m.body ?? "📎 media", false));
  outbound.forEach((m) => add(m.chat_id, unix(m.created_at), m.body, true));
  return [...map.values()].sort((a, b) => (b.lastAt ?? 0) - (a.lastAt ?? 0));
}

