import Link from "next/link";
import { Gavel, Landmark, Play } from "lucide-react";
import { Badge, Card, Empty, Field, Flash, PageHeader, type SearchParams } from "@/components/ui";
import { ListenButton } from "@/components/board/listen-button";
import { SubmitButton } from "@/components/ui/submit-button";
import { aiStatus } from "@/lib/ai/registry";
import { can } from "@/lib/permissions";
import { formatDateTime, formatInr, formatUsdCompact } from "@/lib/utilities/format";
import { requireContext } from "@/modules/auth/session";
import { approveBoardPlanAction, continueMeetingAction, startMeetingAction } from "@/modules/board/actions";
import { CLOSING_SEQ, pickBoard, ROLE_TITLE } from "@/modules/board/logic";
import { companySnapshot, listAgents } from "@/modules/orchestration/engine";
import { planSchema } from "@/modules/orchestration/plan";
import type { BoardMeeting, BoardMessage } from "@/types/domain";

export const metadata = { title: "Board Room" };
export const maxDuration = 300;

const PHASE0_AGENDA = "Phase 0 meeting: ₹0 capital se pehla revenue kaise laayein? Kaunsa offer bechein, kis shehar aur kis type ke business ko, kya price rakhein, aur is hafte ka ek clear target kya ho?";

type PlanExec = { id: string; status: string; plan: unknown };

export default async function BoardPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireContext();
  const org = ctx.organisation.id;
  const params = await searchParams;
  const requested = typeof params.id === "string" ? params.id : null;
  const [ai, agents, company, { data: meetings }] = await Promise.all([
    aiStatus(),
    listAgents(ctx),
    companySnapshot(ctx),
    ctx.db.from("board_meetings").select("*").eq("organisation_id", org).order("created_at", { ascending: false }).limit(20).returns<BoardMeeting[]>(),
  ]);
  const meeting = (requested && meetings?.find((m) => m.id === requested)) || meetings?.[0] || null;
  const [{ data: messages }, { data: planExec }] = await Promise.all([
    meeting ? ctx.db.from("board_messages").select("*").eq("meeting_id", meeting.id).eq("organisation_id", org).order("seq").returns<BoardMessage[]>() : Promise.resolve({ data: [] as BoardMessage[] }),
    meeting?.plan_execution_id ? ctx.db.from("agent_executions").select("id, status, plan").eq("id", meeting.plan_execution_id).eq("organisation_id", org).maybeSingle<PlanExec>() : Promise.resolve({ data: null }),
  ]);
  const board = pickBoard(agents);
  const canOperate = can(ctx.profile.role, "operate");
  const canGovern = can(ctx.profile.role, "govern");
  const raw = planExec?.plan as { applied_at?: string; outcomes?: { title: string; outcome: string }[] } | null;
  const plan = planSchema.safeParse(planExec?.plan);
  const lines = (messages ?? []).filter((m) => m.seq !== CLOSING_SEQ);
  const closing = (messages ?? []).find((m) => m.seq === CLOSING_SEQ);
  const fullText = (messages ?? []).filter((m) => !m.failed).map((m) => `${m.speaker.split(" · ")[0]}: ${m.body}`).join("\n\n");

  return (
    <>
      <PageHeader eyebrow="Executive Office" title="Board Room"
        subtitle={`Meet your C-suite. Set the agenda; the CEO, COO, CFO and Legal Head each speak, then the CEO closes with a plan you approve. Mission: ${formatUsdCompact(company.northStarUsd)} — net profit so far ${formatInr(company.netProfitCents)}.`} />
      <Flash params={params} />

      <div className="mb-6 flex flex-wrap gap-2">
        {board.length ? board.map(({ role, agent }) => (
          <span key={agent.id} className="inline-flex items-center gap-2 rounded-lg border border-line bg-panel/80 px-3 py-1.5 text-sm">
            <span className="text-zinc-50">{agent.name}</span><span className="text-xs text-muted">{ROLE_TITLE[role]}</span>
          </span>
        )) : <p className="text-sm text-amber-300">No active board members. Activate Atlas (CEO) in the Agent Registry.</p>}
        {!board.some((s) => s.role === "legal") && <Link href="/workforce" className="text-xs text-amber-300 underline">Legal Head missing — activate Themis</Link>}
      </div>

      {canOperate && (
        <Card title="Call a board meeting" description="Takes 1–4 minutes depending on your AI provider. Write in Hinglish or English — the board replies the same way.">
          {ai.available ? (
            <form action={startMeetingAction} className="grid gap-3">
              <Field label="Agenda"><textarea name="topic" required minLength={3} maxLength={2000} rows={3} defaultValue={meetings?.length ? "" : PHASE0_AGENDA} className="input" placeholder="What should the board decide today?" /></Field>
              <div><SubmitButton pendingText="Board is meeting… (keep this tab open)"><Landmark className="h-4 w-4" />Start meeting</SubmitButton></div>
            </form>
          ) : <p className="text-sm text-amber-300">AI unavailable — connect an AI provider in Settings to hold board meetings.</p>}
        </Card>
      )}

      {meeting ? (
        <Card className="mt-6" title={meeting.topic.length > 120 ? `${meeting.topic.slice(0, 117)}…` : meeting.topic}
          description={`${formatDateTime(meeting.created_at)} · ${meeting.status === "done" ? "decided" : meeting.status === "failed" ? "stopped" : "in progress"}`}
          action={fullText && <ListenButton text={fullText} label="Play meeting" />}>
          {lines.length ? (
            <ol className="space-y-4">
              {lines.map((m) => (
                <li key={m.id} className="rounded-lg border border-line bg-panel-2/30 p-4">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-zinc-100">{m.speaker}</span>
                    {!m.failed && <ListenButton text={m.body} />}
                  </div>
                  <p className={`mt-2 whitespace-pre-wrap text-sm ${m.failed ? "text-amber-300" : "text-zinc-300"}`}>{m.body}</p>
                </li>
              ))}
            </ol>
          ) : <Empty icon={Landmark}>The board has not spoken yet.</Empty>}

          {meeting.error && <p className="mt-4 text-sm text-amber-300">{meeting.error}</p>}
          {meeting.status !== "done" && canOperate && ai.available && (
            <form action={continueMeetingAction} className="mt-4"><input type="hidden" name="id" value={meeting.id} />
              <SubmitButton pendingText="Continuing…"><Play className="h-4 w-4" />Continue meeting</SubmitButton></form>
          )}

          {closing && (
            <div className="mt-6 rounded-lg border border-gold/30 bg-gold/[0.05] p-4">
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 text-sm font-semibold text-gold"><Gavel className="h-4 w-4" />{closing.speaker}</span>
                <ListenButton text={closing.body} />
              </div>
              <p className="mt-2 whitespace-pre-wrap text-sm text-zinc-200">{closing.body}</p>
              {plan.success && (
                <ul className="mt-3 space-y-1.5 text-sm">
                  {plan.data.steps.map((s, i) => {
                    const outcome = raw?.outcomes?.[i]?.outcome;
                    return (
                      <li key={i} className="flex flex-wrap items-center gap-2">
                        <Badge tone={s.risk === "high" || s.risk === "critical" || s.action === "request_approval" ? "warn" : "neutral"}>{s.action.replace("create_", "")}</Badge>
                        <span className="text-zinc-200">{s.title}</span>
                        {s.assignee && <span className="text-xs text-muted">→ {s.assignee}</span>}
                        {outcome && <Badge>{outcome}</Badge>}
                      </li>
                    );
                  })}
                </ul>
              )}
              {plan.success && !raw?.applied_at && canGovern && (
                <form action={approveBoardPlanAction} className="mt-4"><input type="hidden" name="id" value={meeting.id} />
                  <SubmitButton>Approve plan &amp; create the work</SubmitButton>
                  <span className="ml-3 text-xs text-muted">Risky steps (money, legal, contacting people) still go to Approvals.</span>
                </form>
              )}
              {raw?.applied_at && <p className="mt-3 text-xs text-emerald-300">Approved {formatDateTime(raw.applied_at)} — see <Link href="/projects" className="underline">Projects &amp; Tasks</Link>.</p>}
            </div>
          )}
        </Card>
      ) : (
        <Card className="mt-6"><Empty icon={Landmark}>No meetings yet. Start with the Phase 0 agenda above.</Empty></Card>
      )}

      {(meetings?.length ?? 0) > 1 && (
        <Card title="Past meetings" className="mt-6">
          <ul className="divide-y divide-line">
            {meetings!.map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                <Link href={`/board?id=${m.id}`} className={`truncate hover:text-white ${m.id === meeting?.id ? "text-gold" : "text-zinc-300"}`}>{m.topic}</Link>
                <span className="shrink-0 text-xs text-zinc-500">{formatDateTime(m.created_at)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <p className="mt-6 text-xs text-zinc-500">Listen uses your browser&apos;s built-in voice (free). Natural ElevenLabs voices can be added after the ₹80,000 profit gate.</p>
    </>
  );
}
