import Link from "next/link";
import { BookOpen, Radar, Search, ShieldCheck } from "lucide-react";
import { Badge, Card, Empty, PageHeader, Select, type SearchParams } from "@/components/ui";
import { requireContext } from "@/modules/auth/session";
import { PLAYBOOKS } from "@/modules/knowledge/catalog";
import { DOMAIN_LABEL, KIND_LABEL, searchPlaybooks, type PlaybookKind } from "@/modules/knowledge/logic";

export const metadata = { title: "Executive Playbooks" };

const DOMAIN_OPTIONS = Object.entries(DOMAIN_LABEL).map(([value, label]) => ({
  value, label: `${label} (${PLAYBOOKS.playbooks.filter((p) => p.domain === value).length})`,
}));
const KIND_OPTIONS = (Object.keys(KIND_LABEL) as PlaybookKind[]).map((k) => ({ value: k, label: `${KIND_LABEL[k]}s (${PLAYBOOKS.playbooks.filter((p) => p.kind === k).length})` }));

export default async function PlaybooksPage({ searchParams }: { searchParams: SearchParams }) {
  await requireContext();
  const params = await searchParams;
  const q = typeof params.q === "string" ? params.q.slice(0, 100) : "";
  const domain = typeof params.domain === "string" && params.domain in DOMAIN_LABEL ? params.domain : "";
  const kind = typeof params.kind === "string" && params.kind in KIND_LABEL ? params.kind : "";
  const results = searchPlaybooks(PLAYBOOKS.playbooks, q, domain, kind);

  return (
    <>
      <PageHeader eyebrow="Executive Office · Knowledge" title="Executive Playbooks"
        subtitle={`${PLAYBOOKS.playbooks.length} playbooks, skill templates and lessons from failures. Your AI employees read the right passage from their own field before every task — automatically, free.`}
        action={<Link href="/playbooks/radar" className="btn-ghost"><Radar className="h-4 w-4" />Agent Radar</Link>} />

      <Card>
        <form method="get" className="grid gap-3 sm:grid-cols-[1fr_14rem_12rem_auto]">
          <input name="q" defaultValue={q} maxLength={100} className="input" placeholder="Search, e.g. pricing, cash, hiring, contract, OKR" aria-label="Search playbooks" />
          <Select name="domain" options={DOMAIN_OPTIONS} defaultValue={domain} placeholder="All fields" />
          <Select name="kind" options={KIND_OPTIONS} defaultValue={kind} placeholder="All types" />
          <button className="btn-primary"><Search className="h-4 w-4" />Search</button>
        </form>
      </Card>

      <Card title={`${results.length} ${q || domain || kind ? "matching" : ""} playbooks`} className="mt-6"
        action={(q || domain || kind) ? <Link href="/playbooks" className="text-xs text-zinc-400 hover:text-zinc-100">Clear</Link> : undefined}>
        {results.length ? (
          <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {results.map((p) => (
              <li key={p.slug}>
                <Link href={`/playbooks/${p.slug}`} className="flex h-full flex-col rounded-lg border border-line bg-panel-2/30 p-4 hover:border-zinc-600">
                  <div className="flex items-center gap-2">
                    <Badge tone={p.kind === "lesson" ? "bad" : p.kind === "skill" ? "good" : undefined}>{KIND_LABEL[p.kind]}</Badge>
                    <span className="text-xs text-zinc-500">{DOMAIN_LABEL[p.domain] ?? p.domain}</span>
                  </div>
                  <p className="mt-2 font-medium text-zinc-100">{p.title}</p>
                  <p className="mt-1 line-clamp-3 text-sm text-zinc-400">{p.description || p.sections[0]?.text}</p>
                </Link>
              </li>
            ))}
          </ul>
        ) : <Empty icon={BookOpen}>Nothing matches. Try one simple word like &quot;pricing&quot; or &quot;hiring&quot;.</Empty>}
      </Card>

      <p className="mt-6 flex items-start gap-2 text-xs text-zinc-500">
        <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
        <span>
          Knowledge from <a href={PLAYBOOKS.source} className="underline hover:text-zinc-300" target="_blank" rel="noreferrer">Open Executive</a> ({PLAYBOOKS.commit.slice(0, 7)}), {PLAYBOOKS.license}. {PLAYBOOKS.attribution}{" "}
          Imported as plain text only (no code); links and anything that looks like an instruction were removed. Agents treat it as background, never as orders — approvals, cost limits and audit still apply.
        </span>
      </p>
    </>
  );
}
