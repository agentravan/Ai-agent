"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utilities/format";

export const NAV = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/command", label: "Empire Command" },
  { href: "/ceo", label: "CEO Office" },
  { href: "/coo", label: "COO Office" },
  { href: "/workforce", label: "Agent Registry" },
  { href: "/projects", label: "Projects & Tasks" },
  { href: "/opportunities", label: "Opportunities" },
  { href: "/approvals", label: "Approvals" },
  { href: "/audit", label: "Audit Log" },
  { href: "/settings", label: "Settings" },
] as const;

export function Nav({ pendingApprovals }: { pendingApprovals: number }) {
  const path = usePathname();
  return (
    <nav aria-label="Main" className="flex gap-1 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible lg:pb-0">
      {NAV.map((item) => {
        const active = path === item.href || path.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex shrink-0 items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm whitespace-nowrap transition",
              active ? "bg-gold/15 text-gold" : "text-slate-300 hover:bg-panel-2 hover:text-white",
            )}
          >
            {item.label}
            {item.href === "/approvals" && pendingApprovals > 0 && (
              <span className="rounded-full bg-amber-500/20 px-1.5 text-[11px] text-amber-300">{pendingApprovals}</span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
