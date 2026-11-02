import { ExternalLink, MessageSquareText, PenLine, Send } from "lucide-react";
import { Badge, Card, Empty, Field, Flash, PageHeader, Select, Stat, type SearchParams } from "@/components/ui";
import { CopyButton } from "@/components/linkedin/copy-button";
import { SubmitButton } from "@/components/ui/submit-button";
import { aiStatus } from "@/lib/ai/registry";
import { can } from "@/lib/permissions";
import { formatDateTime } from "@/lib/utilities/format";
import { approveDraftAction, discardDraftAction, draftAction, markPostedAction } from "@/modules/linkedin/actions";
import { KIND_LABEL, shareLink } from "@/modules/linkedin/logic";
import { requireContext } from "@/modules/auth/session";
import { LINKEDIN_KINDS, type LinkedinDraft } from "@/types/domain";

export const metadata = { title: "LinkedIn Desk" };
export const maxDuration = 120;

const KIND_OPTIONS = LINKEDIN_KINDS.map((k) => ({ value: k, label: KIND_LABEL[k] }));

function DraftItem({ d, canGovern, canOperate }: { d: LinkedinDraft; canGovern: boolean; canOperate: boolean }) {
  const body = d.body ?? "";
  return (
    <li className="py-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="info">{KIND_LABEL[d.kind]}</Badge>
        <Badge tone={d.status === "approved" ? "good" : d.status === "posted" ? "gold" : "neutral"}>{d.status}</Badge>
        <span className="text-xs text-zinc-500">{formatDateTime(d.created_at)} · {d.brief.slice(0, 80)}</span>
      </div>
      {d.context && <p className="mt-2 border-l-2 border-line pl-3 text-xs text-muted">Replying to: {d.context.slice(0, 300)}{d.context.length > 300 ? "…" : ""}</p>}
      <p className="mt-2 whitespace-pre-wrap rounded-md border border-line bg-panel-2/40 p-3 text-sm text-zinc-200">{body}</p>
      <p className="mt-1 text-[11px] text-zinc-500">{body.length} characters</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {d.status === "draft" && canGovern && <form action={approveDraftAction}><input type="hidden" name="id" value={d.id} /><SubmitButton>Approve</SubmitButton></form>}
        {d.status === "approved" && (
          <>
            <CopyButton text={body} />
            {d.kind === "post" && <a className="btn-gold" href={shareLink(body)} target="_blank" rel="noreferrer"><ExternalLink className="h-4 w-4" />Open in LinkedIn</a>}
            {canOperate && <form action={markPostedAction}><input type="hidden" name="id" value={d.id} /><SubmitButton variant="ghost"><Send className="h-4 w-4" />I posted it</SubmitButton></form>}
          </>
        )}
        {(d.status === "draft" || d.status === "approved") && canOperate && (
          <form action={discardDraftAction}><input type="hidden" name="id" value={d.id} /><button className="btn-ghost">Discard</button></form>
        )}
      </div>
    </li>
  );
}

export default async function LinkedinPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireContext();
  const [params, ai, { data }] = await Promise.all([
    searchParams,
    aiStatus(),
    ctx.db.from("linkedin_drafts").select("*").eq("organisation_id", ctx.organisation.id).neq("status", "discarded").order("created_at", { ascending: false }).limit(100).returns<LinkedinDraft[]>(),
  ]);
  const drafts = data ?? [];
  const open = drafts.filter((d) => d.status === "draft" || d.status === "approved");
  const posted = drafts.filter((d) => d.status === "posted");
  const canOperate = can(ctx.profile.role, "operate");
  const canGovern = can(ctx.profile.role, "govern");
  const weekAgo = Date.now() - 7 * 86_400_000;

  return (
    <>
      <PageHeader eyebrow="Cabin D · Sales & Social Media Engine" title="LinkedIn Desk"
        subtitle="Your AI writer drafts posts and replies to comments and DMs in your voice. You approve, copy and post — nothing goes on LinkedIn without you, so your account stays safe." />
      <Flash params={params} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Stat icon={PenLine} label="Waiting for approval" value={drafts.filter((d) => d.status === "draft").length} />
        <Stat icon={MessageSquareText} label="Approved, ready to post" value={drafts.filter((d) => d.status === "approved").length} />
        <Stat icon={Send} label="Posted this week" value={posted.filter((d) => d.posted_at && Date.parse(d.posted_at) > weekAgo).length} tone="good" />
      </div>

      {canOperate && (
        <Card title="Ask the AI to write" description="A post from an idea, or a reply to a comment or DM (paste what they wrote)" className="mt-6">
          {ai.available ? (
            <form action={draftAction} className="grid gap-3 md:grid-cols-2">
              <Field label="What to write"><Select name="kind" options={KIND_OPTIONS} defaultValue="post" /></Field>
              <Field label="Topic or your intent" hint="e.g. 3 signs a gym needs a website · thank them and offer a free audit">
                <input name="brief" required minLength={3} maxLength={2000} className="input" />
              </Field>
              <Field label="Comment or message you are replying to (for replies)" className="md:col-span-2">
                <textarea name="context" rows={3} maxLength={4000} className="input" placeholder="Paste their comment or DM here" />
              </Field>
              <div className="md:col-span-2"><SubmitButton pendingText="Writing…">Write draft</SubmitButton></div>
            </form>
          ) : <p className="text-sm text-amber-300">AI unavailable — connect an AI provider in Settings to draft content.</p>}
        </Card>
      )}

      <Card title={`Drafts (${open.length})`} className="mt-6">
        {open.length ? <ul className="divide-y divide-line">{open.map((d) => <DraftItem key={d.id} d={d} canGovern={canGovern} canOperate={canOperate} />)}</ul>
          : <Empty icon={PenLine}>No drafts yet. Ask the AI to write your first post above.</Empty>}
      </Card>

      {posted.length > 0 && (
        <Card title={`Posted (${posted.length})`} description="Your published history — new posts avoid repeating your recent hooks" className="mt-6">
          <ul className="divide-y divide-line">
            {posted.slice(0, 20).map((d) => (
              <li key={d.id} className="py-2.5 text-sm">
                <span className="text-zinc-200">{(d.body ?? "").split("\n")[0]?.slice(0, 120)}</span>
                <span className="ml-2 text-xs text-zinc-500">{KIND_LABEL[d.kind]} · {formatDateTime(d.posted_at)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
