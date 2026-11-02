import Link from "next/link";
import { notFound } from "next/navigation";
import { CheckCircle2, ListChecks, Mail } from "lucide-react";
import { Badge, Card, Flash, type SearchParams } from "@/components/ui";
import { MeetingRoom, type RoomSeat } from "@/components/board/meeting-room";
import { SubmitButton } from "@/components/ui/submit-button";
import { emailConfigured } from "@/lib/integrations/email";
import { can } from "@/lib/permissions";
import { formatDateTime } from "@/lib/utilities/format";
import { requireContext } from "@/modules/auth/session";
import { approveMomAction, emailMomAction } from "@/modules/board/actions";
import { seatsFor } from "@/modules/board/service";
import { listAgents } from "@/modules/orchestration/engine";
import type { BoardMeeting, BoardMessage } from "@/types/domain";

export const metadata = { title: "Meeting" };

/** Who speaks with a woman's voice (by name); everyone else with a man's. */
const FEMALE_NAMES = /^(themis|iris|hera|vega|nova|scribe|athena|maya|kavya|priya|ananya|sara|aisha)$/i;
const voiceGender = (name: string): "male" | "female" => (FEMALE_NAMES.test(name) ? "female" : "male");
export const maxDuration = 300;

function List({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <div>
      <p className="text-xs font-semibold tracking-wide text-zinc-400 uppercase">{title}</p>
      <ul className="mt-1.5 space-y-1 text-sm text-zinc-200">{items.map((x, i) => <li key={i} className="flex gap-2"><span className="text-zinc-500">•</span>{x}</li>)}</ul>
    </div>
  );
}

export default async function MeetingPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  const ctx = await requireContext();
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [{ data: meeting }, { data: messages }, agents] = await Promise.all([
    ctx.db.from("board_meetings").select("*").eq("id", id).eq("organisation_id", ctx.organisation.id).maybeSingle<BoardMeeting>(),
    ctx.db.from("board_messages").select("*").eq("meeting_id", id).eq("organisation_id", ctx.organisation.id).order("seq").returns<BoardMessage[]>(),
    listAgents(ctx),
  ]);
  if (!meeting) notFound();
  const { data: planExec } = meeting.plan_execution_id
    ? await ctx.db.from("agent_executions").select("plan").eq("id", meeting.plan_execution_id).eq("organisation_id", ctx.organisation.id).maybeSingle<{ plan: { applied_at?: string } | null }>()
    : { data: null };

  // Seats are the people invited when the meeting started (stand-ups: the C-suite).
  const invited = new Set(meeting.participant_ids);
  const seats: RoomSeat[] = seatsFor(meeting, agents)
    .filter((s) => !invited.size || invited.has(s.agent.id))
    .map((s) => ({ agentId: s.agent.id, name: s.agent.name, title: s.title, color: s.color, voice: s.voice, gender: voiceGender(s.agent.name) }));
  const scribe = agents.find((a) => a.name === "Scribe" && a.status === "active");
  const founder = ctx.profile.full_name?.split(" ")[0] || "You";
  const mom = meeting.mom;
  const applied = !!planExec?.plan?.applied_at;

  return (
    <>
      <div className="mb-4 flex items-center justify-between gap-3">
        <Link href="/board" className="text-sm text-zinc-400 hover:text-zinc-100">← Board Room</Link>
        <span className="text-xs text-zinc-500">{formatDateTime(meeting.created_at)}</span>
      </div>
      <Flash params={sp} />
      {meeting.error && <p className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/[0.06] px-4 py-2 text-sm text-amber-200">{meeting.error}</p>}

      <MeetingRoom meetingId={meeting.id} topic={meeting.topic} seats={seats} founder={founder} scribeName={scribe?.name ?? null}
        initial={messages ?? []} live={meeting.status === "in_progress"} canSpeak={can(ctx.profile.role, "operate")} />

      {mom && (
        <Card className="mt-6" title="Minutes of meeting (MOM)" description={`Written by ${scribe?.name ?? "the secretary"}${meeting.ended_at ? ` · ${formatDateTime(meeting.ended_at)}` : ""}`}
          action={meeting.mom_emailed_at ? <Badge tone="info">emailed to you</Badge> : undefined}>
          <p className="text-[15px] leading-relaxed text-zinc-100">{mom.summary}</p>
          <div className="mt-5 grid gap-5 md:grid-cols-2">
            <div>
              <List title="Decisions" items={mom.decisions} />
              {mom.decisions.length > 0 && (
                <ul className="mt-2 flex flex-wrap gap-2">
                  {mom.decisions.slice(0, 4).map((d, i) => (
                    <li key={i}><Link href={`/court?idea=${encodeURIComponent(d)}&meeting=${meeting.id}`} className="btn-ghost px-2.5 py-1 text-xs">⚖ Put decision {i + 1} on trial</Link></li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              {mom.action_items.length > 0 && <p className="text-xs font-semibold tracking-wide text-zinc-400 uppercase">Action items</p>}
              <ul className="mt-1.5 space-y-1.5 text-sm">
                {mom.action_items.map((a, i) => (
                  <li key={i} className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-gold">{a.owner}</span><span className="text-zinc-200">{a.task}</span>
                    {a.due && <span className="text-xs text-zinc-500">· {a.due}</span>}
                    {a.needs_approval && <Badge tone="warn">needs approval</Badge>}
                  </li>
                ))}
              </ul>
            </div>
            <List title="Risks" items={mom.risks} />
            <List title="Opportunities" items={mom.opportunities} />
            <List title="Follow up next meeting" items={mom.follow_ups} />
            <List title="Next agenda" items={mom.next_agenda} />
          </div>
          <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-line pt-4">
            {meeting.plan_execution_id && !applied && can(ctx.profile.role, "govern") && (
              <form action={approveMomAction}><input type="hidden" name="id" value={meeting.id} /><SubmitButton><ListChecks className="h-4 w-4" />Approve action items → create tasks</SubmitButton></form>
            )}
            {applied && <span className="flex items-center gap-1.5 text-sm text-emerald-300"><CheckCircle2 className="h-4 w-4" />Tasks created — see <Link href="/projects" className="underline">Projects</Link> and <Link href="/desk" className="underline">My Desk</Link></span>}
            {emailConfigured() && <form action={emailMomAction}><input type="hidden" name="id" value={meeting.id} /><SubmitButton variant="ghost"><Mail className="h-4 w-4" />Email MOM</SubmitButton></form>}
          </div>
        </Card>
      )}
    </>
  );
}
