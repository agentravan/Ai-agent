"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BadgeCheck, Bot, Briefcase, Crown, Gauge, Lightbulb, type LucideIcon, ScrollText, Settings, Target, Terminal, Wallet, Workflow,
} from "lucide-react";
import { cn } from "@/lib/utilities/format";

type Item = { href: string; label: string; icon: LucideIcon };

export const NAV_GROUPS: { label: string; items: Item[] }[] = [
  { label: "Overview", items: [
    { href: "/dashboard", label: "CEO Cockpit", icon: Gauge },
    { href: "/command", label: "Empire Command", icon: Terminal },
  ] },
  { label: "Executive Office", items: [
    { href: "/ceo", label: "CEO Office", icon: Crown },
    { href: "/coo", label: "COO Office", icon: Workflow },
  ] },
  { label: "Operations", items: [
    { href: "/projects", label: "Projects & Tasks", icon: Briefcase },
    { href: "/workforce", label: "Agent Registry", icon: Bot },
    { href: "/opportunities", label: "Opportunities", icon: Lightbulb },
  ] },
  { label: "Governance", items: [
    { href: "/approvals", label: "Approvals", icon: BadgeCheck },
    { href: "/finance", label: "Finance", icon: Wallet },
    { href: "/kpis", label: "KRAs & KPIs", icon: Target },
    { href: "/audit", label: "Audit Log", icon: ScrollText },
  ] },
  { label: "System", items: [{ href: "/settings", label: "Settings", icon: Settings }] },
];

export function Nav({ pendingApprovals }: { pendingApprovals: number }) {
  const path = usePathname();
  return (
    <nav aria-label="Main" className="space-y-5">
      {NAV_GROUPS.map((g) => (
        <div key={g.label}>
          <p className="mb-1.5 px-2.5 text-[10.5px] font-medium tracking-[0.12em] text-zinc-500 uppercase">{g.label}</p>
          <ul className="space-y-0.5">
            {g.items.map(({ href, label, icon: Icon }) => {
              const active = path === href || path.startsWith(`${href}/`);
              return (
                <li key={href}>
                  <Link
                    href={href}
                    aria-current={active ? "page" : undefined}
                    onClick={(e) => e.currentTarget.closest("details")?.removeAttribute("open")}
                    className={cn(
                      "group relative flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] transition",
                      active ? "bg-white/[0.06] text-zinc-50" : "text-zinc-400 hover:bg-white/[0.03] hover:text-zinc-100",
                    )}
                  >
                    {active && <span className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-gold" aria-hidden />}
                    <Icon className={cn("h-4 w-4 shrink-0", active ? "text-gold" : "text-zinc-500 group-hover:text-zinc-300")} aria-hidden />
                    <span className="flex-1 truncate">{label}</span>
                    {href === "/approvals" && pendingApprovals > 0 && (
                      <span className="num rounded bg-amber-500/15 px-1.5 text-[11px] font-medium text-amber-300">{pendingApprovals}</span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
