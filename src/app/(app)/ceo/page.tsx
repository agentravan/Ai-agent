import { ExecutionList } from "@/components/agents/execution-list";
import { ExecutiveConsole } from "@/components/agents/executive-console";
import { Badge, Card, Empty, Field, Flash, PageHeader, type SearchParams } from "@/components/ui";
import { SubmitButton } from "@/components/ui/submit-button";
import { aiStatus } from "@/lib/ai/registry";
import { can } from "@/lib/permissions";
import { formatInr, truncate } from "@/lib/utilities/format";
import { requireContext } from "@/modules/auth/session";
import { listAgents, recoverStaleExecutions } from "@/modules/orchestration/engine";
import { createOpportunityAction } from "@/modules/opportunities/actions";
import type { Execution, Opportunity } from "@/types/domain";

export const metadata = { title: "CEO Office" };
export const maxDuration = 300;

export default async function CeoPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireContext();
  await recoverStaleExecutions(ctx);
  const [params, ai, agents] = await Promise.all([searchParams, aiStatus(), listAgents(ctx)]);
  const ceo = agents.find((a) => a.tier === "ceo") ?? null;
  const executiveIds = agents.filter((a) => a.tier === "ceo" || a.tier === "executive").map((a) => a.id);
  const [{ data: opportunities }, { data: reports }] = await Promise.all([
    ctx.db.from("opportunities").select("*").order("created_at", { ascending: false }).limit(8).returns<Opportunity[]>(),
    executiveIds.length
      ? ctx.db.from("agent_executions").select("*").eq("kind", "chat").in("agent_id", executiveIds).order("created_at", { ascending: false }).limit(10).returns<Execution[]>()
      : Promise.resolve({ data: [] as Execution[] }),
  ]);
  const canOperate = can(ctx.profile.role, "operate");

  return (
    <>
      <PageHeader eyebrow="Executive Office" title="AI CEO Office" subtitle="Strategy workspace, opportunity proposals, executive reports and founder communication." />
      <Flash params={params} />
      <ExecutiveConsole agent={ceo} returnTo="/ceo" aiAvailable={ai.available} canOperate={canOperate}
        placeholder="Strategy workspace: e.g. Which three revenue streams should we prioritise this quarter with zero budget?" />

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <Card title="Opportunity proposals" className="xl:col-span-2">
          {opportunities?.length ? (
            <ul className="divide-y divide-line">
              {opportunities.map((o) => (
                <li key={o.id} className="py-2.5 text-sm">
                  <div className="flex items-center justify-between gap-3"><span className="text-zinc-50">{o.title}</span><Badge>{o.status}</Badge></div>
                  <p className="mt-0.5 text-xs text-muted">{truncate(o.summary, 160)} {o.estimated_value_cents != null && `· est. ${formatInr(o.estimated_value_cents)}`}</p>
                </li>
              ))}
            </ul>
          ) : <Empty>No opportunities yet. Issue a command or propose one.</Empty>}
        </Card>
        {canOperate && (
          <Card title="Propose opportunity">
            <form action={createOpportunityAction} className="space-y-3">
              <input type="hidden" name="return_to" value="/ceo" />
              <Field label="Title"><input name="title" required maxLength={200} className="input" /></Field>
              <Field label="Summary"><textarea name="summary" rows={3} maxLength={8000} className="input" /></Field>
              <Field label="Estimated value (₹)"><input name="estimated_value_inr" type="number" min={0} step="1" className="input" /></Field>
              <SubmitButton>Record</SubmitButton>
            </form>
          </Card>
        )}
      </div>

      <h2 className="mt-8 mb-3 text-sm font-semibold text-zinc-200">Executive reports & communication</h2>
      <ExecutionList executions={reports ?? []} agentNames={new Map(agents.map((a) => [a.id, a.name]))} empty="No executive communication yet." />
    </>
  );
}
