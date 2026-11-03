import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AppContext } from "@/modules/auth/session";
import type { Organisation, Profile } from "@/types/domain";

type Founder = Profile & { organisations: Organisation | null };

/** The one founder organisation this WhatsApp gateway belongs to (machine routes have no user session). */
export async function founderContext(db: SupabaseClient): Promise<AppContext | null> {
  const { data } = await db.from("profiles").select("id, organisation_id, email, full_name, role, organisations(id, name, created_at)")
    .eq("role", "founder").order("created_at").limit(2).returns<Founder[]>();
  if (!data || data.length !== 1 || !data[0]!.organisations) return null;
  const { organisations, ...profile } = data[0]!;
  return { db, userId: profile.id, email: profile.email, profile, organisation: organisations! };
}
