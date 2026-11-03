import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createServiceDb } from "@/lib/database/service";
import { env } from "@/lib/env";
import { verifyWebhook } from "@/lib/integrations/waha";
import { founderContext } from "@/modules/whatsapp/founder-context";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** Messages are re-offered if the phone took one but never confirmed it (e.g. lost signal). */
const RECLAIM_MS = 2 * 60_000;
const MAX_ATTEMPTS = 5;

const body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("status"), ts: z.number(), status: z.enum(["connecting", "pairing", "connected", "logged_out"]),
    pairing_code: z.string().regex(/^[A-Z0-9-]{8,9}$/).nullish(), me: z.string().regex(/^\d{6,15}$/).nullish() }),
  z.object({ action: z.literal("poll"), ts: z.number() }),
  z.object({ action: z.literal("ack"), ts: z.number(), id: z.uuid(), ok: z.boolean(), wa_id: z.string().max(200).nullish(), error: z.string().max(300).nullish() }),
]);

/**
 * The phone gateway (Termux on the Founder's phone) talks to the app only through this signed endpoint:
 * status/heartbeat, collect queued replies, confirm sends. HMAC-SHA512 with WHATSAPP_WEBHOOK_SECRET and a
 * 5-minute timestamp window (no replays). It never receives anything but the replies it must send.
 */
export async function POST(req: NextRequest) {
  const raw = await req.text();
  if (raw.length > 20_000) return NextResponse.json({ ok: false }, { status: 413 });
  if (!verifyWebhook(raw, req.headers.get("x-webhook-hmac"), env.WHATSAPP_WEBHOOK_SECRET)) return NextResponse.json({ ok: false }, { status: 401 });
  let input: z.infer<typeof body>;
  try { input = body.parse(JSON.parse(raw)); } catch { return NextResponse.json({ ok: false }, { status: 400 }); }
  if (Math.abs(Date.now() - input.ts) > 5 * 60_000) return NextResponse.json({ ok: false, error: "clock" }, { status: 401 });

  const db = createServiceDb();
  if (!db) return NextResponse.json({ ok: false }, { status: 503 });
  const ctx = await founderContext(db);
  if (!ctx) return NextResponse.json({ ok: false }, { status: 409 });
  const org = ctx.organisation.id;
  const now = new Date().toISOString();

  if (input.action === "status") {
    await db.from("whatsapp_gateway").upsert({
      organisation_id: org, status: input.status, last_seen: now,
      pairing_code: input.status === "pairing" ? input.pairing_code ?? null : null, me: input.me ?? null,
    }, { onConflict: "organisation_id" });
    return NextResponse.json({ ok: true });
  }

  if (input.action === "ack") {
    await db.from("whatsapp_outbox").update(input.ok
      ? { status: "sent", sent_at: now, wa_message_id: input.wa_id ?? null, error: null }
      : { status: "failed", error: (input.error ?? "not sent").slice(0, 300) })
      .eq("id", input.id).eq("organisation_id", org).eq("status", "sending");
    return NextResponse.json({ ok: true });
  }

  // poll: heartbeat + hand over up to 5 replies (new ones, or ones the phone took but never confirmed).
  await db.from("whatsapp_gateway").update({ last_seen: now }).eq("organisation_id", org);
  const stale = new Date(Date.now() - RECLAIM_MS).toISOString();
  const { data: due } = await db.from("whatsapp_outbox").select("id, chat_id, body, attempts, status")
    .eq("organisation_id", org).or(`status.eq.pending,and(status.eq.sending,claimed_at.lt.${stale})`)
    .lt("attempts", MAX_ATTEMPTS).order("created_at").limit(5)
    .returns<{ id: string; chat_id: string; body: string; attempts: number; status: string }[]>();
  const items: { id: string; to: string; text: string }[] = [];
  for (const m of due ?? []) {
    const { data: claimed } = await db.from("whatsapp_outbox").update({ status: "sending", claimed_at: now, attempts: m.attempts + 1 })
      .eq("id", m.id).eq("status", m.status).select("id").maybeSingle();
    if (claimed) items.push({ id: m.id, to: m.chat_id.replace(/@c\.us$/, "@s.whatsapp.net"), text: m.body });
  }
  // Gave up after 5 tries: mark failed so the desk shows it.
  await db.from("whatsapp_outbox").update({ status: "failed", error: "phone could not send after 5 tries" })
    .eq("organisation_id", org).eq("status", "sending").gte("attempts", MAX_ATTEMPTS).lt("claimed_at", stale);
  return NextResponse.json({ ok: true, items });
}
