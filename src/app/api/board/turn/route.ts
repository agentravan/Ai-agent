import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { AiError, AiUnavailableError } from "@/lib/ai/types";
import { assertCan, PermissionError } from "@/lib/permissions";
import { UserFacingError } from "@/lib/utilities/action";
import { resolveContext } from "@/modules/auth/session";
import { memberTurn } from "@/modules/board/service";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const body = z.object({ meetingId: z.uuid(), agentId: z.uuid(), mode: z.enum(["open", "reply"]) });

/**
 * One member's meeting turn. A route (not a server action) on purpose: the browser runs server actions one
 * after another, so five members took five times as long. Fetch calls run in parallel — everyone thinks at once.
 * Same guards as the action: signed-in Founder session, "operate" capability, RLS, same-origin only.
 */
export async function POST(req: NextRequest) {
  const origin = req.headers.get("origin");
  if (origin && new URL(origin).host !== req.headers.get("host")) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });

  const s = await resolveContext();
  if (s.state !== "ready") return NextResponse.json({ ok: false, error: "Please sign in again" }, { status: 401 });
  try {
    assertCan(s.ctx.profile.role, "operate");
    const input = body.parse(await req.json());
    const message = await memberTurn(s.ctx, input.meetingId, input.agentId, input.mode);
    return NextResponse.json({ ok: true, message }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    const error = err instanceof z.ZodError ? "Invalid request"
      : err instanceof PermissionError || err instanceof UserFacingError || err instanceof AiError || err instanceof AiUnavailableError ? err.message
      : (console.error("[meeting turn]", err), "Something went wrong — please try again.");
    return NextResponse.json({ ok: false, error }, { status: err instanceof PermissionError ? 403 : 200 });
  }
}
