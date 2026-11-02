import { ArrowDown, ArrowUp, KeyRound, Minus, Search, TrendingUp } from "lucide-react";
import { Badge, Card, Empty, Field, Flash, PageHeader, Stat, Table, Td, type SearchParams } from "@/components/ui";
import { SubmitButton } from "@/components/ui/submit-button";
import { googlePlacesConfigured } from "@/lib/integrations/google-places";
import { can } from "@/lib/permissions";
import { formatDateTime } from "@/lib/utilities/format";
import { requireContext } from "@/modules/auth/session";
import { addKeywordAction, checkNowAction, deleteKeywordAction, rematchAction, toggleKeywordAction } from "@/modules/rank/actions";
import { describeRank, MAX_ACTIVE_KEYWORDS, trend, type Trend } from "@/modules/rank/logic";
import type { RankCheck, RankKeyword } from "@/types/domain";

export const metadata = { title: "Rank Tracker" };
export const maxDuration = 60;

function TrendIcon({ t }: { t: Trend }) {
  if (t === "up" || t === "entered") return <ArrowUp className="h-4 w-4 text-emerald-400" aria-label="Moved up" />;
  if (t === "down" || t === "lost") return <ArrowDown className="h-4 w-4 text-rose-400" aria-label="Moved down" />;
  return <Minus className="h-4 w-4 text-zinc-500" aria-label="No change" />;
}

export default async function RankPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireContext();
  const org = ctx.organisation.id;
  const [params, { data: keywords }, { data: checks }] = await Promise.all([
    searchParams,
    ctx.db.from("rank_keywords").select("*").eq("organisation_id", org).order("created_at").returns<RankKeyword[]>(),
    ctx.db.from("rank_checks").select("id, keyword_id, position, scanned, checked_at").eq("organisation_id", org).order("checked_at", { ascending: false }).limit(1000).returns<RankCheck[]>(),
  ]);
  const K = keywords ?? [];
  const history = new Map<string, RankCheck[]>();
  for (const c of checks ?? []) history.set(c.keyword_id, [...(history.get(c.keyword_id) ?? []), c]);
  const configured = googlePlacesConfigured();
  const canOperate = can(ctx.profile.role, "operate");
  const canGovern = can(ctx.profile.role, "govern");
  const ranked = K.filter((k) => k.last_position !== null);
  const top3 = ranked.filter((k) => (k.last_position ?? 99) <= 3).length;

  return (
    <>
      <PageHeader eyebrow="Cabin D · Sales & Social Media Engine" title="Rank Tracker"
        subtitle="Where your business shows up on Google when customers search, e.g. “best gym in Bandra”. Checked automatically once a day by the autopilot." />
      <Flash params={params} />

      {!configured && (
        <Card className="mb-6">
          <p className="text-sm text-amber-300">Rank tracking needs a Google Places API key. Add <code className="text-amber-200">GOOGLE_PLACES_API_KEY</code> in your Vercel project settings, then redeploy. Daily checks use Google&apos;s free &quot;IDs only&quot; search.</p>
        </Card>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Stat icon={KeyRound} label="Keywords tracked" value={K.filter((k) => k.active).length} hint={`max ${MAX_ACTIVE_KEYWORDS} active`} />
        <Stat icon={Search} label="Showing in top 60" value={ranked.length} />
        <Stat icon={TrendingUp} label="In the top 3" value={top3} tone={top3 ? "good" : undefined} />
      </div>

      <Card title="Your keywords" className="mt-6">
        {K.length ? (
          <Table head={["Keyword", "Your business on Google", "Today", "Last 7 checks", ""]}>
            {K.map((k) => {
              const h = history.get(k.id) ?? [];
              const t = trend(h[1] ? h[1].position : undefined, h[0]?.position ?? null);
              return (
                <tr key={k.id}>
                  <Td><div className="text-zinc-50">{k.keyword}</div>{!k.active && <Badge>paused</Badge>}</Td>
                  <Td className="text-xs">
                    <div className="text-zinc-300">{k.place_name ?? k.business}</div>
                    <div className="text-muted">{k.place_address ?? (k.place_id ? "" : "not matched yet")}</div>
                    {k.last_error && <div className="text-amber-300">{k.last_error}</div>}
                  </Td>
                  <Td>
                    <div className="flex items-center gap-1.5">
                      <span className="num text-lg font-semibold text-zinc-50">{h[0] ? describeRank(h[0].position, h[0].scanned) : "—"}</span>
                      {h[0] && <TrendIcon t={t} />}
                    </div>
                    <div className="text-xs text-zinc-500">{formatDateTime(k.last_checked_at)}</div>
                  </Td>
                  <Td className="num text-xs text-muted">{h.slice(0, 7).reverse().map((c) => (c.position ? `#${c.position}` : "–")).join(" → ") || "—"}</Td>
                  <Td>
                    <div className="flex justify-end gap-2">
                      {canOperate && configured && <form action={checkNowAction}><input type="hidden" name="id" value={k.id} /><SubmitButton variant="ghost" pendingText="Checking…">Check now</SubmitButton></form>}
                      {canOperate && k.place_id && <form action={rematchAction}><input type="hidden" name="id" value={k.id} /><button className="btn-ghost" title="Wrong business matched? Match again">Re-match</button></form>}
                      {canOperate && <form action={toggleKeywordAction}><input type="hidden" name="id" value={k.id} /><button className="btn-ghost">{k.active ? "Pause" : "Resume"}</button></form>}
                      {canGovern && <form action={deleteKeywordAction}><input type="hidden" name="id" value={k.id} /><button className="btn-danger">Remove</button></form>}
                    </div>
                  </Td>
                </tr>
              );
            })}
          </Table>
        ) : <Empty icon={TrendingUp}>No keywords yet. Add what your customers type into Google below.</Empty>}
      </Card>

      {canOperate && configured && (
        <Card title="Track a keyword" description="We find your business on Google Maps once, then check its position every day" className="mt-6">
          <form action={addKeywordAction} className="grid gap-3 md:grid-cols-[1fr_1fr_auto] md:items-end">
            <Field label="What customers search"><input name="keyword" required minLength={2} maxLength={200} className="input" placeholder="best gym in bandra" /></Field>
            <Field label="Your business name + area (as on Google Maps)"><input name="business" required minLength={2} maxLength={200} className="input" placeholder="Iron Gym Bandra West Mumbai" /></Field>
            <SubmitButton pendingText="Finding you on Google…">Add &amp; check</SubmitButton>
          </form>
        </Card>
      )}
      <p className="mt-6 text-xs text-zinc-500">Positions come from Google Places search results (top 60) and can differ slightly from what a person sees, which depends on their location and history.</p>
    </>
  );
}
