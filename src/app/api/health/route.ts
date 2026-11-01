import { NextResponse } from "next/server";
import { activeProvider } from "@/lib/ai/registry";
import { supabaseConfig } from "@/lib/env";

export const dynamic = "force-dynamic";

/** Public liveness + configuration probe. Reports booleans only — never values or secrets. */
export async function GET() {
  const cfg = supabaseConfig();
  let database: "pending" | "ok" | "unreachable" = "pending";
  if (cfg) {
    try {
      const res = await fetch(`${cfg.url}/auth/v1/health`, { headers: { apikey: cfg.key }, signal: AbortSignal.timeout(3_000), cache: "no-store" });
      database = res.ok ? "ok" : "unreachable";
    } catch {
      database = "unreachable";
    }
  }
  const provider = activeProvider();
  return NextResponse.json(
    { status: "ok", service: "ai-empire-os", database, ai: provider ? { configured: true, provider: provider.id } : { configured: false }, time: new Date().toISOString() },
    { headers: { "cache-control": "no-store" } },
  );
}
