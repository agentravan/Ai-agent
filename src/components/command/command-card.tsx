import Link from "next/link";
import { AlertTriangle, CheckCircle2, Clock, XCircle } from "lucide-react";
import { Card } from "@/components/ui";
import { SubmitButton } from "@/components/ui/submit-button";
import { formatDateTime } from "@/lib/utilities/format";
import { executePlanAction } from "@/modules/command/actions";
import type { StepOutcome } from "@/modules/orchestration/apply";
import { planSchema } from "@/modules/orchestration/plan";
import type { Execution } from "@/types/domain";

type StoredPlan = { applied_at?: string; outcomes?: StepOutcome[] };

const instructionOf = (input: string) => (input.split("\n\nAvailable")[0] ?? input).replace(/^Founder (instruction|command): /, "");

/** Plain-language "you asked → Atlas did" card for one instruction. */
/** Approval ids raised by these plans, to look up their current status. */
export function approvalRefs(executions: Execution[]): string[] {
  return executions.flatMap((e) => ((e.plan ?? {}) as StoredPlan).outcomes?.filter((o) => o.outcome === "approval" && o.ref).map((o) => o.ref!) ?? []);
}

export function CommandCard({ execution: c, agentName, canOperate, returnTo, approvalStatus = {} }: {
  execution: Execution; agentName: string; canOperate: boolean; returnTo: "/ceo" | "/command";
  /** Current status of approvals raised by this plan (approval id → status), so decided steps stop showing "waiting". */
  approvalStatus?: Record<string, string>;
}) {
  const plan = planSchema.safeParse(c.plan);
  const stored = (c.plan ?? {}) as StoredPlan;
  return (
    <Card>
      <div className="flex items-center justify-between gap-2 text-xs text-muted">
        <span>You · {formatDateTime(c.created_at)}</span>
        {c.status === "running" && <span className="flex items-center gap-1 text-sky-300"><Clock className="h-3.5 w-3.5" />{agentName} is thinking…</span>}
      </div>
      <p className="mt-1 line-clamp-3 text-sm text-zinc-300">{instructionOf(c.input)}</p>
      {c.error && <p className="mt-3 flex items-start gap-2 text-sm text-rose-300"><XCircle className="mt-0.5 h-4 w-4 shrink-0" />{c.error}</p>}
      {plan.success && (
        <div className="mt-4 border-t border-line pt-4">
          <p className="text-xs font-medium text-gold">{agentName} replied</p>
          <p className="mt-1 text-[15px] leading-relaxed text-zinc-100">{plan.data.summary}</p>
          <p className="mt-4 text-xs font-medium text-zinc-500">What was set up</p>
          <ul className="mt-2 space-y-1.5">
            {plan.data.steps.map((s, i) => {
              const o = stored.outcomes?.[i];
              const decided = o?.outcome === "approval" && o.ref ? approvalStatus[o.ref] : undefined;
              const state = !o ? "pending" : o.outcome === "approval" ? (decided === "approved" ? "executed" : decided === "rejected" ? "denied" : "approval") : o.outcome;
              const Icon = state === "pending" ? Clock : state === "executed" ? CheckCircle2 : state === "approval" ? AlertTriangle : XCircle;
              const tone = state === "pending" ? "text-zinc-500" : state === "executed" ? "text-emerald-400" : state === "approval" ? "text-amber-400" : "text-rose-400";
              const label = s.action === "create_project" ? "Project" : s.action === "create_task" ? "Task" : s.action === "create_opportunity" ? "Opportunity" : "Needs your OK";
              return (
                <li key={i} className="flex items-start gap-2.5 text-sm">
                  <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${tone}`} />
                  <span className="min-w-0">
                    <span className="text-zinc-500">{label}:</span> <span className="text-zinc-200">{s.title}</span>
                    {s.assignee && s.action === "create_task" && <span className="text-zinc-500"> → {s.assignee}</span>}
                    {state === "approval" && <> · <Link href="/approvals" className="text-amber-300 underline underline-offset-2">waiting for your approval</Link></>}
                    {decided === "approved" && <span className="text-emerald-400"> · approved by you</span>}
                    {decided === "rejected" && <span className="text-rose-300"> · rejected by you</span>}
                    {o?.outcome === "denied" && <span className="block text-xs text-rose-300">{o.detail}</span>}
                  </span>
                </li>
              );
            })}
          </ul>
          {!stored.applied_at && canOperate && c.status === "succeeded" && (
            <form action={executePlanAction} className="mt-4">
              <input type="hidden" name="id" value={c.id} />
              <input type="hidden" name="return_to" value={returnTo} />
              <SubmitButton pendingText="Setting up…">Set this up</SubmitButton>
            </form>
          )}
        </div>
      )}
    </Card>
  );
}
