import Link from "next/link";
import { AiStatusPanel } from "@/components/dashboard/ai-status";
import { Badge, Card, Empty, PageHeader, Stat } from "@/components/ui";
import { aiStatus } from "@/lib/ai/registry";
import { formatDateTime, humanize } from "@/lib/utilities/format";
import { listAudit } from "@/modules/audit/service";
import { requireContext } from "@/modules/auth/session";
import { listAgents } from "@/modules/orchestration/engine";
import type { Approval, Project } from "@/types/domain";

export const metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const ctx = await requireContext();
  const count = (table: string, col?: string, val?: string) => {
    let q = ctx.db.from(table).select("*", { count: "exact", head: true });
    if (col && val) q = q.eq(col, val);
    return q.then((r) => r.count ?? 0);
  };
  const [ai, agents, projects, approvals, activity, openTasks, doneTasks, opps] = await Promise.all([
    aiStatus(),
    listAgents(ctx),
    ctx.db.from("projects").select("*").in("status", ["active", "planned"]).order("created_at", { ascending: false }).limit(6).returns<Project[]>(),
    ctx.db.from("approvals").select("*").eq("status", "pending").order("created_at", { ascending: false }).limit(5).returns<Approval[]>(),
    listAudit(ctx, { limit: 8 }),
    count("tasks", "status", "todo"),
    count("tasks", "status", "done"),
    count("opportunities"),
  ]);
  const activeAgents = agents.filter((a) => a.status === "active").length;

  return (
    <>
      <PageHeader title={`Welcome, ${ctx.profile.full_name ?? "Founder"}`} subtitle={`${ctx.organisation.name} · organisation overview`} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="AI workforce" value={activeAgents} hint={`${agents.length} total agents`} />
        <Stat label="Open tasks" value={openTasks} hint={`${doneTasks} completed`} />
        <Stat label="Pending approvals" value={approvals.data?.length ?? 0} />
        <Stat label="Opportunities" value={opps} />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <Card title="AI connectivity" className="xl:col-span-1"><AiStatusPanel status={ai} /></Card>

        <Card title="Pending approvals" action={<Link href="/approvals" className="text-xs text-gold">View all</Link>} className="xl:col-span-2">
          {approvals.data?.length ? (
            <ul className="divide-y divide-line">
              {approvals.data.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span className="min-w-0 truncate">{a.title}</span>
                  <span className="flex gap-2"><Badge>{a.risk}</Badge><Badge tone="neutral">{a.action_type}</Badge></span>
                </li>
              ))}
            </ul>
          ) : <Empty>No decisions waiting for you.</Empty>}
        </Card>

        <Card title="Active projects" action={<Link href="/projects" className="text-xs text-gold">Manage</Link>} className="xl:col-span-2">
          {projects.data?.length ? (
            <ul className="divide-y divide-line">
              {projects.data.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span className="min-w-0 truncate">{p.name}</span><Badge>{p.status}</Badge>
                </li>
              ))}
            </ul>
          ) : <Empty>No active projects. Issue a command or create one in Projects.</Empty>}
        </Card>

        <Card title="Agent registry" action={<Link href="/workforce" className="text-xs text-gold">Open</Link>}>
          <ul className="space-y-2">
            {agents.slice(0, 8).map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-2 text-sm">
                <span className="min-w-0 truncate"><span className="text-white">{a.name}</span> <span className="text-muted">· {a.designation}</span></span>
                <Badge>{a.status}</Badge>
              </li>
            ))}
          </ul>
        </Card>

        <Card title="Latest activity" action={<Link href="/audit" className="text-xs text-gold">Audit log</Link>} className="xl:col-span-3">
          {activity.length ? (
            <ul className="divide-y divide-line">
              {activity.map((e) => (
                <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                  <span><Badge tone={e.actor_type === "agent" ? "gold" : e.actor_type === "system" ? "neutral" : "info"}>{e.actor_type}</Badge> <span className="ml-1">{humanize(e.action)} · {e.entity}</span></span>
                  <span className="text-xs text-muted">{formatDateTime(e.created_at)}</span>
                </li>
              ))}
            </ul>
          ) : <Empty>No activity yet.</Empty>}
        </Card>
      </div>
    </>
  );
}
