import Link from "next/link";
import { ExternalLink, Radar, Search, ShieldAlert } from "lucide-react";
import { Badge, Card, Empty, PageHeader, Select, type SearchParams } from "@/components/ui";
import { requireContext } from "@/modules/auth/session";
import { RADAR } from "@/modules/knowledge/catalog";
import { safeRepoUrl, searchRadar } from "@/modules/knowledge/logic";

export const metadata = { title: "Agent Radar" };

const CATEGORIES = [...new Set(RADAR.agents.flatMap((a) => a.categories))].sort();
const CATEGORY_OPTIONS = CATEGORIES.map((c) => ({ value: c, label: `${c} (${RADAR.agents.filter((a) => a.categories.includes(c)).length})` }));

export default async function RadarPage({ searchParams }: { searchParams: SearchParams }) {
  await requireContext();
  const params = await searchParams;
  const q = typeof params.q === "string" ? params.q.slice(0, 100) : "";
  const category = typeof params.category === "string" && CATEGORIES.includes(params.category) ? params.category : "";
  const results = searchRadar(RADAR.agents, q, category).slice(0, 90);

  return (
    <>
      <PageHeader eyebrow="Executive Office · Knowledge" title="Agent Radar"
        subtitle={`${RADAR.agents.length} open-source AI agent projects to watch — memory, guardrails, tool calling, browsing and more. A research list only: nothing here is installed or connected to your system.`}
        action={<Link href="/playbooks" className="btn-ghost">Executive Playbooks</Link>} />

      <div className="mb-4 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200">
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <span>Outside code is never installed automatically. Before adopting any project: check its licence, last update and permissions, then raise it in the Board Room or Idea Court — anything that costs money or touches client data needs your approval.</span>
      </div>

      <Card>
        <form method="get" className="grid gap-3 sm:grid-cols-[1fr_18rem_auto]">
          <input name="q" defaultValue={q} maxLength={100} className="input" placeholder="Search, e.g. memory, browser, guardrails, voice" aria-label="Search projects" />
          <Select name="category" options={CATEGORY_OPTIONS} defaultValue={category} placeholder="All categories" />
          <button className="btn-primary"><Search className="h-4 w-4" />Search</button>
        </form>
      </Card>

      <Card title={`${results.length}${results.length === 90 ? "+" : ""} projects, most-starred first`} className="mt-6">
        {results.length ? (
          <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {results.map((a) => {
              const url = safeRepoUrl(a.url);
              return (
                <li key={a.id} className="flex flex-col rounded-lg border border-line bg-panel-2/30 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-medium text-zinc-100">{a.name}</p>
                    <span className="shrink-0 text-xs text-zinc-500">★ {a.stars.toLocaleString("en-IN")}</span>
                  </div>
                  <p className="mt-1 line-clamp-3 text-sm text-zinc-400">{a.description}</p>
                  <div className="mt-2 flex flex-wrap gap-1">{a.categories.map((c) => <Badge key={c}>{c}</Badge>)}</div>
                  {url && <a href={url} target="_blank" rel="noreferrer noopener nofollow" className="mt-3 inline-flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-100">View on GitHub<ExternalLink className="h-3 w-3" /></a>}
                </li>
              );
            })}
          </ul>
        ) : <Empty icon={Radar}>Nothing matches. Try &quot;memory&quot; or &quot;browser&quot;.</Empty>}
      </Card>

      <p className="mt-6 text-xs text-zinc-500">
        Directory from <a href={RADAR.source} className="underline hover:text-zinc-300" target="_blank" rel="noreferrer">awesome-ai-agents</a> ({RADAR.commit.slice(0, 7)}), {RADAR.license}. {RADAR.attribution}
      </p>
    </>
  );
}
