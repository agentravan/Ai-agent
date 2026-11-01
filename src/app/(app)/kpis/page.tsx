import { Card, Empty, Field, Flash, PageHeader, Select, type SearchParams } from "@/components/ui";
import { SubmitButton } from "@/components/ui/submit-button";
import { can } from "@/lib/permissions";
import { requireContext } from "@/modules/auth/session";
import { kpiProgress } from "@/modules/cockpit/metrics";
import { createKpiAction, createKraAction, updateKpiValueAction } from "@/modules/kpis/actions";
import { KPI_PERIODS, type BusinessUnit, type Kpi, type Kra } from "@/types/domain";

export const metadata = { title: "KRAs & KPIs" };

export default async function KpisPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireContext();
  const [params, { data: kras }, { data: kpis }, { data: units }, { data: taskKras }] = await Promise.all([
    searchParams,
    ctx.db.from("kras").select("id, name, description, business_unit_id").order("name").returns<Kra[]>(),
    ctx.db.from("kpis").select("*").order("name").returns<Kpi[]>(),
    ctx.db.from("business_units").select("id, name, description, department_id, manager_agent_id").order("name").returns<BusinessUnit[]>(),
    ctx.db.from("tasks").select("kra_id, status").not("kra_id", "is", null).returns<{ kra_id: string; status: string }[]>(),
  ]);
  const canOperate = can(ctx.profile.role, "operate");
  const canGovern = can(ctx.profile.role, "govern");
  const groups = [...(units ?? []).map((u) => ({ id: u.id as string | null, name: u.name })), { id: null, name: "Company-wide (Executive & Finance)" }];

  return (
    <>
      <PageHeader title="KRAs & KPIs" subtitle="Every task and project is tied to a Key Result Area. Set measurable KPI targets per KRA — targets are your decision, never invented by AI." />
      <Flash params={params} />
      <div className="space-y-6">
        {groups.map((g) => {
          const groupKras = (kras ?? []).filter((k) => k.business_unit_id === g.id);
          if (!groupKras.length) return null;
          return (
            <Card key={g.id ?? "company"} title={g.name}>
              <div className="grid gap-4 lg:grid-cols-2">
                {groupKras.map((k) => {
                  const kk = (kpis ?? []).filter((x) => x.kra_id === k.id);
                  const t = (taskKras ?? []).filter((x) => x.kra_id === k.id);
                  return (
                    <div key={k.id} className="rounded-lg border border-line bg-ink/40 p-3">
                      <div className="flex items-baseline justify-between gap-2">
                        <h3 className="font-medium text-white">{k.name}</h3>
                        <span className="text-xs text-muted">{t.filter((x) => x.status === "done").length}/{t.length} tasks done</span>
                      </div>
                      {k.description && <p className="text-xs text-muted">{k.description}</p>}
                      {kk.length ? (
                        <ul className="mt-3 space-y-3">
                          {kk.map((kpi) => {
                            const pct = kpiProgress(kpi);
                            return (
                              <li key={kpi.id} className="text-sm">
                                <div className="flex justify-between gap-2"><span>{kpi.name} <span className="text-xs text-muted">({kpi.period})</span></span><span className="text-xs text-muted">{Number(kpi.current_value)}/{Number(kpi.target)} {kpi.unit}</span></div>
                                <div className="mt-1 h-1.5 rounded-full bg-line"><div className={`h-1.5 rounded-full ${pct >= 100 ? "bg-emerald-400" : pct < 50 ? "bg-amber-400" : "bg-gold"}`} style={{ width: `${pct}%` }} /></div>
                                {canOperate && (
                                  <form action={updateKpiValueAction} className="mt-2 flex gap-2">
                                    <input type="hidden" name="id" value={kpi.id} />
                                    <input name="current_value" type="number" min="0" step="any" defaultValue={Number(kpi.current_value)} className="input max-w-32 py-1" aria-label={`Current value for ${kpi.name}`} />
                                    <button className="btn-ghost px-2.5 py-1 text-xs">Update</button>
                                  </form>
                                )}
                              </li>
                            );
                          })}
                        </ul>
                      ) : <p className="mt-2 text-xs text-amber-300">No KPI set — add a measurable target below.</p>}
                    </div>
                  );
                })}
              </div>
            </Card>
          );
        })}
        {!kras?.length && <Empty>No KRAs yet.</Empty>}
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        {canOperate && (
          <Card title="Add a KPI">
            <form action={createKpiAction} className="grid gap-3 sm:grid-cols-2">
              <Field label="KRA" className="sm:col-span-2"><Select name="kra_id" required options={(kras ?? []).map((k) => ({ value: k.id, label: k.name }))} placeholder="Choose KRA" /></Field>
              <Field label="KPI name" className="sm:col-span-2"><input name="name" required maxLength={120} className="input" placeholder="e.g. New salon clients signed" /></Field>
              <Field label="Target"><input name="target" type="number" min="0.01" step="any" required className="input" /></Field>
              <Field label="Unit"><input name="unit" maxLength={20} className="input" placeholder="clients, ₹, %" /></Field>
              <Field label="Current value"><input name="current_value" type="number" min="0" step="any" defaultValue={0} className="input" /></Field>
              <Field label="Period"><Select name="period" options={KPI_PERIODS} defaultValue="monthly" /></Field>
              <div className="sm:col-span-2"><SubmitButton>Add KPI</SubmitButton></div>
            </form>
          </Card>
        )}
        {canGovern && (
          <Card title="Add a KRA">
            <form action={createKraAction} className="grid gap-3">
              <Field label="Name"><input name="name" required maxLength={120} className="input" /></Field>
              <Field label="Business unit"><Select name="business_unit_id" options={(units ?? []).map((u) => ({ value: u.id, label: u.name }))} placeholder="Company-wide" /></Field>
              <Field label="Description"><textarea name="description" rows={2} maxLength={2000} className="input" /></Field>
              <div><SubmitButton>Add KRA</SubmitButton></div>
            </form>
          </Card>
        )}
      </div>
    </>
  );
}
