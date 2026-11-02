import Link from "next/link";
import { Search, Sparkles } from "lucide-react";
import { Badge, Card, Empty, Flash, PageHeader, Select, type SearchParams } from "@/components/ui";
import { SubmitButton } from "@/components/ui/submit-button";
import { can } from "@/lib/permissions";
import { hireFromLibraryAction } from "@/modules/library/actions";
import { divisionLabel, LIBRARY, templateBySlug } from "@/modules/library/catalog";
import { RECOMMENDED_SLUGS, searchTemplates, type AgentTemplate } from "@/modules/library/logic";
import { requireContext } from "@/modules/auth/session";

export const metadata = { title: "Agent Library" };

const DIVISION_OPTIONS = Object.entries(LIBRARY.divisions).map(([value, label]) => ({
  value, label: `${label} (${LIBRARY.agents.filter((a) => a.division === value).length})`,
}));

function TemplateCard({ t, hired, canHire }: { t: AgentTemplate; hired: boolean; canHire: boolean }) {
  return (
    <li className="flex flex-col rounded-lg border border-line bg-panel-2/30 p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium text-zinc-100">{t.emoji ? `${t.emoji} ` : ""}{t.name}</p>
          <p className="text-xs text-zinc-500">{divisionLabel(t.division)}</p>
        </div>
        {hired ? <Badge tone="good">on team</Badge> : canHire && (
          <form action={hireFromLibraryAction}><input type="hidden" name="slug" value={t.slug} /><SubmitButton pendingText="Hiring…">Hire</SubmitButton></form>
        )}
      </div>
      <p className="mt-2 line-clamp-3 text-sm text-zinc-300">{t.description}</p>
      {t.vibe && <p className="mt-1 text-xs text-muted italic">{t.vibe}</p>}
      <details className="mt-2 text-xs">
        <summary className="cursor-pointer text-zinc-400 hover:text-zinc-100">Read role instructions</summary>
        <p className="mt-2 max-h-72 overflow-y-auto whitespace-pre-wrap text-zinc-400">{t.instructions}</p>
      </details>
    </li>
  );
}

export default async function LibraryPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireContext();
  const [params, { data: hiredRows }] = await Promise.all([
    searchParams,
    ctx.db.from("agents").select("template_slug").eq("organisation_id", ctx.organisation.id).not("template_slug", "is", null).returns<{ template_slug: string }[]>(),
  ]);
  const q = typeof params.q === "string" ? params.q.slice(0, 100) : "";
  const division = typeof params.division === "string" && params.division in LIBRARY.divisions ? params.division : "";
  const hired = new Set((hiredRows ?? []).map((r) => r.template_slug));
  const canHire = can(ctx.profile.role, "govern");
  const searching = !!(q || division);
  const results = searching ? searchTemplates(LIBRARY.agents, q, division) : [];
  const recommended = RECOMMENDED_SLUGS.map((s) => templateBySlug(s)).filter((t): t is AgentTemplate => !!t);

  return (
    <>
      <PageHeader eyebrow="Operations · Agent Registry" title="Agent Library"
        subtitle={`${LIBRARY.agents.length} ready-made AI employees — sales, marketing, SEO, developers, designers and more. Hire one in a click; they join your team with safe permissions and follow all company rules.`}
        action={<Link href="/workforce" className="btn-ghost">Back to Agent Registry</Link>} />
      <Flash params={params} />

      <Card>
        <form method="get" className="grid gap-3 sm:grid-cols-[1fr_16rem_auto]">
          <input name="q" defaultValue={q} maxLength={100} className="input" placeholder="Search roles, e.g. LinkedIn, SEO, frontend, proposal" aria-label="Search roles" />
          <Select name="division" options={DIVISION_OPTIONS} defaultValue={division} placeholder="All divisions" />
          <button className="btn-primary"><Search className="h-4 w-4" />Search</button>
        </form>
      </Card>

      {searching ? (
        <Card title={`${results.length}${results.length === 60 ? "+" : ""} matching roles`} className="mt-6" action={<Link href="/workforce/library" className="text-xs text-zinc-400 hover:text-zinc-100">Clear</Link>}>
          {results.length ? (
            <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {results.map((t) => <TemplateCard key={t.slug} t={t} hired={hired.has(t.slug)} canHire={canHire} />)}
            </ul>
          ) : <Empty icon={Search}>No roles match. Try a simpler word like &quot;sales&quot; or &quot;design&quot;.</Empty>}
        </Card>
      ) : (
        <Card title="Recommended for your agency" description="Lead generation, outreach, LinkedIn, SEO, websites and client support" className="mt-6">
          <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {recommended.map((t) => <TemplateCard key={t.slug} t={t} hired={hired.has(t.slug)} canHire={canHire} />)}
          </ul>
        </Card>
      )}

      <p className="mt-6 flex items-start gap-2 text-xs text-zinc-500">
        <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
        <span>Role templates from <a href={LIBRARY.source} className="underline hover:text-zinc-300" target="_blank" rel="noreferrer">Agency Agents</a> ({LIBRARY.commit.slice(0, 7)}), {LIBRARY.license.split(".")[0]}. Every hired agent still works under AI Empire OS governance: approvals, cost limits and audit.</span>
      </p>
    </>
  );
}
