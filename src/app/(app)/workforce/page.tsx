import Link from "next/link";
import { Badge, Card, Field, Flash, PageHeader, Select, Table, Td, type SearchParams } from "@/components/ui";
import { SubmitButton } from "@/components/ui/submit-button";
import { AGENT_PERMISSIONS, AGENT_PERMISSION_KEYS, can } from "@/lib/permissions";
import { saveAgentAction, setAgentStatusAction } from "@/modules/agents/actions";
import { requireContext } from "@/modules/auth/session";
import { listAgents } from "@/modules/orchestration/engine";
import { AGENT_TIERS, TIER_LABEL, type BusinessUnit, type Department } from "@/types/domain";

export const metadata = { title: "Agent Registry" };

export default async function WorkforcePage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireContext();
  const [params, agents, { data: departments }, { data: units }] = await Promise.all([
    searchParams,
    listAgents(ctx),
    ctx.db.from("departments").select("id, name, description").order("name").returns<Department[]>(),
    ctx.db.from("business_units").select("id, name, description, department_id, manager_agent_id").order("name").returns<BusinessUnit[]>(),
  ]);
  const unitName = new Map((units ?? []).map((u) => [u.id, u.name]));
  const canGovern = can(ctx.profile.role, "govern");
  const editing = typeof params.edit === "string" ? agents.find((a) => a.id === params.edit) : undefined;
  const depts = new Map((departments ?? []).map((d) => [d.id, d.name]));
  const names = new Map(agents.map((a) => [a.id, a.name]));
  const granted = new Set(editing ? editing.agent_permissions.map((p) => p.permission) : ["ai.execute", "tasks.create", "approvals.request"]);

  return (
    <>
      <PageHeader title="Agent Registry" subtitle="Your AI workforce: designations, instructions, departments, reporting lines, permissions and status." />
      <Flash params={params} />
      <Card>
        <Table head={["Agent", "Tier", "Division · Unit", "Reports to", "Permissions", "Status", ""]}>
          {agents.map((a) => (
            <tr key={a.id}>
              <Td><div className="text-white">{a.name}</div><div className="text-xs text-muted">{a.designation}</div></Td>
              <Td><Badge tone={a.tier === "ceo" || a.tier === "coo" ? "gold" : a.tier === "executive" ? "info" : "neutral"}>{TIER_LABEL[a.tier]}</Badge></Td>
              <Td className="text-xs"><div>{depts.get(a.department_id ?? "") ?? "—"}</div><div className="text-muted">{unitName.get(a.business_unit_id ?? "") ?? ""}</div></Td>
              <Td>{names.get(a.manager_id ?? "") ?? "Founder"}</Td>
              <Td className="text-xs text-muted">{a.agent_permissions.length}</Td>
              <Td><Badge>{a.status}</Badge></Td>
              <Td>
                {canGovern && (
                  <div className="flex justify-end gap-2">
                    <Link href={`/workforce?edit=${a.id}#editor`} className="btn-ghost px-2.5 py-1 text-xs">Edit</Link>
                    <form action={setAgentStatusAction}>
                      <input type="hidden" name="id" value={a.id} />
                      <input type="hidden" name="status" value={a.status === "active" ? "suspended" : "active"} />
                      <button className={`${a.status === "active" ? "btn-danger" : "btn-ghost"} px-2.5 py-1 text-xs`}>{a.status === "active" ? "Suspend" : "Activate"}</button>
                    </form>
                  </div>
                )}
              </Td>
            </tr>
          ))}
        </Table>
      </Card>

      {canGovern && (
        <Card title={editing ? `Edit ${editing.name}` : "Hire a new AI employee"} className="mt-6" action={editing && <Link href="/workforce" className="text-xs text-gold">New agent instead</Link>}>
          <form id="editor" key={editing?.id ?? "new"} action={saveAgentAction} className="grid gap-4 md:grid-cols-2">
            {editing && <input type="hidden" name="id" value={editing.id} />}
            <Field label="Name"><input name="name" required maxLength={80} defaultValue={editing?.name} className="input" /></Field>
            <Field label="Designation"><input name="designation" required maxLength={120} defaultValue={editing?.designation} className="input" placeholder="e.g. Head of Content" /></Field>
            <Field label="Tier"><Select name="tier" options={AGENT_TIERS.map((t) => ({ value: t, label: TIER_LABEL[t] }))} defaultValue={editing?.tier ?? "worker"} /></Field>
            <Field label="Department"><Select name="department_id" options={(departments ?? []).map((d) => ({ value: d.id, label: d.name }))} defaultValue={editing?.department_id} placeholder="None" /></Field>
            <Field label="Business unit"><Select name="business_unit_id" options={(units ?? []).map((u) => ({ value: u.id, label: u.name }))} defaultValue={editing?.business_unit_id} placeholder="None (division level)" /></Field>
            <Field label="Reporting manager"><Select name="manager_id" options={agents.filter((a) => a.id !== editing?.id).map((a) => ({ value: a.id, label: `${a.name} — ${a.designation}` }))} defaultValue={editing?.manager_id} placeholder="Founder (direct)" /></Field>
            <Field label="Monthly AI cost limit (US cents, 0 = free providers only)"><input name="monthly_cost_limit_cents" type="number" min={0} step={1} defaultValue={editing?.monthly_cost_limit_cents ?? 0} className="input" /></Field>
            <Field label="Role instructions" className="md:col-span-2">
              <textarea name="instructions" rows={5} maxLength={8000} defaultValue={editing?.instructions} className="input" placeholder="Describe responsibilities, decision rights, tone and escalation rules." />
            </Field>
            <fieldset className="md:col-span-2">
              <legend className="label">Permissions</legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {AGENT_PERMISSION_KEYS.map((p) => (
                  <label key={p} className="flex items-start gap-2 rounded-lg border border-line p-2.5 text-sm">
                    <input type="checkbox" name="permissions" value={p} defaultChecked={granted.has(p)} className="mt-0.5 accent-[#e8b64c]" />
                    <span><span className="text-white">{p}</span><span className="block text-xs text-muted">{AGENT_PERMISSIONS[p]}</span></span>
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="md:col-span-2"><SubmitButton>{editing ? "Save changes" : "Hire agent"}</SubmitButton></div>
          </form>
        </Card>
      )}
    </>
  );
}
