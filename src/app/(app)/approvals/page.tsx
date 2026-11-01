import { Badge, Card, Empty, Field, Flash, PageHeader, Table, Td, type SearchParams } from "@/components/ui";
import { SubmitButton } from "@/components/ui/submit-button";
import { can } from "@/lib/permissions";
import { formatDateTime } from "@/lib/utilities/format";
import { decideApprovalAction, requestApprovalAction } from "@/modules/approvals/actions";
import { requireContext } from "@/modules/auth/session";
import { listAgents } from "@/modules/orchestration/engine";
import type { Approval } from "@/types/domain";

export const metadata = { title: "Approval Center" };

export default async function ApprovalsPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireContext();
  const [params, agents, { data: pending }, { data: history }] = await Promise.all([
    searchParams,
    listAgents(ctx),
    ctx.db.from("approvals").select("*").eq("status", "pending").order("created_at", { ascending: true }).returns<Approval[]>(),
    ctx.db.from("approvals").select("*").neq("status", "pending").order("decided_at", { ascending: false }).limit(50).returns<Approval[]>(),
  ]);
  const canGovern = can(ctx.profile.role, "govern");
  const names = new Map(agents.map((a) => [a.id, a.name]));

  return (
    <>
      <PageHeader title="Approval Center" subtitle="Nothing risky happens without you. Approved plan steps execute immediately; other approvals record your decision." />
      <Flash params={params} />
      <h2 className="mb-3 text-sm font-semibold text-slate-200">Pending ({pending?.length ?? 0})</h2>
      {!pending?.length ? <Empty>No pending requests.</Empty> : (
        <div className="space-y-4">
          {pending.map((a) => (
            <Card key={a.id}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-white">{a.title}</span>
                <Badge>{a.risk}</Badge><Badge tone="neutral">{a.action_type}</Badge>
                <span className="ml-auto text-xs text-muted">{names.get(a.requested_by_agent_id ?? "") ?? "Founder team"} · {formatDateTime(a.created_at)}</span>
              </div>
              <details className="mt-2 text-sm">
                <summary className="cursor-pointer text-xs text-gold">Action details</summary>
                <pre className="mt-2 max-h-72 overflow-auto rounded-lg bg-ink/60 p-3 text-xs text-slate-300">{JSON.stringify(a.payload, null, 2)}</pre>
              </details>
              {canGovern && (
                <form action={decideApprovalAction} className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
                  <input type="hidden" name="id" value={a.id} />
                  <input name="note" maxLength={2000} placeholder="Decision note (optional)" className="input sm:flex-1" />
                  <div className="flex gap-2">
                    <SubmitButton name="decision" value="approved">Approve</SubmitButton>
                    <SubmitButton name="decision" value="rejected" variant="danger">Reject</SubmitButton>
                  </div>
                </form>
              )}
            </Card>
          ))}
        </div>
      )}

      <Card title="Approval history" className="mt-8">
        <Table head={["Request", "Type", "Decision", "Note", "Decided"]}>
          {(history ?? []).map((a) => (
            <tr key={a.id}>
              <Td className="text-white">{a.title}</Td>
              <Td className="text-xs">{a.action_type}</Td>
              <Td><Badge>{a.status}</Badge></Td>
              <Td className="text-xs text-muted">{a.decision_note ?? "—"}</Td>
              <Td className="text-xs text-muted">{formatDateTime(a.decided_at)}</Td>
            </tr>
          ))}
        </Table>
      </Card>

      {can(ctx.profile.role, "operate") && (
        <Card title="Raise a manual request" className="mt-6">
          <form action={requestApprovalAction} className="grid gap-3 md:grid-cols-3">
            <Field label="Title" className="md:col-span-2"><input name="title" required maxLength={200} className="input" /></Field>
            <Field label="Action type"><input name="action_type" required pattern="[a-z_]+\.[a-z_]+" placeholder="finance.spend" className="input" /></Field>
            <Field label="Details" className="md:col-span-3"><textarea name="details" rows={2} maxLength={2000} className="input" /></Field>
            <div><SubmitButton variant="ghost">Request approval</SubmitButton></div>
          </form>
        </Card>
      )}
    </>
  );
}
