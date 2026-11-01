import type { ReactNode } from "react";
import Link from "next/link";
import { Logo } from "@/components/navigation/logo";
import { Nav } from "@/components/navigation/nav";
import { signOutAction } from "@/modules/auth/actions";
import { requireContext } from "@/modules/auth/session";
import { humanize } from "@/lib/utilities/format";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const ctx = await requireContext();
  const { count } = await ctx.db.from("approvals").select("id", { count: "exact", head: true }).eq("status", "pending");
  return (
    <div className="lg:flex">
      <aside className="border-b border-line bg-panel/60 px-4 py-3 lg:sticky lg:top-0 lg:h-dvh lg:w-60 lg:shrink-0 lg:border-r lg:border-b-0 lg:py-5">
        <div className="mb-3 flex items-center justify-between lg:mb-6">
          <Link href="/dashboard"><Logo /></Link>
          <form action={signOutAction} className="lg:hidden"><button className="text-xs text-muted hover:text-white">Sign out</button></form>
        </div>
        <Nav pendingApprovals={count ?? 0} />
        <div className="mt-6 hidden border-t border-line pt-4 text-xs text-muted lg:block">
          <div className="truncate text-slate-300">{ctx.organisation.name}</div>
          <div className="truncate">{ctx.email} · {humanize(ctx.profile.role)}</div>
          <form action={signOutAction} className="mt-3"><button className="hover:text-white">Sign out</button></form>
        </div>
      </aside>
      <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-10 lg:py-8">{children}</main>
    </div>
  );
}
