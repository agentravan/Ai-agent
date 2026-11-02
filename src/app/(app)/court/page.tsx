import Link from "next/link";
import { Gavel, Scale } from "lucide-react";
import { Badge, Card, Empty, Field, Flash, PageHeader, Select, type SearchParams } from "@/components/ui";
import { SubmitButton } from "@/components/ui/submit-button";
import { aiStatus } from "@/lib/ai/registry";
import { can } from "@/lib/permissions";
import { formatDateTime } from "@/lib/utilities/format";
import { requireContext } from "@/modules/auth/session";
import { fileCaseAction } from "@/modules/court/actions";
import { VERDICT_LABEL } from "@/modules/court/logic";
import type { Trial } from "@/modules/court/service";
import { pickBoard } from "@/modules/board/logic";
import { listAgents } from "@/modules/orchestration/engine";
import type { Mom } from "@/types/domain";

export const metadata = { title: "Idea Court" };

export default async function CourtLobby({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireContext();
  const [params, ai, agents, { data: trials }, { data: recent }] = await Promise.all([
    searchParams, aiStatus(), listAgents(ctx),
    ctx.db.from("idea_trials").select("*").eq("organisation_id", ctx.organisation.id).order("created_at", { ascending: false }).limit(30).returns<Trial[]>(),
    ctx.db.from("board_meetings").select("id, topic, mom").eq("organisation_id", ctx.organisation.id).not("mom", "is", null).order("created_at", { ascending: false }).limit(3).returns<{ id: string; topic: string; mom: Mom }[]>(),
  ]);
  const idea = typeof params.idea === "string" ? params.idea.slice(0, 2000) : "";
  const by = typeof params.by === "string" ? params.by.slice(0, 120) : "";
  const meetingId = typeof params.meeting === "string" && /^[0-9a-f-]{36}$/i.test(params.meeting) ? params.meeting : "";
  const proposers = [{ value: "Founder", label: "Founder (me)" }, ...pickBoard(agents).map((s) => ({ value: s.agent.name, label: `${s.agent.name} — ${s.title}` }))];
  const suggestions = (recent ?? []).flatMap((m) => m.mom.decisions.map((d) => ({ d, meeting: m.id }))).slice(0, 6);
  const canOperate = can(ctx.profile.role, "operate");

  return (
    <>
      <PageHeader eyebrow="Executive Office" title="Idea Court"
        subtitle="Put any idea on trial before the team spends time on it. The prosecutor asks the hardest questions, the defence fights back, 12 jurors vote BUILD / FIX / KILL, and the judge gives the fix, a 7-day ₹0 test and one line of vision for the team." />
      <Flash params={params} />

      <div className="grid gap-6 xl:grid-cols-3">
        <Card title="File a case" className="xl:col-span-2">
          {canOperate && ai.available ? (
            <form action={fileCaseAction} className="grid gap-3">
              <input type="hidden" name="meeting_id" value={meetingId} />
              <Field label="Exhibit A — the idea"><textarea name="idea" required minLength={5} maxLength={2000} rows={3} defaultValue={idea} className="input" placeholder="US ke salons ko ₹12,000 mein website + Google listing bechna, cold email se" /></Field>
              <Field label="Whose idea"><Select name="proposed_by" options={proposers} defaultValue={by || "Founder"} /></Field>
              <div><SubmitButton pendingText="Opening the court…"><Gavel className="h-4 w-4" />Put it on trial</SubmitButton></div>
            </form>
          ) : <p className="text-sm text-amber-300">{ai.available ? "View only." : "AI unavailable — connect an AI provider in Settings."}</p>}
        </Card>
        <Card title="From your meetings" description="Decisions from recent minutes — test them before acting">
          {suggestions.length ? (
            <ul className="space-y-2 text-sm">
              {suggestions.map((s, i) => (
                <li key={i}><Link className="text-zinc-300 hover:text-white" href={`/court?idea=${encodeURIComponent(s.d)}&meeting=${s.meeting}`}>⚖ {s.d}</Link></li>
              ))}
            </ul>
          ) : <p className="text-sm text-muted">Hold a board meeting first — its decisions show up here.</p>}
        </Card>
      </div>

      <Card className="mt-6" title="Cases">
        {trials?.length ? (
          <ul className="divide-y divide-line">
            {trials.map((t) => (
              <li key={t.id} className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <Link href={`/court/${t.id}`} className="block truncate text-sm text-zinc-100 hover:text-white">{t.idea}</Link>
                  <p className="text-xs text-zinc-500">{t.proposed_by ?? "Founder"} · {formatDateTime(t.created_at)}{t.ruling ? ` · “${t.ruling.vision}”` : ""}</p>
                </div>
                <div className="flex shrink-0 gap-2">
                  {t.adopted_at && <Badge tone="info">team vision</Badge>}
                  {t.verdict ? <Badge tone={t.verdict === "build" ? "good" : t.verdict === "fix" ? "warn" : "bad"}>{VERDICT_LABEL[t.verdict].toLowerCase()}</Badge> : <Badge tone="neutral">in court</Badge>}
                </div>
              </li>
            ))}
          </ul>
        ) : <Empty icon={Scale}>No cases yet. File the first idea above.</Empty>}
      </Card>
    </>
  );
}
