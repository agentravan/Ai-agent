import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createDb, type Db } from "@/lib/database/server";
import { isEmailAllowed } from "@/lib/env";
import { assertCan, type Capability } from "@/lib/permissions";
import type { Organisation, Profile } from "@/types/domain";

export interface AppContext {
  db: Db;
  userId: string;
  email: string;
  profile: Profile;
  organisation: Organisation;
}

export type ContextState =
  | { state: "unconfigured" }
  | { state: "anonymous" }
  | { state: "forbidden" }
  | { state: "unprovisioned"; email: string }
  | { state: "ready"; ctx: AppContext };

/** Resolves the caller once per request. getUser() validates the JWT with Supabase (not just the cookie). */
export const resolveContext = cache(async (): Promise<ContextState> => {
  const db = await createDb();
  if (!db) return { state: "unconfigured" };
  const { data } = await db.auth.getUser();
  const user = data.user;
  if (!user?.email) return { state: "anonymous" };
  if (!isEmailAllowed(user.email)) return { state: "forbidden" };

  const { data: profile } = await db
    .from("profiles")
    .select("id, organisation_id, email, full_name, role, organisations(id, name, created_at)")
    .eq("id", user.id)
    .maybeSingle<Profile & { organisations: Organisation | null }>();
  if (!profile?.organisations) return { state: "unprovisioned", email: user.email };

  const { organisations, ...rest } = profile;
  return { state: "ready", ctx: { db, userId: user.id, email: user.email, profile: rest, organisation: organisations } };
});

/** For pages and actions: returns a ready context or redirects to the correct entry point. */
export async function requireContext(capability: Capability = "read"): Promise<AppContext> {
  const s = await resolveContext();
  if (s.state !== "ready") redirect(s.state === "anonymous" ? "/login" : `/login?state=${s.state}`);
  assertCan(s.ctx.profile.role, capability);
  return s.ctx;
}
