import Link from "next/link";
import { Crown } from "lucide-react";
import { Autopilot } from "@/components/agents/autopilot";
import { approvalRefs, CommandCard } from "@/components/command/command-card";
import { Badge, Card, Empty, Flash, PageHeader, type SearchParams } from "@/components/ui";
import { SubmitButton } from "@/components/ui/submit-button";
import { aiStatus } from "@/lib/ai/registry";
import { can } from "@/lib/permissions";
import { requireContext } from "@/modules/auth/session";
import { issueCommandAction } from "@/modules/command/actions";
import { listAgents, recoverStaleExecutions } from "@/modules/orchestration/engine";
import { nextReadyTask } from "@/modules/tasks/service";
import type { Execution, Task } from "@/types/domain";

export const metadata = { title: "CEO Office" };
export const maxDuration = 300;

const EXAMPLES = [
  "Find 10 salons in Dallas without a website and prepare a demo website plan for each",
  "Create a free demo website offer for gyms in Toronto and write the pitch",
  "Make a social media starter package I can sell to salons",
];

export default async function CeoPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireContext();
  await recoverStaleExecutions(ctx);
  const org = ctx.organisation.id;
  const [params, ai, agents, { data: commands }, next, { data: recent }] = await Promise.all([
    searchParams,
    aiStatus(),
    listAgents(ctx),
    ctx.db.from("agent_executions").select("*").eq("organisation_id", org).eq("kind", "command").order("created_at", { ascending: false }).limit(5).returns<Execution[]>(),
    nextReadyTask(ctx),
    ctx.db.from("tasks").select("id, title, status, result, assigned_agent_id, updated_at").eq("organisation_id", org).in("status", ["done", "failed"]).order("updated_at", { ascending: false }).limit(6)
      .returns<(Pick<Task, "id" | "title" | "status" | "result" | "assigned_agent_id"> & { updated_at: string })[]>(),
  ]);
  const ceo = agents.find((a) => a.tier === "ceo");
  const name = (id: string | null) => agents.find((a) => a.id === id)?.name ?? "Agent";
  const canOperate = can(ctx.profile.role, "operate");
  const nextInfo = next ? { title: next.title, agent: name(next.assigned_agent_id) } : null;
  const refs = approvalRefs(commands ?? []);
  const { data: decided } = refs.length
    ? await ctx.db.from("approvals").select("id, status").eq("organisation_id", ctx.organisation.id).in("id", refs).returns<{ id: string; status: string }[]>()
    : { data: [] as { id: string; status: string }[] };
  const approvalStatus = Object.fromEntries((decided ?? []).map((a) => [a.id, a.status]));
  const [latest, ...older] = commands ?? [];

  return (
    <>
      <PageHeader eyebrow="Executive Office" title={`${ceo?.name ?? "CEO"} · AI CEO`}
        subtitle="Tell Atlas what you want in your own words. He sets up the project, splits it into tasks and assigns your AI employees. Then press Start work and watch them do it." />
      <Flash params={params} />

      {/* 1. Instruction */}
      <Card title={<span className="flex items-center gap-2"><Crown className="h-4 w-4 text-gold" />1 · Give Atlas an instruction</span>}>
        {canOperate ? (
          <form action={issueCommandAction} className="space-y-3">
            <input type="hidden" name="return_to" value="/ceo" />
            <textarea name="command" required minLength={3} maxLength={2000} rows={4} className="input text-[15px]" disabled={!ai.available}
              placeholder="Hindi, English ya Hinglish — jaise aap kisi manager ko bolte hain." />
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-muted">{ai.available ? "Atlas replies in a few lines and sets up the work automatically. Money or client contact always waits for your approval." : "AI is not connected."}</p>
              {ai.available && <SubmitButton pendingText="Atlas is planning (30–90 sec)…">Send to Atlas</SubmitButton>}
            </div>
          </form>
        ) : <p className="text-sm text-muted">Your role can view but not instruct.</p>}
        <div className="mt-4 flex flex-wrap gap-2">
          {EXAMPLES.map((e) => <span key={e} className="rounded-md border border-line bg-panel-2/40 px-2.5 py-1 text-xs text-zinc-400">e.g. {e}</span>)}
        </div>
      </Card>

      {/* 2. What Atlas did */}
      <h2 className="mt-8 mb-3 text-sm font-semibold text-zinc-200">2 · What Atlas did</h2>
      {latest ? <CommandCard execution={latest} agentName={ceo?.name ?? "CEO"} canOperate={canOperate} returnTo="/ceo" approvalStatus={approvalStatus} /> : <Empty>No instructions yet.</Empty>}

      {/* 3. Team at work */}
      <Card title="3 · Team at work" description="Runs the ready tasks one by one and shows who is doing what" className="mt-8">
        <Autopilot next={nextInfo} aiAvailable={ai.available} />
      </Card>

      {/* 4. Results */}
      <Card title="4 · Latest results" description="The actual work your AI employees produced" className="mt-8" action={<Link href="/projects" className="text-xs font-medium text-zinc-400 hover:text-zinc-100">All tasks →</Link>}>
        {recent?.length ? (
          <ul className="divide-y divide-line">
            {recent.map((t) => (
              <li key={t.id} className="py-3">
                <details>
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-3 [&::-webkit-details-marker]:hidden">
                    <span className="min-w-0 text-sm"><span className="text-zinc-500">{name(t.assigned_agent_id)}:</span> <span className="text-zinc-100">{t.title}</span></span>
                    <span className="flex shrink-0 items-center gap-2"><Badge>{t.status}</Badge><span className="text-xs text-zinc-400">Read ▾</span></span>
                  </summary>
                  <div className="mt-3 max-h-[28rem] overflow-y-auto rounded-lg bg-panel-2/40 p-4 text-sm leading-relaxed whitespace-pre-wrap text-zinc-200">{t.result ?? "No result"}</div>
                </details>
              </li>
            ))}
          </ul>
        ) : <Empty>Results appear here after the team works.</Empty>}
      </Card>

      {older.length > 0 && (
        <details className="mt-8">
          <summary className="cursor-pointer text-sm font-medium text-zinc-400 hover:text-zinc-100">Earlier instructions ({older.length})</summary>
          <div className="mt-3 space-y-4">{older.map((c) => <CommandCard key={c.id} execution={c} agentName={ceo?.name ?? "CEO"} canOperate={canOperate} returnTo="/ceo" approvalStatus={approvalStatus} />)}</div>
        </details>
      )}
    </>
  );
}
