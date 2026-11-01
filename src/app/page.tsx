import Link from "next/link";
import { redirect } from "next/navigation";
import { Logo } from "@/components/navigation/logo";
import { resolveContext } from "@/modules/auth/session";

const PILLARS = [
  ["AI CEO & COO", "Executive agents with defined role instructions plan strategy and run operations."],
  ["Governed autonomy", "Every agent action passes permission, cost and approval checks before it executes."],
  ["Full audit trail", "Database-enforced, append-only history of every user and agent action."],
  ["₹0 infrastructure", "Runs on free tiers: Vercel, Supabase and local Ollama inference."],
];

export default async function Home() {
  if ((await resolveContext()).state === "ready") redirect("/dashboard");
  return (
    <main className="mx-auto flex min-h-dvh max-w-5xl flex-col px-4 py-8 sm:px-6">
      <header className="flex items-center justify-between">
        <Logo />
        <Link href="/login" className="btn-primary">Founder login</Link>
      </header>
      <section className="flex flex-1 flex-col justify-center py-16">
        <p className="text-sm font-medium tracking-widest text-gold uppercase">Autonomous business operating system</p>
        <h1 className="mt-3 max-w-3xl text-4xl font-semibold tracking-tight text-white sm:text-5xl">
          Run your company with an AI executive team — under your command.
        </h1>
        <p className="mt-4 max-w-2xl text-muted">
          AI Empire OS gives a founder an AI CEO, COO and workforce that plan, delegate and execute work,
          while every risky action waits for your approval.
        </p>
        <div className="mt-10 grid gap-3 sm:grid-cols-2">
          {PILLARS.map(([t, d]) => (
            <div key={t} className="rounded-xl border border-line bg-panel p-4">
              <h2 className="font-medium text-white">{t}</h2>
              <p className="mt-1 text-sm text-muted">{d}</p>
            </div>
          ))}
        </div>
      </section>
      <footer className="text-xs text-muted">Founder: Harshit Bhardwaj · AI Empire OS</footer>
    </main>
  );
}
