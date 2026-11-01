import { Badge, Card, Field, Flash, PageHeader, Select, Table, Td, type SearchParams } from "@/components/ui";
import { SubmitButton } from "@/components/ui/submit-button";
import { aiStatus } from "@/lib/ai/registry";
import { can } from "@/lib/permissions";
import { truncate } from "@/lib/utilities/format";
import { requireContext } from "@/modules/auth/session";
import { listAgents } from "@/modules/orchestration/engine";
import { createProjectAction, setProjectStatusAction } from "@/modules/projects/actions";
import { createTaskAction, runTaskAction, updateTaskAction } from "@/modules/tasks/actions";
import { nextReadyTask } from "@/modules/tasks/service";
import { Autopilot } from "@/components/agents/autopilot";
import { PRIORITIES, PROJECT_STATUSES, TASK_STATUSES, type BusinessUnit, type Kra, type Project, type Task } from "@/types/domain";

export const metadata = { title: "Projects & Tasks" };
export const maxDuration = 300;

export default async function ProjectsPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireContext();
  const [params, ai, agents, { data: projects }, { data: tasks }, { data: kras }, { data: units }] = await Promise.all([
    searchParams,
    aiStatus(),
    listAgents(ctx),
    ctx.db.from("projects").select("*").order("created_at", { ascending: false }).returns<Project[]>(),
    ctx.db.from("tasks").select("*").order("created_at", { ascending: false }).limit(100).returns<Task[]>(),
    ctx.db.from("kras").select("id, name, description, business_unit_id").order("name").returns<Kra[]>(),
    ctx.db.from("business_units").select("id, name, description, department_id, manager_agent_id").order("name").returns<BusinessUnit[]>(),
  ]);
  const next = await nextReadyTask(ctx);
  const nextInfo = next ? { title: next.title, agent: agents.find((a) => a.id === next.assigned_agent_id)?.name ?? "Agent" } : null;
  const kraOptions = (kras ?? []).map((k) => ({ value: k.id, label: k.name }));
  const kraName = new Map((kras ?? []).map((k) => [k.id, k.name]));
  const unitName = new Map((units ?? []).map((u) => [u.id, u.name]));
  const canOperate = can(ctx.profile.role, "operate");
  const projectName = new Map((projects ?? []).map((p) => [p.id, p.name]));
  const agentOptions = agents.filter((a) => a.status === "active").map((a) => ({ value: a.id, label: a.name }));

  return (
    <>
      <PageHeader eyebrow="Operations" title="Projects & Tasks" subtitle="Track delivery. Run a task to delegate it to its assigned AI agent (dependencies must be done first)." />
      <Flash params={params} />
      <div className="grid gap-6 xl:grid-cols-3">
        <Card title="Projects" className="xl:col-span-2">
          <Table head={["Project", "Unit · KRA", "Owner", "Status"]}>
            {(projects ?? []).map((p) => (
              <tr key={p.id}>
                <Td><div className="text-zinc-50">{p.name}</div><div className="text-xs text-muted">{truncate(p.description, 100)}</div></Td>
                <Td className="text-xs"><div>{unitName.get(p.business_unit_id ?? "") ?? "—"}</div><div className="text-muted">{kraName.get(p.kra_id ?? "") ?? "No KRA"}</div></Td>
                <Td>{agents.find((a) => a.id === p.owner_agent_id)?.name ?? "—"}</Td>
                <Td>
                  {canOperate ? (
                    <form action={setProjectStatusAction} className="flex gap-2">
                      <input type="hidden" name="id" value={p.id} />
                      <Select name="status" options={PROJECT_STATUSES} defaultValue={p.status} />
                      <button className="btn-ghost px-2.5 py-1 text-xs">Set</button>
                    </form>
                  ) : <Badge>{p.status}</Badge>}
                </Td>
              </tr>
            ))}
          </Table>
        </Card>
        {canOperate && (
          <Card title="New project">
            <form action={createProjectAction} className="space-y-3">
              <Field label="Name"><input name="name" required maxLength={120} className="input" /></Field>
              <Field label="Description"><textarea name="description" rows={3} maxLength={4000} className="input" /></Field>
              <Field label="Business unit"><Select name="business_unit_id" options={(units ?? []).map((u) => ({ value: u.id, label: u.name }))} placeholder="Company-wide" /></Field>
              <Field label="KRA (required)"><Select name="kra_id" required options={kraOptions} placeholder="Choose KRA" /></Field>
              <Field label="Owner agent"><Select name="owner_agent_id" options={agentOptions} placeholder="None" /></Field>
              <Field label="Due date"><input name="due_date" type="date" className="input" /></Field>
              <SubmitButton>Create project</SubmitButton>
            </form>
          </Card>
        )}
      </div>

      <Card title="Team at work" description="Runs every ready task in order and shows live progress" className="mt-6">
        <Autopilot next={nextInfo} aiAvailable={ai.available} />
      </Card>

      <Card title="Tasks" className="mt-6">
        <Table head={["Task", "Project · KRA", "Priority", "Assignee & status", ""]}>
          {(tasks ?? []).map((t) => (
            <tr key={t.id}>
              <Td>
                <div className="text-zinc-50">{t.title}</div>
                {t.result && <details className="mt-1 text-xs text-muted"><summary className="cursor-pointer font-medium text-zinc-300 hover:text-white">Result</summary><div className="mt-1 max-h-64 overflow-y-auto whitespace-pre-wrap text-zinc-300">{t.result}</div></details>}
              </Td>
              <Td className="text-xs"><div>{projectName.get(t.project_id ?? "") ?? "—"}</div><div className={t.kra_id ? "text-muted" : "text-amber-300"}>{kraName.get(t.kra_id ?? "") ?? "No KRA"}</div></Td>
              <Td><Badge>{t.priority}</Badge></Td>
              <Td>
                {canOperate ? (
                  <form action={updateTaskAction} className="flex flex-wrap gap-2">
                    <input type="hidden" name="id" value={t.id} />
                    <input type="hidden" name="return_to" value="/projects" />
                    <Select name="assigned_agent_id" options={agentOptions} defaultValue={t.assigned_agent_id} placeholder="Unassigned" />
                    <Select name="status" options={TASK_STATUSES} defaultValue={t.status} />
                    <button className="btn-ghost px-2.5 py-1 text-xs">Save</button>
                  </form>
                ) : <Badge>{t.status}</Badge>}
              </Td>
              <Td>
                {canOperate && t.assigned_agent_id && ["todo", "blocked", "failed"].includes(t.status) && ai.available && (
                  <form action={runTaskAction}>
                    <input type="hidden" name="id" value={t.id} />
                    <input type="hidden" name="return_to" value="/projects" />
                    <SubmitButton variant="ghost" pendingText="Running…">Run</SubmitButton>
                  </form>
                )}
              </Td>
            </tr>
          ))}
        </Table>
      </Card>

      {canOperate && (
        <Card title="New task" className="mt-6">
          <form action={createTaskAction} className="grid gap-3 md:grid-cols-3">
            <input type="hidden" name="return_to" value="/projects" />
            <Field label="Title" className="md:col-span-2"><input name="title" required maxLength={200} className="input" /></Field>
            <Field label="Priority"><Select name="priority" options={PRIORITIES} defaultValue="medium" /></Field>
            <Field label="Description" className="md:col-span-3"><textarea name="description" rows={2} maxLength={8000} className="input" /></Field>
            <Field label="Project"><Select name="project_id" options={(projects ?? []).map((p) => ({ value: p.id, label: p.name }))} placeholder="No project" /></Field>
            <Field label="Assignee"><Select name="assigned_agent_id" options={agentOptions} placeholder="Unassigned" /></Field>
            <Field label="KRA (required)"><Select name="kra_id" required options={kraOptions} placeholder="Choose KRA" /></Field>
            <Field label="Depends on"><Select name="depends_on" options={(tasks ?? []).map((t) => ({ value: t.id, label: truncate(t.title, 60) }))} placeholder="No dependency" /></Field>
            <div className="md:col-span-3"><SubmitButton>Create task</SubmitButton></div>
          </form>
        </Card>
      )}
    </>
  );
}
