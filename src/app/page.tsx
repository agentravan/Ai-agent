import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, BadgeCheck, Bot, ScrollText, Wallet } from "lucide-react";
import { Logo } from "@/components/navigation/logo";
import { resolveContext } from "@/modules/auth/session";

const PILLARS = [
  { icon: Bot, title: "AI executive team", text: "A CEO, COO and unit managers with defined roles plan, delegate and execute work." },
  { icon: BadgeCheck, title: "Governed autonomy", text: "Permission, cost and approval checks on every action. Critical decisions wait for you." },
  { icon: ScrollText, title: "Complete audit trail", text: "Database-enforced, append-only history of every human and agent action." },
  { icon: Wallet, title: "Zero infrastructure cost", text: "Runs entirely on free tiers — Vercel, Supabase and open models." },
];

export default async function Home() {
  if ((await resolveContext()).state === "ready") redirect("/dashboard");
  return (
    <main className="relative mx-auto flex min-h-dvh max-w-6xl flex-col px-5 sm:px-8">
      <header className="flex h-20 items-center justify-between">
        <Logo />
        <Link href="/login" className="btn-ghost">Sign in</Link>
      </header>
      <section className="flex flex-1 flex-col justify-center py-16">
        <p className="inline-flex w-fit items-center gap-2 rounded-full border border-line bg-panel/70 px-3 py-1 text-xs text-zinc-400">
          <span className="h-1.5 w-1.5 rounded-full bg-gold" /> Private founder workspace
        </p>
        <h1 className="mt-6 max-w-3xl text-4xl leading-[1.1] font-semibold tracking-tight text-zinc-50 sm:text-6xl">
          Run your company with an AI executive office.
        </h1>
        <p className="mt-5 max-w-2xl text-base text-zinc-400 sm:text-lg">
          AI Empire OS gives you a CEO, COO and division managers that plan, delegate and report — while every critical decision stays with you.
        </p>
        <div className="mt-8 flex gap-3">
          <Link href="/login" className="btn-gold h-10 px-5">Open cockpit <ArrowRight className="h-4 w-4" /></Link>
        </div>
        <div className="mt-16 grid gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
          {PILLARS.map(({ icon: Icon, title, text }) => (
            <div key={title} className="bg-panel p-5">
              <Icon className="h-5 w-5 text-gold" aria-hidden />
              <h2 className="mt-4 text-sm font-semibold text-zinc-100">{title}</h2>
              <p className="mt-1.5 text-sm text-zinc-500">{text}</p>
            </div>
          ))}
        </div>
      </section>
      <footer className="flex h-16 items-center justify-between border-t border-line text-xs text-zinc-500">
        <span>© AI Empire OS</span><span>Founder: Harshit Bhardwaj</span>
      </footer>
    </main>
  );
}
