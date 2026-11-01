/** Google Trends "trending searches" public RSS feed (free, no key). A demand signal — not exact search volumes. */
export interface TrendItem { title: string; traffic: string | null }

const decode = (s: string) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();

/** Pure: RSS XML → trend items (deduplicated, max 30). */
export function parseTrendsRss(xml: string): TrendItem[] {
  const out: TrendItem[] = [];
  const seen = new Set<string>();
  for (const item of xml.match(/<item>[\s\S]*?<\/item>/g) ?? []) {
    const title = decode(item.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? "");
    if (!title || seen.has(title.toLowerCase())) continue;
    seen.add(title.toLowerCase());
    out.push({ title: title.slice(0, 120), traffic: decode(item.match(/<ht:approx_traffic>([\s\S]*?)<\/ht:approx_traffic>/)?.[1] ?? "") || null });
    if (out.length >= 30) break;
  }
  return out;
}

export async function fetchTrends(geo = "IN"): Promise<TrendItem[]> {
  const res = await fetch(`https://trends.google.com/trending/rss?geo=${encodeURIComponent(geo)}`, { signal: AbortSignal.timeout(15_000), cache: "no-store", headers: { accept: "application/rss+xml, application/xml" } });
  if (!res.ok) throw new Error(`Google Trends feed returned ${res.status}`);
  return parseTrendsRss(await res.text());
}
