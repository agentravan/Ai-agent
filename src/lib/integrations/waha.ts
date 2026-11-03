/**
 * WAHA — WhatsApp HTTP API (https://github.com/devlikeapro/waha), self-hosted by the Founder.
 * It logs in to the Founder's own WhatsApp number by QR (like WhatsApp Web) — no Meta setup, no per-message fees.
 * Unofficial: WhatsApp may restrict numbers that spam; the WhatsApp Desk keeps volumes small and human-approved.
 * The API key is server-only (X-Api-Key header). Nothing here runs unless WAHA_URL and WAHA_API_KEY are set.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";

export type WahaStatus = "WORKING" | "SCAN_QR_CODE" | "STARTING" | "STOPPED" | "FAILED" | "UNKNOWN";
export interface WaChat { id: string; name: string | null; lastAt: number | null; lastText: string | null; lastFromMe: boolean; unread: number }
export interface WaMessage { id: string; fromMe: boolean; body: string; at: number; hasMedia: boolean }

const TIMEOUT_MS = 12_000;

export const wahaConfigured = () => !!(env.WAHA_URL && env.WAHA_API_KEY);

export class WahaError extends Error {}

async function call<T>(path: string, init: RequestInit & { accept?: string } = {}): Promise<T> {
  if (!env.WAHA_URL || !env.WAHA_API_KEY) throw new WahaError("WhatsApp is not connected yet (WAHA_URL / WAHA_API_KEY missing).");
  const url = `${env.WAHA_URL.replace(/\/+$/, "")}${path}`;
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: { "X-Api-Key": env.WAHA_API_KEY, accept: init.accept ?? "application/json", ...(init.body ? { "content-type": "application/json" } : {}) },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (err) {
    throw new WahaError(/time|abort/i.test(String(err)) ? "The WhatsApp gateway did not answer in time — is the computer running it on?" : "Can't reach the WhatsApp gateway — is it running and online?");
  }
  if (res.status === 401 || res.status === 403) throw new WahaError("The WhatsApp gateway refused the key — WAHA_API_KEY in Vercel must match the gateway's key.");
  if (!res.ok) throw new WahaError(`WhatsApp gateway error ${res.status}`);
  if (init.accept?.startsWith("image/")) return (await res.arrayBuffer()) as T;
  return (await res.json()) as T;
}

const session = () => encodeURIComponent(env.WAHA_SESSION);

/* ───────────── Pure parsers (tolerant: WAHA engines return slightly different shapes) ───────────── */

const idOf = (v: unknown): string => {
  if (typeof v === "string") return v;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (typeof o._serialized === "string") return o._serialized;
    if (typeof o.id === "string") return o.id;
    if (typeof o.user === "string" && typeof o.server === "string") return `${o.user}@${o.server}`;
  }
  return "";
};
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

export function parseStatus(raw: unknown): WahaStatus {
  const s = String((raw as { status?: unknown })?.status ?? "").toUpperCase();
  return (["WORKING", "SCAN_QR_CODE", "STARTING", "STOPPED", "FAILED"] as const).find((x) => x === s) ?? "UNKNOWN";
}

/** One-to-one chats only (no groups, broadcasts or status), newest first. */
export function parseChats(raw: unknown): WaChat[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((c: Record<string, unknown>) => {
    const id = idOf(c.id);
    if (!/^\d{8,15}@(c\.us|s\.whatsapp\.net)$/.test(id)) return [];
    const last = (c.lastMessage ?? {}) as Record<string, unknown>;
    const ts = num(c.timestamp) ?? num(c.conversationTimestamp) ?? num(last.timestamp);
    return [{
      id, name: str(c.name, 80) ?? str((c.contact as Record<string, unknown> | undefined)?.pushname, 80),
      lastAt: ts, lastText: str(last.body, 200), lastFromMe: last.fromMe === true, unread: num(c.unreadCount) ?? 0,
    }];
  }).sort((a, b) => (b.lastAt ?? 0) - (a.lastAt ?? 0));
}

export function parseMessages(raw: unknown): WaMessage[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((m: Record<string, unknown>) => {
    const at = num(m.timestamp);
    const body = typeof m.body === "string" ? m.body.slice(0, 4000) : "";
    if (at === null || (!body && m.hasMedia !== true)) return [];
    return [{ id: idOf(m.id) || `${at}`, fromMe: m.fromMe === true, body, at, hasMedia: m.hasMedia === true }];
  }).sort((a, b) => a.at - b.at);
}

/* ───────────── Calls ───────────── */

export async function sessionStatus(): Promise<{ status: WahaStatus; me: string | null }> {
  const raw = await call<Record<string, unknown>>(`/api/sessions/${session()}`);
  return { status: parseStatus(raw), me: idOf((raw.me as Record<string, unknown> | undefined)?.id).split("@")[0] || null };
}

/** Starts the session if it is stopped (needed once after the gateway restarts). */
export async function startSession(): Promise<void> {
  await call(`/api/sessions/${session()}/start`, { method: "POST" });
}

/** The login QR as a data URL (shown only to the signed-in Founder, never stored). */
export async function qrDataUrl(): Promise<string> {
  const buf = await call<ArrayBuffer>(`/api/${session()}/auth/qr?format=image`, { accept: "image/png" });
  return `data:image/png;base64,${Buffer.from(buf).toString("base64")}`;
}

export async function listChats(limit = 30): Promise<WaChat[]> {
  return parseChats(await call(`/api/${session()}/chats?limit=${limit}&sortBy=conversationTimestamp&sortOrder=desc`));
}

export async function chatMessages(chatId: string, limit = 30): Promise<WaMessage[]> {
  return parseMessages(await call(`/api/${session()}/chats/${encodeURIComponent(chatId)}/messages?limit=${limit}&downloadMedia=false`));
}

export async function sendText(chatId: string, text: string): Promise<string | null> {
  const r = await call<Record<string, unknown>>("/api/sendText", { method: "POST", body: JSON.stringify({ session: env.WAHA_SESSION, chatId, text }) });
  return idOf(r?.id) || null;
}

/* ───────────── Webhook (WAHA → AI Empire) ───────────── */


/** WAHA signs the raw body with HMAC-SHA512 (hex) in X-Webhook-Hmac. Constant-time compare. */
export function verifyWebhook(rawBody: string, signature: string | null, secret: string | undefined): boolean {
  if (!secret || !signature) return false;
  const want = Buffer.from(createHmac("sha512", secret).update(rawBody).digest("hex"));
  const got = Buffer.from(signature.trim().toLowerCase());
  return got.length === want.length && timingSafeEqual(got, want);
}

export interface InboundMessage { id: string; chatId: string; body: string; hasMedia: boolean; at: number }

/** A real incoming 1:1 text from a client — or null (our own messages, groups, status, reactions, etc.). */
export function parseWebhook(raw: unknown): InboundMessage | null {
  const e = raw as { event?: unknown; payload?: Record<string, unknown> };
  if (e?.event !== "message" || !e.payload) return null;
  const p = e.payload;
  if (p.fromMe === true) return null;
  // One id per person: phone-gateway (Baileys) ids end in @s.whatsapp.net, WAHA's in @c.us.
  const chatId = idOf(p.from).replace(/@s\.whatsapp\.net$/, "@c.us");
  if (!/^\d{8,15}@c\.us$/.test(chatId)) return null;
  const id = idOf(p.id);
  const body = typeof p.body === "string" ? p.body.trim().slice(0, 4000) : "";
  if (!id || (!body && p.hasMedia !== true)) return null;
  return { id: id.slice(0, 200), chatId, body, hasMedia: p.hasMedia === true, at: num(p.timestamp) ?? Math.floor(Date.now() / 1000) };
}
