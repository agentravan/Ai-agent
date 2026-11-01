import { NextResponse, type NextRequest } from "next/server";
import { createDb } from "@/lib/database/server";

/** Email-confirmation / magic-link landing: exchanges the one-time code for a session cookie. */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const db = await createDb();
  if (code && db) {
    const { error } = await db.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL("/dashboard", url.origin));
  }
  return NextResponse.redirect(new URL("/login?error=Confirmation%20link%20invalid%20or%20expired", url.origin));
}
