import type { ReactNode } from "react";
import Link from "next/link";
import { LogOut, Menu } from "lucide-react";
import { Logo } from "@/components/navigation/logo";
import { Nav } from "@/components/navigation/nav";
import { humanize } from "@/lib/utilities/format";
import { signOutAction } from "@/modules/auth/actions";
import { requireContext } from "@/modules/auth/session";

export const dynamic = "force-dynamic";

const initials = (s: string) => s.split(/[\s@._-]+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join("");

export default async function AppLayout({ children }: { children: ReactNode }) {
  const ctx = await requireContext();
  const { count } = await ctx.db.from("approvals").select("id", { count: "exact", head: true }).eq("status", "pending");
  const pending = count ?? 0;
  const name = ctx.profile.full_name ?? ctx.email;

  const account = (
    <div className="flex items-center gap-3 rounded-lg border border-line bg-panel-2/40 p-2.5">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-zinc-800 text-xs font-semibold text-zinc-200">{initials(name)}</span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-medium text-zinc-100">{ctx.organisation.name}</div>
        <div className="truncate text-xs text-zinc-500">{humanize(ctx.profile.role)} · {ctx.email}</div>
      </div>
      <form action={signOutAction}>
        <button className="rounded-md p-1.5 text-zinc-500 transition hover:bg-white/5 hover:text-zinc-200" aria-label="Sign out" title="Sign out"><LogOut className="h-4 w-4" /></button>
      </form>
    </div>
  );

  return (
    <div className="lg:flex">
      {/* Desktop sidebar */}
      <aside className="hidden border-r border-line bg-panel/50 backdrop-blur lg:sticky lg:top-0 lg:flex lg:h-dvh lg:w-64 lg:shrink-0 lg:flex-col">
        <div className="flex h-14 items-center border-b border-line px-4"><Link href="/dashboard"><Logo /></Link></div>
        <div className="flex-1 overflow-y-auto px-2.5 py-4"><Nav pendingApprovals={pending} /></div>
        <div className="border-t border-line p-3">{account}</div>
      </aside>

      {/* Mobile top bar + drawer */}
      <details className="group sticky top-0 z-30 border-b border-line bg-ink/90 backdrop-blur lg:hidden">
        <summary className="flex h-14 cursor-pointer list-none items-center justify-between px-4 [&::-webkit-details-marker]:hidden">
          <Logo />
          <span className="flex items-center gap-2 text-zinc-400">
            {pending > 0 && <span className="num rounded bg-amber-500/15 px-1.5 text-[11px] font-medium text-amber-300">{pending}</span>}
            <Menu className="h-5 w-5" aria-label="Menu" />
          </span>
        </summary>
        <div className="max-h-[calc(100dvh-3.5rem)] space-y-4 overflow-y-auto border-t border-line px-3 py-4">
          <Nav pendingApprovals={pending} />
          {account}
        </div>
      </details>

      <main className="min-w-0 flex-1">
        <div className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6 lg:px-10 lg:py-10">{children}</div>
      </main>
    </div>
  );
}
