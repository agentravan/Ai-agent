import { AiStatusPanel } from "@/components/dashboard/ai-status";
import { approvalRefs, CommandCard } from "@/components/command/command-card";
import { Card, Empty, Flash, PageHeader, type SearchParams } from "@/components/ui";
import { SubmitButton } from "@/components/ui/submit-button";
import { aiStatus } from "@/lib/ai/registry";
import { can } from "@/lib/permissions";
import { requireContext } from "@/modules/auth/session";
import { issueCommandAction } from "@/modules/command/actions";
import { listAgents, recoverStaleExecutions } from "@/modules/orchestration/engine";
import type { Execution } from "@/types/domain";

export const metadata = { title: "Empire Command" };
export const maxDuration = 300;

export default async function CommandPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireContext();
  await recoverStaleExecutions(ctx);
  const [params, ai, agents, { data: commands }] = await Promise.all([
    searchParams,
    aiStatus(),
    listAgents(ctx),
    ctx.db.from("agent_executions").select("*").eq("kind", "command").order("created_at", { ascending: false }).limit(10).returns<Execution[]>(),
  ]);
  const names = new Map(agents.map((a) => [a.id, a.name]));
  const canOperate = can(ctx.profile.role, "operate");

  const refs = approvalRefs(commands ?? []);
  const { data: decided } = refs.length
    ? await ctx.db.from("approvals").select("id, status").eq("organisation_id", ctx.organisation.id).in("id", refs).returns<{ id: string; status: string }[]>()
    : { data: [] as { id: string; status: string }[] };
  const approvalStatus = Object.fromEntries((decided ?? []).map((a) => [a.id, a.status]));
  return (
    <>
      <PageHeader eyebrow="Overview" title="Empire Command" subtitle="Give an instruction in plain language. The AI CEO drafts a structured plan; you review it; governance decides what runs and what needs approval." />
      <Flash params={params} />
      <div className="grid gap-6 xl:grid-cols-3">
        <Card title="New command" className="xl:col-span-2">
          <form action={issueCommandAction} className="space-y-3">
            <textarea name="command" required minLength={3} maxLength={2000} rows={4} className="input" disabled={!ai.available || !canOperate}
              placeholder="e.g. Launch a free HR compliance checklist to generate leads for our consulting business this month" />
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-muted">{ai.available ? "Atlas plans and sets it up immediately; money or client contact waits for your approval." : "AI execution is unavailable — configure a provider to enable commands."}</p>
              {canOperate && <SubmitButton pendingText="Atlas is planning…">Send</SubmitButton>}
            </div>
          </form>
        </Card>
        <Card title="AI provider"><AiStatusPanel status={ai} /></Card>
      </div>

      <h2 className="mt-8 mb-3 text-sm font-semibold text-zinc-200">Instructions & what was set up</h2>
      {!commands?.length ? <Empty>No commands issued yet.</Empty> : (
        <div className="space-y-4">{commands.map((c) => <CommandCard key={c.id} execution={c} agentName={names.get(c.agent_id ?? "") ?? "CEO"} canOperate={canOperate} returnTo="/command" approvalStatus={approvalStatus} />)}</div>
      )}
    </>
  );
}
