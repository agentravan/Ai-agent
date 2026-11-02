import Link from "next/link";
import { CalendarClock, Landmark, Sunrise, Sunset, Users } from "lucide-react";
import { Badge, Card, Empty, Field, Flash, PageHeader, Select, type SearchParams } from "@/components/ui";
import { SubmitButton } from "@/components/ui/submit-button";
import { aiStatus } from "@/lib/ai/registry";
import { can } from "@/lib/permissions";
import { formatDateTime, formatInr, formatUsdCompact } from "@/lib/utilities/format";
import { requireContext } from "@/modules/auth/session";
import { runStandupNowAction, startMeetingAction } from "@/modules/board/actions";
import { pickBoard } from "@/modules/board/logic";
import { companySnapshot, listAgents } from "@/modules/orchestration/engine";
import type { BoardMeeting, MeetingKind } from "@/types/domain";

export const metadata = { title: "Board Room" };
export const maxDuration = 300;

const PHASE0_AGENDA = "Phase 0 meeting: ₹0 capital se pehla revenue kaise laayein? Kaunsa offer bechein, kis shehar aur kis type ke business ko, kya price rakhein, aur is hafte ka ek clear target kya ho?";
const KIND_LABEL: Record<MeetingKind, string> = { board: "Board meeting", team: "Team meeting", morning: "Morning stand-up", evening: "Evening review" };

export default async function BoardLobby({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireContext();
  const [params, ai, agents, company, { data: meetings }] = await Promise.all([
    searchParams, aiStatus(), listAgents(ctx), companySnapshot(ctx),
    ctx.db.from("board_meetings").select("*").eq("organisation_id", ctx.organisation.id).order("created_at", { ascending: false }).limit(40).returns<BoardMeeting[]>(),
  ]);
  const board = pickBoard(agents);
  const leaders = agents.filter((a) => a.status === "active" && agents.some((r) => r.manager_id === a.id && r.status === "active" && r.name !== "Scribe"));
  const names = new Map(agents.map((a) => [a.id, a.name]));
  const canOperate = can(ctx.profile.role, "operate");
  const live = (meetings ?? []).filter((m) => m.status === "in_progress" && (m.kind === "board" || m.kind === "team"));

  return (
    <>
      <PageHeader eyebrow="Executive Office" title="Board Room"
        subtitle={`Meet your C-suite like a real meeting: they talk, you ask, they argue risk and profit, and Scribe writes the minutes. Mission ${formatUsdCompact(company.northStarUsd)} · net profit so far ${formatInr(company.netProfitCents)}.`} />
      <Flash params={params} />

      {live.length > 0 && (
        <Card className="mb-6" title="Meetings in progress">
          <ul className="flex flex-wrap gap-2">{live.map((m) => <li key={m.id}><Link href={`/board/${m.id}`} className="btn-gold">Rejoin: {m.topic.slice(0, 50)}</Link></li>)}</ul>
        </Card>
      )}

      <div className="grid gap-6 xl:grid-cols-2">
        <Card title="Board meeting" description={`With ${board.map((s) => `${s.agent.name} (${s.title})`).join(", ") || "nobody — activate the CEO"} — and Scribe taking notes`}>
          {canOperate && ai.available ? (
            <form action={startMeetingAction} className="grid gap-3">
              <input type="hidden" name="kind" value="board" />
              <Field label="Agenda"><textarea name="topic" required minLength={3} maxLength={2000} rows={3} defaultValue={meetings?.some((m) => m.kind === "board") ? "" : PHASE0_AGENDA} className="input" placeholder="What should we decide today?" /></Field>
              <div><SubmitButton pendingText="Joining…"><Landmark className="h-4 w-4" />Join meeting</SubmitButton></div>
            </form>
          ) : <p className="text-sm text-amber-300">{ai.available ? "View only." : "AI unavailable — connect an AI provider in Settings."}</p>}
        </Card>

        <Card title="Team meeting" description="A leader with their own team (e.g. Iris with the sales team). You can listen in and ask questions too.">
          {canOperate && ai.available && leaders.length ? (
            <form action={startMeetingAction} className="grid gap-3">
              <input type="hidden" name="kind" value="team" />
              <Field label="Led by"><Select name="host_agent_id" options={leaders.map((a) => ({ value: a.id, label: `${a.name} — ${a.designation}` }))} required /></Field>
              <Field label="Agenda"><input name="topic" required minLength={3} maxLength={2000} className="input" placeholder="Is hafte ka target aur blockers" /></Field>
              <div><SubmitButton pendingText="Joining…"><Users className="h-4 w-4" />Start team meeting</SubmitButton></div>
            </form>
          ) : <p className="text-sm text-muted">No leader with an active team yet.</p>}
        </Card>
      </div>

      <Card className="mt-6" title="Daily stand-ups" description="Held automatically by the autopilot every day — 09:00 IST morning plan and 19:00 IST evening review — with minutes emailed to you.">
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="flex items-center gap-1.5 text-zinc-300"><Sunrise className="h-4 w-4 text-amber-300" />Morning 09:00</span>
          <span className="flex items-center gap-1.5 text-zinc-300"><Sunset className="h-4 w-4 text-orange-400" />Evening 19:00</span>
          {canOperate && ai.available && (
            <>
              <form action={runStandupNowAction}><input type="hidden" name="kind" value="morning" /><SubmitButton variant="ghost" pendingText="Holding stand-up…">Hold morning now</SubmitButton></form>
              <form action={runStandupNowAction}><input type="hidden" name="kind" value="evening" /><SubmitButton variant="ghost" pendingText="Holding review…">Hold evening now</SubmitButton></form>
            </>
          )}
        </div>
      </Card>

      <Card className="mt-6" title="All meetings & minutes">
        {meetings?.length ? (
          <ul className="divide-y divide-line">
            {meetings.map((m) => (
              <li key={m.id} className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <Link href={`/board/${m.id}`} className="block truncate text-sm text-zinc-100 hover:text-white">{m.topic}</Link>
                  <p className="text-xs text-zinc-500">{KIND_LABEL[m.kind]}{m.kind === "team" && m.host_agent_id ? ` · led by ${names.get(m.host_agent_id) ?? "?"}` : ""} · {formatDateTime(m.created_at)}{m.mom ? ` · ${m.mom.action_items.length} action items` : ""}</p>
                </div>
                <div className="flex shrink-0 gap-2">
                  {m.mom_emailed_at && <Badge tone="info">MOM emailed</Badge>}
                  <Badge tone={m.status === "done" ? "good" : m.status === "failed" ? "bad" : "warn"}>{m.status === "done" ? "minutes" : m.status === "failed" ? "stopped" : "live"}</Badge>
                </div>
              </li>
            ))}
          </ul>
        ) : <Empty icon={CalendarClock}>No meetings yet. Join the Phase 0 board meeting above.</Empty>}
      </Card>
    </>
  );
}
