import { ExecutionList } from "@/components/agents/execution-list";
import { ExecutiveConsole } from "@/components/agents/executive-console";
import { Badge, Card, Field, Flash, PageHeader, Select, Stat, Table, Td, type SearchParams } from "@/components/ui";
import { SubmitButton } from "@/components/ui/submit-button";
import { aiStatus } from "@/lib/ai/registry";
import { can } from "@/lib/permissions";
import { requireContext } from "@/modules/auth/session";
import { listAgents, recoverStaleExecutions } from "@/modules/orchestration/engine";
import { monthStartIso } from "@/modules/orchestration/policy";
import { createTaskAction } from "@/modules/tasks/actions";
import { PRIORITIES, TASK_STATUSES, type Execution, type Kra, type Project, type Task } from "@/types/domain";

export const metadata = { title: "COO Office" };
export const maxDuration = 300;

export default async function CooPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireContext();
  await recoverStaleExecutions(ctx);
  const [params, ai, agents, { data: tasks }, { data: projects }, { data: executions }, { data: kras }] = await Promise.all([
    searchParams,
    aiStatus(),
    listAgents(ctx),
    ctx.db.from("tasks").select("id, status, assigned_agent_id, project_id").limit(5000).returns<Pick<Task, "id" | "status" | "assigned_agent_id" | "project_id">[]>(),
    ctx.db.from("projects").select("*").in("status", ["planned", "active", "on_hold"]).order("created_at", { ascending: false }).returns<Project[]>(),
    ctx.db.from("agent_executions").select("*").gte("created_at", monthStartIso()).order("created_at", { ascending: false }).limit(200).returns<Execution[]>(),
    ctx.db.from("kras").select("id, name, description, business_unit_id").order("name").returns<Kra[]>(),
  ]);
  const coo = agents.find((a) => a.tier === "coo") ?? null;
  const byStatus = Object.fromEntries(TASK_STATUSES.map((s) => [s, (tasks ?? []).filter((t) => t.status === s).length]));
  const canOperate = can(ctx.profile.role, "operate");
  const agentOptions = agents.filter((a) => a.status === "active").map((a) => ({ value: a.id, label: `${a.name} — ${a.designation}` }));

  return (
    <>
      <PageHeader title="AI COO Office" subtitle="Operational overview, task assignment, project tracking and workforce monitoring." />
      <Flash params={params} />
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {TASK_STATUSES.map((s) => <Stat key={s} label={s.replace("_", " ")} value={byStatus[s] ?? 0} />)}
      </div>

      <ExecutiveConsole agent={coo} returnTo="/coo" aiAvailable={ai.available} canOperate={canOperate}
        placeholder="e.g. What is blocking delivery this week, and who should pick up the unassigned tasks?" report="eod" />

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        {canOperate && (
          <Card title="Assign a task">
            <form action={createTaskAction} className="space-y-3">
              <Field label="Title"><input name="title" required maxLength={200} className="input" /></Field>
              <Field label="Description"><textarea name="description" rows={3} maxLength={8000} className="input" /></Field>
              <Field label="Assign to"><Select name="assigned_agent_id" options={agentOptions} placeholder="Unassigned" /></Field>
              <Field label="Project"><Select name="project_id" options={(projects ?? []).map((p) => ({ value: p.id, label: p.name }))} placeholder="No project" /></Field>
              <Field label="KRA (required)"><Select name="kra_id" required options={(kras ?? []).map((k) => ({ value: k.id, label: k.name }))} placeholder="Choose KRA" /></Field>
              <Field label="Priority"><Select name="priority" options={PRIORITIES} defaultValue="medium" /></Field>
              <SubmitButton>Create task</SubmitButton>
            </form>
          </Card>
        )}
        <Card title="Project tracking" className={canOperate ? "xl:col-span-2" : "xl:col-span-3"}>
          <Table head={["Project", "Status", "Progress"]}>
            {(projects ?? []).map((p) => {
              const pt = (tasks ?? []).filter((t) => t.project_id === p.id);
              const done = pt.filter((t) => t.status === "done").length;
              const pct = pt.length ? Math.round((done / pt.length) * 100) : 0;
              return (
                <tr key={p.id}>
                  <Td className="text-white">{p.name}</Td>
                  <Td><Badge>{p.status}</Badge></Td>
                  <Td>
                    <div className="flex items-center gap-2"><div className="h-1.5 w-28 rounded-full bg-line"><div className="h-1.5 rounded-full bg-gold" style={{ width: `${pct}%` }} /></div><span className="text-xs text-muted">{done}/{pt.length}</span></div>
                  </Td>
                </tr>
              );
            })}
          </Table>
        </Card>
      </div>

      <Card title="Workforce monitoring" className="mt-6">
        <Table head={["Agent", "Status", "Open tasks", "Runs this month", "Failures", "Spend (¢)"]}>
          {agents.map((a) => {
            const runs = (executions ?? []).filter((e) => e.agent_id === a.id);
            return (
              <tr key={a.id}>
                <Td><span className="text-white">{a.name}</span> <span className="text-xs text-muted">{a.designation}</span></Td>
                <Td><Badge>{a.status}</Badge></Td>
                <Td>{(tasks ?? []).filter((t) => t.assigned_agent_id === a.id && ["todo", "in_progress", "blocked"].includes(t.status)).length}</Td>
                <Td>{runs.length}</Td>
                <Td>{runs.filter((e) => e.status === "failed").length}</Td>
                <Td>{runs.reduce((s, e) => s + Number(e.cost_cents), 0).toFixed(2)}{a.monthly_cost_limit_cents ? ` / ${a.monthly_cost_limit_cents}` : ""}</Td>
              </tr>
            );
          })}
        </Table>
      </Card>

      <h2 className="mt-8 mb-3 text-sm font-semibold text-slate-200">Recent executions</h2>
      <ExecutionList executions={(executions ?? []).slice(0, 10)} agentNames={new Map(agents.map((a) => [a.id, a.name]))} empty="No agent executions this month." />
    </>
  );
}
