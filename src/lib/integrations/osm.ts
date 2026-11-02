/**
 * Lead discovery from OpenStreetMap (free, public, ODbL-licensed data).
 * Nominatim resolves the city; Overpass lists matching businesses with their public contact tags.
 * Usage policy: identify via User-Agent, ≤1 request/second, modest result sizes.
 */
import { env } from "@/lib/env";

export const LEAD_CATEGORIES = {
  salon: { label: "Hair & beauty salons", search: "beauty salons", filters: ['["shop"="hairdresser"]', '["shop"="beauty"]'] },
  barber: { label: "Barbershops", search: "barbershops", filters: ['["shop"="hairdresser"]["hairdresser"="barber"]'] },
  spa: { label: "Spas & massage", search: "spas", filters: ['["leisure"="spa"]', '["shop"="massage"]'] },
  nails: { label: "Nail salons", search: "nail salons", filters: ['["shop"="beauty"]["beauty"="nails"]'] },
  restaurant: { label: "Restaurants & cafés", search: "restaurants", filters: ['["amenity"="restaurant"]', '["amenity"="cafe"]'] },
  dentist: { label: "Dental clinics", search: "dental clinics", filters: ['["amenity"="dentist"]'] },
  clinic: { label: "Clinics & doctors", search: "clinics", filters: ['["amenity"="clinic"]', '["amenity"="doctors"]'] },
  gym: { label: "Gyms & fitness studios", search: "gyms", filters: ['["leisure"="fitness_centre"]'] },
  bakery: { label: "Bakeries", search: "bakeries", filters: ['["shop"="bakery"]'] },
  car_repair: { label: "Auto repair shops", search: "car repair shops", filters: ['["shop"="car_repair"]'] },
} as const;
export type LeadCategory = keyof typeof LEAD_CATEGORIES;

export interface DiscoveredLead {
  sourceRef: string;
  name: string;
  phone: string | null;
  email: string | null;
  website: string | null;
  instagram: string | null;
  address: string | null;
  hasHours: boolean;
}

const UA = "AI-Empire-OS/1.0 (private founder workspace; lead research)";

export function buildOverpassQuery(category: LeadCategory, areaId: number, limit: number): string {
  const parts = LEAD_CATEGORIES[category].filters.map((f) => `nwr${f}(area.a);`).join("");
  return `[out:json][timeout:25];area(id:${areaId})->.a;(${parts});out center tags ${Math.min(Math.max(limit, 1), 200)};`;
}

type OsmElement = { type: string; id: number; tags?: Record<string, string> };

const clean = (v: string | undefined, max: number) => (v ? v.trim().slice(0, max) || null : null);

/** Pure: Overpass JSON → normalised leads (named businesses only, de-duplicated). */
export function parseOverpass(json: { elements?: OsmElement[] }): DiscoveredLead[] {
  const seen = new Set<string>();
  const out: DiscoveredLead[] = [];
  for (const el of json.elements ?? []) {
    const t = el.tags ?? {};
    const name = clean(t.name, 200);
    if (!name) continue;
    const ref = `${el.type}/${el.id}`;
    if (seen.has(ref)) continue;
    seen.add(ref);
    const street = [t["addr:housenumber"], t["addr:street"]].filter(Boolean).join(" ");
    const address = [street, t["addr:city"], t["addr:state"], t["addr:postcode"]].filter(Boolean).join(", ");
    out.push({
      sourceRef: ref,
      name,
      phone: clean(t.phone ?? t["contact:phone"], 40),
      email: clean(t.email ?? t["contact:email"], 200),
      website: clean(t.website ?? t["contact:website"] ?? t.url, 300),
      instagram: clean(t["contact:instagram"] ?? t.instagram, 200),
      address: clean(address, 300),
      hasHours: !!t.opening_hours,
    });
  }
  return out;
}

async function fetchJson<T>(url: string, init: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { "user-agent": UA, accept: "application/json", ...init.headers }, signal: AbortSignal.timeout(30_000), cache: "no-store" });
  if (!res.ok) throw new Error(`Map data service returned ${res.status}${res.status === 429 ? " (rate limited — try again in a minute)" : ""}`);
  return (await res.json()) as T;
}

/** Resolves "Dallas, United States" to an Overpass area id. */
export async function resolveArea(city: string, country: string): Promise<{ areaId: number; label: string }> {
  const q = new URLSearchParams({ city, country, format: "jsonv2", limit: "5" });
  const hits = await fetchJson<{ osm_type: string; osm_id: number; display_name: string }[]>(`${env.NOMINATIM_URL}/search?${q}`, { method: "GET" });
  const hit = hits.find((h) => h.osm_type === "relation") ?? hits.find((h) => h.osm_type === "way");
  if (!hit) throw new Error(`Could not find "${city}, ${country}" on the map. Try the full city name, e.g. "Dallas" with country "United States".`);
  return { areaId: (hit.osm_type === "relation" ? 3_600_000_000 : 2_400_000_000) + hit.osm_id, label: hit.display_name };
}

export async function discoverBusinesses(category: LeadCategory, city: string, country: string, limit = 60): Promise<{ leads: DiscoveredLead[]; area: string }> {
  const { areaId, label } = await resolveArea(city, country);
  const json = await fetchJson<{ elements?: OsmElement[] }>(env.OVERPASS_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ data: buildOverpassQuery(category, areaId, limit) }).toString(),
  });
  return { leads: parseOverpass(json), area: label };
}
