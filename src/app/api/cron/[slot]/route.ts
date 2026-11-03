import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { createServiceDb } from "@/lib/database/service";
import { env } from "@/lib/env";
import { emailConfigured, sendEmail } from "@/lib/integrations/email";
import type { AppContext } from "@/modules/auth/session";
import { runAutopilot } from "@/modules/autopilot/service";
import { runDueStandup } from "@/modules/board/service";
import { activeProvider } from "@/lib/ai/registry";
import { buildDailyReport, type Slot } from "@/modules/reports/daily";
import type { Organisation, Profile } from "@/types/domain";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Leave headroom under maxDuration so a cycle always returns before the platform kills it. */
const AUTOPILOT_BUDGET_MS = 240_000;
const MIN_ORG_BUDGET_MS = 30_000;

function authorised(req: NextRequest): boolean {
  if (!env.CRON_SECRET) return false;
  const got = Buffer.from(req.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${env.CRON_SECRET}`);
  return got.length === want.length && timingSafeEqual(got, want);
}

type Founder = Profile & { organisations: Organisation | null };

/**
 * Scheduled jobs (CRON_SECRET-protected):
 *  - morning / evening: Vercel Cron, 09:00 IST briefing (+ prospecting) and 19:00 IST wrap-up, emailed to the Founder;
 *    each also holds the daily stand-up meeting if it has not happened yet.
 *  - autopilot: every 30 min (GitHub Actions; daily Vercel Cron as backup). Agents work ready tasks and the system
 *    heals itself. The response holds counts only: it can end up in public CI logs.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ slot: string }> }) {
  if (!authorised(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { slot } = await params;
  if (slot !== "morning" && slot !== "evening" && slot !== "autopilot") return NextResponse.json({ error: "unknown slot" }, { status: 404 });

  const db = createServiceDb();
  if (!db) return NextResponse.json({ status: "pending", reason: "SUPABASE_SERVICE_ROLE_KEY not configured" }, { status: 503 });
  if (slot !== "autopilot" && !emailConfigured()) return NextResponse.json({ status: "pending", reason: "Mailbox not connected (MAIL_USER / MAIL_PASSWORD)" }, { status: 503 });

  const { data: founders } = await db.from("profiles").select("id, organisation_id, email, full_name, role, organisations(id, name, created_at)").eq("role", "founder")
    .returns<Founder[]>();
  const contexts: AppContext[] = (founders ?? []).flatMap((f) => {
    if (!f.organisations) return [];
    const { organisations, ...profile } = f;
    return [{ db, userId: f.id, email: f.email, profile, organisation: organisations }];
  });

  if (slot === "autopilot") {
    const deadline = Date.now() + AUTOPILOT_BUDGET_MS;
    const totals = { orgs: 0, failedOrgs: 0, ran: 0, succeeded: 0, failed: 0, requeued: 0, needsFounder: 0, alerts: 0 };
    for (const ctx of contexts) {
      const budget = deadline - Date.now();
      if (budget < MIN_ORG_BUDGET_MS) break;
      totals.orgs++;
      try {
        const s = await runAutopilot(ctx, budget);
        totals.ran += s.ran;
        totals.succeeded += s.succeeded;
        totals.failed += s.failed;
        totals.requeued += s.requeued;
        totals.needsFounder += s.needsFounder;
        totals.alerts += s.alerted ? 1 : 0;
      } catch (err) {
        totals.failedOrgs++;
        console.error("[cron] autopilot", ctx.organisation.id, err);
      }
    }
    return NextResponse.json({ status: totals.failedOrgs ? "partial" : "ok", slot, ...totals }, { status: totals.failedOrgs && totals.failedOrgs === totals.orgs ? 500 : 200 });
  }

  const results: { org: string; ok: boolean; standup?: string | null; error?: string }[] = [];
  for (const ctx of contexts) {
    // The 09:00 / 19:00 IST crons also hold the daily stand-up, so it never depends on the 30-minute autopilot
    // (GitHub only runs scheduled workflows from the default branch). Once per day each — the DB enforces it.
    let standup: string | null = null;
    if (activeProvider()) {
      standup = await runDueStandup(ctx).catch((err: Error) => { console.error("[cron] stand-up failed", slot, err.message); return null; });
    }
    try {
      const report = await buildDailyReport(ctx, slot as Slot, { prospect: slot === "morning" });
      await sendEmail({ to: env.REPORT_EMAIL ?? ctx.email, subject: report.subject, text: report.text, html: report.html });
      results.push({ org: ctx.organisation.id, ok: true, standup });
    } catch (err) {
      console.error("[cron]", slot, ctx.organisation.id, err);
      results.push({ org: ctx.organisation.id, ok: false, standup, error: (err as Error).message.slice(0, 200) });
    }
  }
  return NextResponse.json({ status: "ok", slot, results });
}
