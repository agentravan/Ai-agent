import { Card, Field, Flash, PageHeader, Select, Table, Td, Badge, type SearchParams } from "@/components/ui";
import { SubmitButton } from "@/components/ui/submit-button";
import { can } from "@/lib/permissions";
import { formatDateTime, formatInr, truncate } from "@/lib/utilities/format";
import { requireContext } from "@/modules/auth/session";
import { listAgents } from "@/modules/orchestration/engine";
import { createOpportunityAction, setOpportunityStatusAction } from "@/modules/opportunities/actions";
import { OPPORTUNITY_STATUSES, type Opportunity } from "@/types/domain";

export const metadata = { title: "Opportunities" };

export default async function OpportunitiesPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireContext();
  const [params, agents, { data }] = await Promise.all([
    searchParams,
    listAgents(ctx),
    ctx.db.from("opportunities").select("*").order("created_at", { ascending: false }).limit(100).returns<Opportunity[]>(),
  ]);
  const canOperate = can(ctx.profile.role, "operate");
  const names = new Map(agents.map((a) => [a.id, a.name]));
  return (
    <>
      <PageHeader eyebrow="Operations" title="Opportunities" subtitle="Business opportunities proposed by your AI executives or by you." />
      <Flash params={params} />
      <Card>
        <Table head={["Opportunity", "Est. value", "Proposed by", "Created", "Status"]}>
          {(data ?? []).map((o) => (
            <tr key={o.id}>
              <Td><div className="text-zinc-50">{o.title}</div><div className="text-xs text-muted">{truncate(o.summary, 140)}</div></Td>
              <Td>{formatInr(o.estimated_value_cents)}</Td>
              <Td>{names.get(o.proposed_by_agent_id ?? "") ?? "Founder"}</Td>
              <Td className="text-xs text-muted">{formatDateTime(o.created_at)}</Td>
              <Td>
                {canOperate ? (
                  <form action={setOpportunityStatusAction} className="flex gap-2">
                    <input type="hidden" name="id" value={o.id} />
                    <Select name="status" options={OPPORTUNITY_STATUSES} defaultValue={o.status} />
                    <button className="btn-ghost px-2.5 py-1 text-xs">Set</button>
                  </form>
                ) : <Badge>{o.status}</Badge>}
              </Td>
            </tr>
          ))}
        </Table>
      </Card>
      {canOperate && (
        <Card title="Record an opportunity" className="mt-6">
          <form action={createOpportunityAction} className="grid gap-3 md:grid-cols-3">
            <Field label="Title" className="md:col-span-2"><input name="title" required maxLength={200} className="input" /></Field>
            <Field label="Estimated value (₹)"><input name="estimated_value_inr" type="number" min={0} className="input" /></Field>
            <Field label="Summary" className="md:col-span-3"><textarea name="summary" rows={3} maxLength={8000} className="input" /></Field>
            <div><SubmitButton>Record</SubmitButton></div>
          </form>
        </Card>
      )}
    </>
  );
}
