import Link from "next/link";
import { notFound } from "next/navigation";
import { CheckCircle2, Flag } from "lucide-react";
import { Card, Flash, type SearchParams } from "@/components/ui";
import { CourtRoom } from "@/components/court/court-room";
import { SubmitButton } from "@/components/ui/submit-button";
import { can } from "@/lib/permissions";
import { formatDateTime } from "@/lib/utilities/format";
import { requireContext } from "@/modules/auth/session";
import { adoptVerdictAction } from "@/modules/court/actions";
import type { Trial } from "@/modules/court/service";

export const metadata = { title: "Idea Court" };
export const maxDuration = 120;

export default async function CasePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  const ctx = await requireContext();
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { data: trial } = await ctx.db.from("idea_trials").select("*").eq("id", id).eq("organisation_id", ctx.organisation.id).maybeSingle<Trial>();
  if (!trial) notFound();

  return (
    <>
      <div className="mb-4 flex items-center justify-between gap-3">
        <Link href="/court" className="text-sm text-zinc-400 hover:text-zinc-100">← Idea Court</Link>
        <span className="text-xs text-zinc-500">{formatDateTime(trial.created_at)}</span>
      </div>
      <Flash params={sp} />
      <CourtRoom initial={trial} canRun={can(ctx.profile.role, "operate")} />

      {trial.stage === "decided" && trial.ruling && (
        <Card className="mt-6" title="Make it the team's vision" description="Every agent remembers the verdict and the vision; the 7-day test becomes a task for whoever proposed the idea (or the CEO).">
          {trial.adopted_at ? (
            <p className="flex items-center gap-2 text-sm text-emerald-300"><CheckCircle2 className="h-4 w-4" />Adopted {formatDateTime(trial.adopted_at)} — see <Link href="/projects" className="underline">Projects</Link>.</p>
          ) : can(ctx.profile.role, "govern") ? (
            <form action={adoptVerdictAction}><input type="hidden" name="id" value={trial.id} /><SubmitButton><Flag className="h-4 w-4" />Adopt verdict as team vision</SubmitButton></form>
          ) : <p className="text-sm text-muted">Only the Founder can adopt a verdict.</p>}
        </Card>
      )}
    </>
  );
}
