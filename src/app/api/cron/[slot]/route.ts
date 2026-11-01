import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { createServiceDb } from "@/lib/database/service";
import { env } from "@/lib/env";
import { emailConfigured, sendEmail } from "@/lib/integrations/email";
import type { AppContext } from "@/modules/auth/session";
import { buildDailyReport, type Slot } from "@/modules/reports/daily";
import type { Organisation, Profile } from "@/types/domain";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function authorised(req: NextRequest): boolean {
  if (!env.CRON_SECRET) return false;
  const got = Buffer.from(req.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${env.CRON_SECRET}`);
  return got.length === want.length && timingSafeEqual(got, want);
}

/** Vercel Cron: 09:00 IST morning briefing (+ prospecting) and 19:00 IST evening wrap-up, emailed to the Founder. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ slot: string }> }) {
  if (!authorised(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { slot } = await params;
  if (slot !== "morning" && slot !== "evening") return NextResponse.json({ error: "unknown slot" }, { status: 404 });

  const db = createServiceDb();
  if (!db) return NextResponse.json({ status: "pending", reason: "SUPABASE_SERVICE_ROLE_KEY not configured" }, { status: 503 });
  if (!emailConfigured()) return NextResponse.json({ status: "pending", reason: "Mailbox not connected (MAIL_USER / MAIL_PASSWORD)" }, { status: 503 });

  const { data: founders } = await db.from("profiles").select("id, organisation_id, email, full_name, role, organisations(id, name, created_at)").eq("role", "founder")
    .returns<(Profile & { organisations: Organisation | null })[]>();
  const results: { org: string; ok: boolean; error?: string }[] = [];
  for (const f of founders ?? []) {
    if (!f.organisations) continue;
    const { organisations, ...profile } = f;
    const ctx: AppContext = { db, userId: f.id, email: f.email, profile, organisation: organisations };
    try {
      const report = await buildDailyReport(ctx, slot as Slot, { prospect: slot === "morning" });
      await sendEmail({ to: env.REPORT_EMAIL ?? f.email, subject: report.subject, text: report.text, html: report.html });
      results.push({ org: organisations.id, ok: true });
    } catch (err) {
      console.error("[cron]", slot, organisations.id, err);
      results.push({ org: organisations.id, ok: false, error: (err as Error).message.slice(0, 200) });
    }
  }
  return NextResponse.json({ status: "ok", slot, results });
}
