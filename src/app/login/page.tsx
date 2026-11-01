import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Logo } from "@/components/navigation/logo";
import { Field, Flash, type SearchParams } from "@/components/ui";
import { SubmitButton } from "@/components/ui/submit-button";
import { signInAction, signOutAction, signUpAction } from "@/modules/auth/actions";
import { resolveContext } from "@/modules/auth/session";

export const metadata: Metadata = { title: "Founder login" };

const NOTICES: Record<string, string> = {
  unconfigured: "Database & authentication are pending configuration: set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY (see docs/DEPLOYMENT_GUIDE.md).",
  forbidden: "This account is not on the founder allowlist for this workspace.",
  unprovisioned: "Your account exists but no organisation is provisioned. Apply the database migrations, then sign up again.",
};

export default async function LoginPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const s = await resolveContext();
  if (s.state === "ready") redirect("/dashboard");
  const notice = NOTICES[s.state];
  const next = typeof params.next === "string" ? params.next : "";

  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-[380px]">
        <div className="mb-8 flex justify-center"><Logo /></div>
        <div className="rounded-xl border border-line bg-panel/80 p-6 shadow-2xl shadow-black/40 sm:p-7">
          <h1 className="text-xl font-semibold text-zinc-50">Welcome back</h1>
          <p className="mt-1 mb-6 text-sm text-muted">Sign in to your executive cockpit.</p>
          <Flash params={params} />
          {notice && <p className="mb-5 rounded-lg border border-amber-500/30 bg-amber-500/[0.06] px-3 py-2 text-sm text-amber-200">{notice}</p>}
          {s.state === "unconfigured" ? null : s.state === "forbidden" || s.state === "unprovisioned" ? (
            <form action={signOutAction}><SubmitButton variant="ghost">Sign out</SubmitButton></form>
          ) : (
            <form className="space-y-4">
              <input type="hidden" name="next" value={next} />
              <Field label="Email"><input className="input" type="email" name="email" autoComplete="email" required /></Field>
              <Field label="Password"><input className="input" type="password" name="password" autoComplete="current-password" minLength={8} required /></Field>
              <div className="flex flex-col gap-2 pt-1">
                <button formAction={signInAction} className="btn-primary h-10">Sign in</button>
                <button formAction={signUpAction} className="btn h-10 text-zinc-400 hover:text-zinc-100">Create founder account</button>
              </div>
            </form>
          )}
        </div>
        <p className="mt-6 text-center text-xs text-zinc-600">Private workspace · Protected by row-level security</p>
      </div>
    </main>
  );
}
