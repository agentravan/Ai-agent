import { Badge, Card, Empty, Field, Flash, PageHeader, Select, Stat, Table, Td, type SearchParams } from "@/components/ui";
import { SubmitButton } from "@/components/ui/submit-button";
import { can } from "@/lib/permissions";
import { formatInr, truncate } from "@/lib/utilities/format";
import { requireContext } from "@/modules/auth/session";
import { financeSummary } from "@/modules/cockpit/metrics";
import { createBudgetAction, recordTransactionAction } from "@/modules/finance/actions";
import type { Budget, BusinessUnit, Department, FinancialRecord } from "@/types/domain";

export const metadata = { title: "Finance & Accounts" };

export default async function FinancePage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireContext();
  const [params, { data: records }, { data: budgets }, { data: units }, { data: departments }] = await Promise.all([
    searchParams,
    ctx.db.from("financial_records").select("*").order("occurred_on", { ascending: false }).limit(10000).returns<FinancialRecord[]>(),
    ctx.db.from("budgets").select("*").order("period_start", { ascending: false }).returns<Budget[]>(),
    ctx.db.from("business_units").select("id, name, description, department_id, manager_agent_id").order("name").returns<BusinessUnit[]>(),
    ctx.db.from("departments").select("id, name, description").order("name").returns<Department[]>(),
  ]);
  const R = records ?? [];
  const B = budgets ?? [];
  const f = financeSummary(R, B);
  const unitName = new Map((units ?? []).map((u) => [u.id, u.name]));
  const canGovern = can(ctx.profile.role, "govern");
  const today = new Date().toISOString().slice(0, 10);
  const spent = (b: Budget) => R.filter((r) => r.kind === "expense" && r.budget_id === b.id && r.occurred_on >= b.period_start && r.occurred_on <= b.period_end).reduce((s, r) => s + Number(r.amount_cents), 0);

  return (
    <>
      <PageHeader eyebrow="Governance" title="Finance & Accounts" subtitle="Inbound client payments, outbound expenses, budgets and cash flow. Every entry is audited; nothing moves money automatically." />
      <Flash params={params} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Total inbound" value={formatInr(f.inboundCents)} hint={`30 days: ${formatInr(f.inbound30Cents)}`} />
        <Stat label="Total outbound" value={formatInr(f.outboundCents)} hint={`Burn (30 days): ${formatInr(f.burn30Cents)}`} />
        <Stat label="Net profit" value={formatInr(f.netCents)} hint={`30 days: ${formatInr(f.net30Cents)}`} />
        <Stat label="Budget pool (active)" value={formatInr(f.budgetPoolCents)} hint={`Remaining: ${formatInr(f.budgetRemainingCents)}`} />
      </div>

      {canGovern && (
        <div className="mt-6 grid gap-6 xl:grid-cols-2">
          <Card title="Record a transaction">
            <form action={recordTransactionAction} className="grid gap-3 sm:grid-cols-2">
              <Field label="Type"><Select name="kind" options={[{ value: "income", label: "Inbound payment (client)" }, { value: "expense", label: "Outbound expense" }]} /></Field>
              <Field label="Amount (₹)"><input name="amount_inr" type="number" min="0.01" step="0.01" required className="input" /></Field>
              <Field label="Date"><input name="occurred_on" type="date" required defaultValue={today} className="input" /></Field>
              <Field label="Business unit"><Select name="business_unit_id" options={(units ?? []).map((u) => ({ value: u.id, label: u.name }))} placeholder="Company-wide" /></Field>
              <Field label="Budget (expenses)"><Select name="budget_id" options={B.map((b) => ({ value: b.id, label: b.name }))} placeholder="No budget" /></Field>
              <Field label="Description"><input name="description" maxLength={500} className="input" /></Field>
              <div className="sm:col-span-2"><SubmitButton>Record</SubmitButton></div>
            </form>
          </Card>
          <Card title="Create a budget">
            <form action={createBudgetAction} className="grid gap-3 sm:grid-cols-2">
              <Field label="Name" className="sm:col-span-2"><input name="name" required maxLength={120} className="input" placeholder="e.g. Marketing — November" /></Field>
              <Field label="Amount (₹)"><input name="amount_inr" type="number" min="1" step="1" required className="input" /></Field>
              <Field label="Division"><Select name="department_id" options={(departments ?? []).map((d) => ({ value: d.id, label: d.name }))} placeholder="Company-wide" /></Field>
              <Field label="Start"><input name="period_start" type="date" required defaultValue={today} className="input" /></Field>
              <Field label="End"><input name="period_end" type="date" required className="input" /></Field>
              <div className="sm:col-span-2"><SubmitButton>Create budget</SubmitButton></div>
            </form>
          </Card>
        </div>
      )}

      <Card title="Budgets" className="mt-6">
        {B.length ? (
          <Table head={["Budget", "Period", "Amount", "Spent", "Status"]}>
            {B.map((b) => {
              const s = spent(b);
              const status = s > Number(b.amount_cents) ? "Over budget" : b.period_end < today ? "Closed" : b.period_start > today ? "Upcoming" : "Active";
              return (
                <tr key={b.id}>
                  <Td className="text-zinc-50">{b.name}</Td>
                  <Td className="text-xs text-muted">{b.period_start} → {b.period_end}</Td>
                  <Td>{formatInr(b.amount_cents)}</Td>
                  <Td>{formatInr(s)}</Td>
                  <Td><Badge tone={status === "Over budget" ? "bad" : status === "Active" ? "good" : "neutral"}>{status}</Badge></Td>
                </tr>
              );
            })}
          </Table>
        ) : <Empty>No budgets yet.</Empty>}
      </Card>

      <Card title="Transactions" className="mt-6">
        {R.length ? (
          <Table head={["Date", "Type", "Amount", "Unit", "Description"]}>
            {R.slice(0, 100).map((r) => (
              <tr key={r.id}>
                <Td className="text-xs text-muted">{r.occurred_on}</Td>
                <Td><Badge tone={r.kind === "income" ? "good" : "warn"}>{r.kind === "income" ? "inbound" : "outbound"}</Badge></Td>
                <Td>{formatInr(r.amount_cents)}</Td>
                <Td className="text-xs">{unitName.get(r.business_unit_id ?? "") ?? "Company-wide"}</Td>
                <Td className="text-xs text-muted">{truncate(r.description, 80)}</Td>
              </tr>
            ))}
          </Table>
        ) : <Empty>No transactions recorded yet. Figures on the cockpit stay at ₹0 until you record real payments.</Empty>}
      </Card>
    </>
  );
}
