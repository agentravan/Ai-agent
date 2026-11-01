import { NextResponse } from "next/server";
import { aiStatus } from "@/lib/ai/registry";
import { resolveContext } from "@/modules/auth/session";

export const dynamic = "force-dynamic";

/** Authenticated live AI connectivity check. */
export async function GET() {
  if ((await resolveContext()).state !== "ready") return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json(await aiStatus(), { headers: { "cache-control": "no-store" } });
}
