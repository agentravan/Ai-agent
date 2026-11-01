import { AiStatusPanel } from "@/components/dashboard/ai-status";
import { Badge, Card, Empty, Flash, PageHeader, type SearchParams } from "@/components/ui";
import { SubmitButton } from "@/components/ui/submit-button";
import { aiStatus } from "@/lib/ai/registry";
import { can } from "@/lib/permissions";
import { formatDateTime } from "@/lib/utilities/format";
import { requireContext } from "@/modules/auth/session";
import { executePlanAction, issueCommandAction } from "@/modules/command/actions";
import type { StepOutcome } from "@/modules/orchestration/apply";
import { listAgents, recoverStaleExecutions } from "@/modules/orchestration/engine";
import { planSchema } from "@/modules/orchestration/plan";
import type { Execution } from "@/types/domain";

export const metadata = { title: "Empire Command" };
export const maxDuration = 300;

type StoredPlan = { applied_at?: string; outcomes?: StepOutcome[] };

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

  return (
    <>
      <PageHeader title="Empire Command" subtitle="Give an instruction in plain language. The AI CEO drafts a structured plan; you review it; governance decides what runs and what needs approval." />
      <Flash params={params} />
      <div className="grid gap-6 xl:grid-cols-3">
        <Card title="New command" className="xl:col-span-2">
          <form action={issueCommandAction} className="space-y-3">
            <textarea name="command" required minLength={3} maxLength={2000} rows={4} className="input" disabled={!ai.available || !canOperate}
              placeholder="e.g. Launch a free HR compliance checklist to generate leads for our consulting business this month" />
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-muted">{ai.available ? "Plans are validated against a strict schema before anything executes." : "AI execution is unavailable — configure a provider to enable commands."}</p>
              {canOperate && <SubmitButton pendingText="CEO is planning…">Generate plan</SubmitButton>}
            </div>
          </form>
        </Card>
        <Card title="AI provider"><AiStatusPanel status={ai} /></Card>
      </div>

      <h2 className="mt-8 mb-3 text-sm font-semibold text-slate-200">Execution tracking</h2>
      {!commands?.length ? <Empty>No commands issued yet.</Empty> : (
        <div className="space-y-4">
          {commands.map((c) => {
            const plan = planSchema.safeParse(c.plan);
            const stored = (c.plan ?? {}) as StoredPlan;
            return (
              <Card key={c.id}>
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                  <Badge>{c.status}</Badge>
                  {stored.applied_at && <Badge tone="good">executed</Badge>}
                  <span>{names.get(c.agent_id ?? "") ?? "CEO"} · attempt {c.attempts}/{c.max_attempts} · {c.provider ?? "—"}</span>
                  <span className="ml-auto">{formatDateTime(c.created_at)}</span>
                </div>
                <p className="mt-2 text-sm text-slate-200">{c.input.split("\n")[0]?.replace("Founder command: ", "")}</p>
                {c.error && <p className="mt-2 text-sm text-rose-300">{c.error}</p>}
                {plan.success && (
                  <div className="mt-3 border-t border-line pt-3">
                    <p className="text-sm text-slate-300">{plan.data.summary}</p>
                    <ol className="mt-3 space-y-2">
                      {plan.data.steps.map((s, i) => {
                        const o = stored.outcomes?.[i];
                        return (
                          <li key={i} className="flex flex-col gap-1 rounded-lg bg-ink/40 p-2.5 text-sm sm:flex-row sm:items-center sm:justify-between">
                            <span><span className="text-muted">{i + 1}.</span> {s.title} <span className="text-xs text-muted">({s.action.replace("_", " ")}{s.assignee ? ` → ${s.assignee}` : ""})</span></span>
                            <span className="flex flex-wrap gap-1.5"><Badge>{s.risk}</Badge>{o && <Badge>{o.outcome}</Badge>}</span>
                          </li>
                        );
                      })}
                    </ol>
                    {stored.outcomes?.some((o) => o.outcome !== "executed") && (
                      <ul className="mt-2 text-xs text-muted">{stored.outcomes.filter((o) => o.outcome !== "executed").map((o, i) => <li key={i}>• {o.title}: {o.detail}</li>)}</ul>
                    )}
                    {!stored.applied_at && canOperate && (
                      <form action={executePlanAction} className="mt-3">
                        <input type="hidden" name="id" value={c.id} />
                        <SubmitButton pendingText="Executing…">Execute plan</SubmitButton>
                      </form>
                    )}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
