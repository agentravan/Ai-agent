import { NextResponse, type NextRequest } from "next/server";
import { createServiceDb } from "@/lib/database/service";
import { env } from "@/lib/env";
import { parseWebhook, verifyWebhook } from "@/lib/integrations/waha";
import type { AppContext } from "@/modules/auth/session";
import { handleInbound } from "@/modules/whatsapp/automation";
import type { Organisation, Profile } from "@/types/domain";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Founder = Profile & { organisations: Organisation | null };

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
  const { data: founders } = await db.from("profiles").select("id, organisation_id, email, full_name, role, organisations(id, name, created_at)")
    .eq("role", "founder").order("created_at").limit(2).returns<Founder[]>();
  if (!founders?.length || founders.length > 1 || !founders[0]!.organisations) {
    console.error("[whatsapp] webhook needs exactly one founder organisation");
    return NextResponse.json({ ok: false }, { status: 409 });
  }
  const { organisations, ...profile } = founders[0]!;
  const ctx: AppContext = { db, userId: profile.id, email: profile.email, profile, organisation: organisations! };

  try {
    const handled = await handleInbound(ctx, msg);
    return NextResponse.json({ ok: true, handled });
  } catch (err) {
    console.error("[whatsapp] inbound failed", (err as Error).message);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
