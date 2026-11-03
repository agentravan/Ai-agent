import { NextResponse, type NextRequest } from "next/server";
import { createServiceDb } from "@/lib/database/service";
import { env } from "@/lib/env";
import { parseWebhook, verifyWebhook } from "@/lib/integrations/waha";
import { handleInbound } from "@/modules/whatsapp/automation";
import { founderContext } from "@/modules/whatsapp/founder-context";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * WAHA → AI Empire: a client wrote on WhatsApp. Machine-to-machine like the cron routes: no user session, so it is
 * accepted ONLY with a valid HMAC-SHA512 signature (WHATSAPP_WEBHOOK_SECRET) and then acts as the Founder's org
 * through the scheduled-jobs client. Responses carry no data (the gateway only needs 200).
 */
export async function POST(req: NextRequest) {
  const raw = await req.text();
  if (raw.length > 200_000) return NextResponse.json({ ok: false }, { status: 413 });
  if (!verifyWebhook(raw, req.headers.get("x-webhook-hmac"), env.WHATSAPP_WEBHOOK_SECRET)) return NextResponse.json({ ok: false }, { status: 401 });

  let event: unknown;
  try { event = JSON.parse(raw); } catch { return NextResponse.json({ ok: false }, { status: 400 }); }
  const msg = parseWebhook(event);
  if (!msg) return NextResponse.json({ ok: true, ignored: true });

  const db = createServiceDb();
  if (!db) return NextResponse.json({ ok: false, reason: "pending" }, { status: 503 });
  // One gateway = one company: the Founder's organisation (the only founder in this deployment).
  const ctx = await founderContext(db);
  if (!ctx) { console.error("[whatsapp] webhook needs exactly one founder organisation"); return NextResponse.json({ ok: false }, { status: 409 }); }

  try {
    const handled = await handleInbound(ctx, msg);
    return NextResponse.json({ ok: true, handled });
  } catch (err) {
    console.error("[whatsapp] inbound failed", (err as Error).message);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
