// AI Empire OS — WhatsApp phone gateway (runs in Termux on the Founder's own phone).
// Links WhatsApp as a "linked device" (pairing code, no QR needed on the same phone) and relays:
//   client message  → POST {APP_URL}/api/whatsapp/waha      (signed)
//   status/heartbeat → POST {APP_URL}/api/whatsapp/gateway   (signed)
//   queued replies   ← POST {APP_URL}/api/whatsapp/gateway  {action:"poll"} → send → {action:"ack"}
// Only outgoing HTTPS requests: no open port, no tunnel, no server. Every request is HMAC-SHA512 signed with SECRET.
// Session keys stay in ./auth on this phone (never uploaded).
import { createHmac } from "node:crypto";
import { readFileSync, rmSync, existsSync } from "node:fs";
import makeWASocket, { Browsers, DisconnectReason, fetchLatestBaileysVersion, useMultiFileAuthState } from "@whiskeysockets/baileys";
import pino from "pino";

// ── config (.env next to this file) ─────────────────────────────────────────────
const envFile = new URL("./.env", import.meta.url);
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split("\n")) {
    const m = /^\s*([A-Z_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
const APP_URL = (process.env.APP_URL || "https://ai-os-hq.vercel.app").replace(/\/+$/, "");
const SECRET = process.env.SECRET || "";
const PHONE = (process.env.PHONE || "").replace(/\D/g, "");
if (SECRET.length < 24) { console.error("SECRET missing or too short in .env (same value as WHATSAPP_WEBHOOK_SECRET in Vercel)."); process.exit(1); }
if (!/^\d{10,15}$/.test(PHONE)) { console.error("PHONE missing in .env — your WhatsApp number with country code, e.g. 919876543210."); process.exit(1); }

const POLL_MS = 10_000;
const HEARTBEAT_MS = 60_000;
const AUTH_DIR = new URL("./auth/", import.meta.url).pathname;
const log = (...a) => console.log(new Date().toLocaleTimeString("en-IN"), ...a);

// ── signed calls to the app ─────────────────────────────────────────────────────
async function call(path, payload) {
  const body = JSON.stringify(payload);
  const sig = createHmac("sha512", SECRET).update(body).digest("hex");
  const res = await fetch(`${APP_URL}${path}`, { method: "POST", headers: { "content-type": "application/json", "x-webhook-hmac": sig }, body, signal: AbortSignal.timeout(55_000) });
  if (res.status === 401) throw new Error("App refused the signature — SECRET must equal WHATSAPP_WEBHOOK_SECRET in Vercel (and the phone clock must be correct).");
  if (!res.ok) throw new Error(`App answered ${res.status}`);
  return res.json();
}
const status = (s, extra = {}) => call("/api/whatsapp/gateway", { action: "status", ts: Date.now(), status: s, ...extra }).catch((e) => log("status:", e.message));

// ── helpers ─────────────────────────────────────────────────────────────────────
/** A real phone-number chat id; WhatsApp sometimes hides numbers behind "@lid" ids. */
function personJid(key) {
  return [key.remoteJidAlt, key.senderPn, key.remoteJid].find((j) => typeof j === "string" && /^\d{8,15}@s\.whatsapp\.net$/.test(j)) || null;
}
function textOf(msg) {
  const m = msg.message || {};
  const inner = m.ephemeralMessage?.message || m.viewOnceMessage?.message || m;
  const text = inner.conversation || inner.extendedTextMessage?.text || inner.imageMessage?.caption || inner.videoMessage?.caption || inner.documentMessage?.caption || "";
  const hasMedia = !!(inner.imageMessage || inner.videoMessage || inner.audioMessage || inner.documentMessage || inner.stickerMessage);
  return { text: String(text).slice(0, 4000), hasMedia };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const withTimeout = (p, ms, what) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`${what} timed out`)), ms))]);

// ── WhatsApp link ───────────────────────────────────────────────────────────────
let sock = null;
let connected = false;
let pollTimer = null;
// One pairing code per run: asking again and again makes WhatsApp block linking for a while.
let codeShownAt = 0;
const CODE_VALID_MS = 3 * 60_000;

async function pollOnce() {
  if (!connected || !sock) return;
  try {
    const { items = [] } = await call("/api/whatsapp/gateway", { action: "poll", ts: Date.now() });
    for (const it of items) {
      try {
        const sent = await sock.sendMessage(it.to, { text: it.text });
        await call("/api/whatsapp/gateway", { action: "ack", ts: Date.now(), id: it.id, ok: true, wa_id: sent?.key?.id ?? null });
        log("sent reply →", it.to.slice(-4));
        await sleep(1500 + Math.random() * 2500); // human-like gap between messages
      } catch (e) {
        await call("/api/whatsapp/gateway", { action: "ack", ts: Date.now(), id: it.id, ok: false, error: String(e.message || e).slice(0, 280) }).catch(() => {});
      }
    }
  } catch (e) { log("poll:", e.message); }
}

async function start() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await withTimeout(fetchLatestBaileysVersion(), 10_000, "version check").catch(() => ({ version: undefined }));
  sock = makeWASocket({
    version, auth: state, printQRInTerminal: false, browser: Browsers.ubuntu("Chrome"),
    logger: pino({ level: "silent" }), markOnlineOnConnect: false, syncFullHistory: false,
  });
  sock.ev.on("creds.update", saveCreds);
  await status("connecting");

  sock.ev.on("connection.update", async ({ connection, lastDisconnect, qr }) => {
    // WhatsApp is ready to link (it offers a QR) → ask for a pairing code instead — once, and only when the last one expired.
    if (qr && !sock.authState.creds.registered && Date.now() - codeShownAt > CODE_VALID_MS) {
      codeShownAt = Date.now();
      try {
        const code = await withTimeout(sock.requestPairingCode(PHONE), 30_000, "pairing code");
        const pretty = code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
        log("");
        log(`PAIRING CODE:  ${pretty.split("").join(" ")}`);
        log("→ WhatsApp Business → ⋮ → Linked devices → Link a device → Link with phone number instead");
        log("  (valid ~3 min — enter it now; letters are capital, P≠9, O≠0, I≠1)");
        await status("pairing", { pairing_code: pretty.toUpperCase() });
      } catch (e) { codeShownAt = 0; log("pairing code failed:", e.message, "— retrying soon"); }
    }
    if (connection === "open") {
      connected = true;
      log("✅ WhatsApp connected");
      await status("connected", { me: (sock.user?.id || "").split(/[:@]/)[0] || null });
      clearInterval(pollTimer);
      pollTimer = setInterval(pollOnce, POLL_MS);
    }
    if (connection === "close") {
      connected = false;
      clearInterval(pollTimer);
      const code = lastDisconnect?.error?.output?.statusCode;
      const wasLinked = !!sock?.authState?.creds?.registered;
      if (code === DisconnectReason.loggedOut && wasLinked) {
        log("WhatsApp unlinked this device — starting a fresh link.");
        await status("logged_out");
        rmSync(AUTH_DIR, { recursive: true, force: true });
        codeShownAt = 0;
      } else if (!wasLinked && code === DisconnectReason.loggedOut) {
        log("That code didn't work (wrong or expired) — getting a fresh one…");
        rmSync(AUTH_DIR, { recursive: true, force: true });
        codeShownAt = 0;
      } else if (!wasLinked) {
        log("waiting for you to enter the code…");
      } else log("connection closed, reconnecting…", code ?? "");
      await sleep(wasLinked ? 5000 : 3000);
      start().catch((e) => { log("restart failed:", e.message); setTimeout(() => process.exit(1), 2000); });
    }
  });

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;
    for (const m of messages) {
      if (m.key.fromMe) continue;
      const jid = personJid(m.key);
      if (!jid) continue; // groups, status, broadcasts, hidden numbers
      const { text, hasMedia } = textOf(m);
      if (!text && !hasMedia) continue; // reactions, receipts, system messages
      try {
        const r = await call("/api/whatsapp/waha", { event: "message", payload: { id: m.key.id, from: jid, fromMe: false, body: text, hasMedia, timestamp: Number(m.messageTimestamp) || Math.floor(Date.now() / 1000) } });
        log("client message from …" + jid.split("@")[0].slice(-4), "→", r.handled ?? "ok");
        if (r.handled === "auto_sent") setTimeout(pollOnce, 1500); // Iris replied: send it right away
      } catch (e) { log("forward failed:", e.message); }
    }
  });
}

setInterval(() => { if (connected) status("connected", { me: (sock?.user?.id || "").split(/[:@]/)[0] || null }); }, HEARTBEAT_MS);
process.on("unhandledRejection", (e) => log("error:", e?.message || e));
log(`AI Empire WhatsApp gateway → ${APP_URL}`);
start().catch((e) => { log("start failed:", e.message); process.exit(1); });
