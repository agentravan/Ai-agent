import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CheckCircle2, Fish, PenTool, RotateCcw, Send, ShieldCheck } from "lucide-react";
import { Badge, Card, Flash, type SearchParams } from "@/components/ui";
import { StepRunner } from "@/components/design/step-runner";
import { CopyButton } from "@/components/linkedin/copy-button";
import { SubmitButton } from "@/components/ui/submit-button";
import { can } from "@/lib/permissions";
import { cn, formatDateTime } from "@/lib/utilities/format";
import { requireContext } from "@/modules/auth/session";
import {
  approveDesignAction, backToBriefAction, decideFindingAction, reviseDraftAction, saveBriefAction, saveDraftAction, sendToReviewAction, startDraftAction,
} from "@/modules/design/actions";
import { approvalBlockers, REVIEWERS, specMarkdown, STAGES, tallyFindings, type Finding, type FindingRow } from "@/modules/design/logic";
import { loadRound, type DesignDoc } from "@/modules/design/service";

export const metadata = { title: "Design Studio" };
export const maxDuration = 120;

const SEVERITY_TONE = { blocker: "bad", major: "warn", minor: "neutral" } as const;
const DECISION_TONE = { open: "warn", fix: "info", skip: "neutral" } as const;

function Doc({ text }: { text: string }) {
  return <pre className="max-h-[70vh] overflow-auto whitespace-pre-wrap rounded-lg border border-line bg-black/20 p-4 text-[13px] leading-6 text-zinc-200">{text}</pre>;
}

function FindingItem({ f, children }: { f: Finding | FindingRow; children?: ReactNode }) {
  return (
    <li className="space-y-1 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={SEVERITY_TONE[f.severity]}>{f.severity}</Badge>
        {"decision" in f && <Badge tone={DECISION_TONE[f.decision]}>{f.decision === "open" ? "undecided" : f.decision}</Badge>}
        <span className="text-sm font-medium text-zinc-100">{f.title}</span>
      </div>
      {f.detail && <p className="text-sm text-zinc-400">{f.detail}</p>}
      {f.fix && <p className="text-sm text-emerald-300/90">Fix: {f.fix}</p>}
      {children}
    </li>
  );
}

export default async function DesignPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  const ctx = await requireContext();
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { data: doc } = await ctx.db.from("design_docs").select("*").eq("id", id).eq("organisation_id", ctx.organisation.id).maybeSingle<DesignDoc>();
  if (!doc) notFound();
  const round = await loadRound(ctx, doc);
  const canOperate = can(ctx.profile.role, "operate");
  const canGovern = can(ctx.profile.role, "govern");
  const stageIndex = STAGES.findIndex((s) => s.key === doc.stage);
  const auto = canOperate && !doc.error;
  const tally = tallyFindings(round.findings);
  const blockers = approvalBlockers(round.lenses, round.findings);
  const skipped = round.findings.filter((f) => f.decision === "skip");

  return (
    <>
      <div className="mb-4 flex items-center justify-between gap-3">
        <Link href="/design" className="text-sm text-zinc-400 hover:text-zinc-100">← Design Studio</Link>
        <span className="text-xs text-zinc-500">{formatDateTime(doc.created_at)}</span>
      </div>
      <Flash params={sp} />

      <header className="mb-6 space-y-3">
        <h1 className="text-2xl font-semibold text-zinc-50">{doc.title}</h1>
        <ol className="flex flex-wrap items-center gap-2 text-xs" aria-label="Progress">
          {STAGES.map((s, i) => (
            <li key={s.key} className={cn("rounded-md px-2 py-1 ring-1 ring-inset", i < stageIndex ? "text-emerald-300 ring-emerald-500/20" : i === stageIndex ? "bg-gold/10 text-gold ring-gold/30" : "text-zinc-500 ring-line")}
              aria-current={i === stageIndex ? "step" : undefined}>
              {i + 1}. {s.label}{s.key === "review" && doc.round > 0 ? ` · round ${doc.round}` : ""}
            </li>
          ))}
        </ol>
        {doc.error && <p className="text-sm text-rose-300" role="alert">Last step failed: {doc.error}</p>}
      </header>

      <Card title="The idea" className="mb-6"><p className="whitespace-pre-wrap text-sm text-zinc-300">{doc.idea}</p></Card>

      {/* 1. BRIEF */}
      {doc.stage === "brief" && (
        <div className="grid gap-6">
          <Card title="Brief — Gaja (Elephant)" description="Edit anything. Saving asks the goldfish to challenge the new text.">
            {!doc.brief ? (
              canOperate ? <StepRunner id={doc.id} label={doc.error ? "Try again" : "Write the brief"} working="Gaja is writing the brief…" autoStart={auto} /> : <p className="text-sm text-muted">Waiting for the brief.</p>
            ) : canOperate ? (
              <form action={saveBriefAction} className="grid gap-3">
                <input type="hidden" name="id" value={doc.id} />
                <textarea name="brief" defaultValue={doc.brief} rows={18} maxLength={20000} className="input font-mono text-[13px]" />
                <div><SubmitButton variant="ghost" pendingText="Saving…">Save brief</SubmitButton></div>
              </form>
            ) : <Doc text={doc.brief} />}
          </Card>

          {doc.brief && (
            <Card title="Goldfish challenge — Meen" description="A fresh reader with no background challenges the brief before it is designed.">
              {!doc.challenges ? (
                canOperate ? <StepRunner id={doc.id} label={doc.error ? "Try again" : "Challenge the brief"} working="Meen is reading the brief fresh…" autoStart={auto} /> : <p className="text-sm text-muted">Waiting for the challenge.</p>
              ) : (
                <>
                  <ul className="divide-y divide-line">{doc.challenges.map((f, i) => <FindingItem key={i} f={f} />)}</ul>
                  <p className="mt-3 text-xs text-zinc-500">Change the brief above to answer these, or go ahead — Gaja will address them in the draft.</p>
                  {canOperate && (
                    <form action={startDraftAction} className="mt-4">
                      <input type="hidden" name="id" value={doc.id} />
                      <SubmitButton pendingText="Starting…"><PenTool className="h-4 w-4" />Approve brief — write the design</SubmitButton>
                    </form>
                  )}
                </>
              )}
            </Card>
          )}
        </div>
      )}

      {/* 2. DRAFT */}
      {doc.stage === "draft" && (
        <Card title="Design draft — Gaja (Elephant)" description={doc.round > 0 ? `Revised after review round ${doc.round}. Send it for a fresh review when ready.` : "Edit anything, then send it to the goldfish."}>
          {!doc.draft ? (
            canOperate ? <StepRunner id={doc.id} label={doc.error ? "Try again" : "Write the design"} working="Gaja is writing the design (about a minute)…" autoStart={auto} /> : <p className="text-sm text-muted">Waiting for the draft.</p>
          ) : canOperate ? (
            <div className="grid gap-4">
              <form action={saveDraftAction} className="grid gap-3">
                <input type="hidden" name="id" value={doc.id} />
                <textarea name="draft" defaultValue={doc.draft} rows={28} maxLength={60000} className="input font-mono text-[13px]" />
                <div><SubmitButton variant="ghost" pendingText="Saving…">Save draft</SubmitButton></div>
              </form>
              <div className="flex flex-wrap gap-3 border-t border-line pt-4">
                <form action={sendToReviewAction}><input type="hidden" name="id" value={doc.id} />
                  <SubmitButton pendingText="Sending…"><Fish className="h-4 w-4" />Send to goldfish review</SubmitButton></form>
                <form action={backToBriefAction}><input type="hidden" name="id" value={doc.id} />
                  <SubmitButton variant="ghost" pendingText="Going back…"><RotateCcw className="h-4 w-4" />Back to the brief</SubmitButton></form>
              </div>
            </div>
          ) : <Doc text={doc.draft} />}
        </Card>
      )}

      {/* 3. REVIEW */}
      {doc.stage === "review" && doc.draft && (
        <div className="grid gap-6">
          <Card title={`Goldfish review — round ${doc.round}`}
            description="Each reviewer sees only the document: no memory, no brief, no conversation."
            action={<span className="text-xs text-zinc-400">{tally.blocker} blocker · {tally.major} major · {tally.minor} minor</span>}>
            <ul className="mb-4 flex flex-wrap gap-2">
              {REVIEWERS.map((r) => (
                <li key={r.key}><Badge tone={round.lenses.includes(r.key) ? "good" : "neutral"}>{`${r.label}${round.lenses.includes(r.key) ? " ✓" : ""}`}</Badge></li>
              ))}
            </ul>
            {round.lenses.length < REVIEWERS.length && (canOperate
              ? <StepRunner id={doc.id} label={doc.error ? "Try again" : "Run the reviews"} working="Meen is reviewing with fresh eyes…" autoStart={auto} />
              : <p className="text-sm text-muted">Reviews in progress.</p>)}
            {round.paraphrase && (
              <div className="mt-4 rounded-lg border border-line bg-black/20 p-3">
                <p className="mb-1 text-xs font-medium tracking-wide text-zinc-400 uppercase">How a newcomer understood it</p>
                <p className="text-sm text-zinc-300">{round.paraphrase}</p>
                <p className="mt-1 text-xs text-zinc-500">If this is not what you meant, the document is unclear there.</p>
              </div>
            )}
          </Card>

          {REVIEWERS.filter((r) => round.lenses.includes(r.key)).map((r) => {
            const mine = round.findings.filter((f) => f.lens === r.key);
            return (
              <Card key={r.key} title={`${r.label} — ${r.who}`}>
                {mine.length ? (
                  <ul className="divide-y divide-line">
                    {mine.map((f) => (
                      <FindingItem key={f.id} f={f}>
                        {canOperate && (
                          <form action={decideFindingAction} className="flex gap-2 pt-1">
                            <input type="hidden" name="id" value={doc.id} />
                            <input type="hidden" name="finding" value={f.id} />
                            <SubmitButton variant={f.decision === "fix" ? "primary" : "ghost"} name="decision" value={f.decision === "fix" ? "open" : "fix"}>{f.decision === "fix" ? "Fix ✓" : "Fix"}</SubmitButton>
                            <SubmitButton variant={f.decision === "skip" ? "primary" : "ghost"} name="decision" value={f.decision === "skip" ? "open" : "skip"}>{f.decision === "skip" ? "Skip ✓" : "Skip"}</SubmitButton>
                          </form>
                        )}
                      </FindingItem>
                    ))}
                  </ul>
                ) : <p className="flex items-center gap-2 text-sm text-emerald-300"><CheckCircle2 className="h-4 w-4" />Nothing found.</p>}
              </Card>
            );
          })}

          <details className="rounded-xl border border-line bg-panel/80 p-4">
            <summary className="cursor-pointer text-[13px] font-semibold text-zinc-100">The draft under review</summary>
            <div className="mt-3"><Doc text={doc.draft} /></div>
          </details>

          {canOperate && round.lenses.length === REVIEWERS.length && (
            <Card title="Revise with Gaja" description="Gaja fixes the findings marked Fix (and your notes), then the draft goes back for a fresh review round.">
              <form action={reviseDraftAction} className="grid gap-3">
                <input type="hidden" name="id" value={doc.id} />
                <textarea name="notes" rows={3} maxLength={2000} className="input" placeholder="Optional: anything else to change (e.g. 'recruiter ko client ka phone number nahi dikhna chahiye')" />
                <div><SubmitButton pendingText="Gaja is revising (about a minute)…"><PenTool className="h-4 w-4" />Revise the draft</SubmitButton></div>
              </form>
            </Card>
          )}

          <Card title="Approve the design" description="Approval freezes the spec and gives the build to the product head as a task.">
            {blockers.length ? (
              <ul className="list-disc space-y-1 pl-5 text-sm text-amber-300">{blockers.map((b) => <li key={b}>{b}</li>)}</ul>
            ) : canGovern ? (
              <form action={approveDesignAction}><input type="hidden" name="id" value={doc.id} />
                <SubmitButton pendingText="Approving…"><ShieldCheck className="h-4 w-4" />Approve design</SubmitButton></form>
            ) : <p className="text-sm text-muted">Ready — only the Founder or an admin can approve.</p>}
          </Card>
        </div>
      )}

      {/* 4. APPROVED */}
      {doc.stage === "approved" && doc.draft && (
        <Card title="Approved spec" description={`Approved ${doc.approved_at ? formatDateTime(doc.approved_at) : ""} after ${doc.round} review round${doc.round === 1 ? "" : "s"}. Paste it into your build tool (e.g. Claude Code) or save it as docs/designs/<name>.md.`}
          action={<CopyButton text={specMarkdown(doc, skipped)} label="Copy spec" />}>
          <p className="mb-3 flex items-center gap-2 text-sm text-emerald-300"><Send className="h-4 w-4" />The build task is in <Link href="/projects" className="underline">Projects &amp; Tasks</Link>.</p>
          <Doc text={specMarkdown(doc, skipped)} />
        </Card>
      )}
    </>
  );
}
