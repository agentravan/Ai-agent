import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env, supabaseConfig } from "@/lib/env";

/**
 * Privileged client for scheduled jobs ONLY (bypasses RLS). Never use in user request paths.
 * Every query made with it must filter by organisation_id explicitly.
 */
export function createServiceDb(): SupabaseClient | null {
  const cfg = supabaseConfig();
  if (!cfg || !env.SUPABASE_SERVICE_ROLE_KEY) return null;
  return createClient(cfg.url, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
}
