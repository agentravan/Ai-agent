import Link from "next/link";
import { Fish, PenTool } from "lucide-react";
import { Badge, Card, Empty, Field, Flash, PageHeader, type SearchParams } from "@/components/ui";
import { SubmitButton } from "@/components/ui/submit-button";
import { aiStatus } from "@/lib/ai/registry";
import { can } from "@/lib/permissions";
import { formatDateTime } from "@/lib/utilities/format";
import { requireContext } from "@/modules/auth/session";
import { createDesignAction } from "@/modules/design/actions";
import { STAGES } from "@/modules/design/logic";
import type { DesignDoc } from "@/modules/design/service";

export const metadata = { title: "Design Studio" };

const STAGE_TONE = { brief: "neutral", draft: "info", review: "warn", approved: "good" } as const;

export default async function DesignLobby({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireContext();
  const [params, ai, { data: docs }] = await Promise.all([
    searchParams, aiStatus(),
    ctx.db.from("design_docs").select("id, title, idea, stage, round, created_at, approved_at").eq("organisation_id", ctx.organisation.id)
      .order("created_at", { ascending: false }).limit(40).returns<Pick<DesignDoc, "id" | "title" | "idea" | "stage" | "round" | "created_at" | "approved_at">[]>(),
  ]);
  const canOperate = can(ctx.profile.role, "operate");

  return (
    <>
      <PageHeader eyebrow="Executive Office" title="Design Studio"
        subtitle="Design with an elephant, review with a goldfish. Plan a website or management system before anyone builds it: Gaja (the Elephant) knows the company and writes the brief and the design; Meen (the Goldfish) reviews it with no memory — only the text — to catch what was assumed but never written down. You decide what to fix and approve the design." />
      <Flash params={params} />

      <div className="grid gap-6 xl:grid-cols-3">
        <Card title="Start a design" className="xl:col-span-2">
          {canOperate && ai.available ? (
            <form action={createDesignAction} className="grid gap-3">
              <Field label="Project name"><input name="title" required minLength={3} maxLength={160} className="input" placeholder="Team Work management system" /></Field>
              <Field label="The idea — what should it do, for whom" hint="Plain words are fine. Hinglish bhi chalega.">
                <textarea name="idea" required minLength={5} maxLength={4000} rows={5} className="input"
                  placeholder="Candidates, clients aur job openings ek jagah track karne ke liye system. Recruiter candidate add kare, interview schedule kare, client ko profiles bheje; mujhe daily report mile." />
              </Field>
              <div><SubmitButton pendingText="Opening the studio…"><PenTool className="h-4 w-4" />Start with a brief</SubmitButton></div>
            </form>
          ) : <p className="text-sm text-amber-300">{ai.available ? "View only." : "AI unavailable — connect an AI provider in Settings."}</p>}
        </Card>
        <Card title="How it works">
          <ol className="space-y-2 text-sm text-zinc-300">
            <li><span className="text-gold">1. Brief</span> — Gaja turns your idea into a brief; Meen challenges it fresh.</li>
            <li><span className="text-gold">2. Draft</span> — Gaja writes the full design and build plan. Edit anything.</li>
            <li><span className="text-gold">3. Goldfish review</span> — four fresh reviewers: simplicity, new team member, design critic, ready-to-build.</li>
            <li><span className="text-gold">4. You decide</span> — mark findings Fix or Skip; Gaja revises; review again.</li>
            <li><span className="text-gold">5. Approve</span> — the spec is frozen and the build becomes a task.</li>
          </ol>
        </Card>
      </div>

      <Card className="mt-6" title="Designs">
        {docs?.length ? (
          <ul className="divide-y divide-line">
            {docs.map((d) => (
              <li key={d.id} className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <Link href={`/design/${d.id}`} className="block truncate text-sm text-zinc-100 hover:text-white">{d.title}</Link>
                  <p className="truncate text-xs text-zinc-500">{formatDateTime(d.created_at)} · {d.idea}</p>
                </div>
                <div className="flex shrink-0 gap-2">
                  {d.round > 0 && <Badge tone="neutral">{`round ${d.round}`}</Badge>}
                  <Badge tone={STAGE_TONE[d.stage]}>{STAGES.find((s) => s.key === d.stage)?.label ?? d.stage}</Badge>
                </div>
              </li>
            ))}
          </ul>
        ) : <Empty icon={Fish}>No designs yet. Start with your website or management system above.</Empty>}
      </Card>
    </>
  );
}
