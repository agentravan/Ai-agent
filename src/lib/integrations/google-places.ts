/**
 * Google Places API (New) — optional. Only used when GOOGLE_PLACES_API_KEY is set; OpenStreetMap stays the ₹0 default.
 * - Lead discovery: Text Search with contact fields (billed per request; bounded by GOOGLE_PLACES_MAX_PAGES).
 * - Rank tracking: Text Search requesting place IDs only (Google's free "IDs only" SKU).
 * The key is server-only and sent as a header, never in a URL.
 */
import { env } from "@/lib/env";
import type { DiscoveredLead } from "@/lib/integrations/osm";

const ENDPOINT = "https://places.googleapis.com/v1/places:searchText";
const PAGE_SIZE = 20;
/** Google never returns more than 60 results (3 pages) for one text search. */
export const MAX_RANK_DEPTH = 60;

const LEAD_FIELDS = [
  "places.id", "places.displayName", "places.formattedAddress", "places.internationalPhoneNumber", "places.nationalPhoneNumber",
  "places.websiteUri", "places.regularOpeningHours.openNow", "places.businessStatus", "nextPageToken",
].join(",");
const MATCH_FIELDS = "places.id,places.displayName,places.formattedAddress";
const ID_FIELDS = "places.id,nextPageToken";

export interface GooglePlace {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  internationalPhoneNumber?: string;
  nationalPhoneNumber?: string;
  websiteUri?: string;
  regularOpeningHours?: unknown;
  businessStatus?: string;
}
interface SearchResponse { places?: GooglePlace[]; nextPageToken?: string; error?: { message?: string; status?: string } }

export const googlePlacesConfigured = () => !!env.GOOGLE_PLACES_API_KEY;

const clean = (v: string | undefined, max: number) => (v ? v.trim().slice(0, max) || null : null);

/** Pure: Places results → normalised leads (named, operating businesses only, de-duplicated). */
export function parsePlaces(places: GooglePlace[]): DiscoveredLead[] {
  const seen = new Set<string>();
  const out: DiscoveredLead[] = [];
  for (const p of places) {
    const name = clean(p.displayName?.text, 200);
    if (!p.id || !name || seen.has(p.id) || p.businessStatus === "CLOSED_PERMANENTLY") continue;
    seen.add(p.id);
    out.push({
      sourceRef: p.id.slice(0, 80),
      name,
      phone: clean(p.internationalPhoneNumber ?? p.nationalPhoneNumber, 40),
      email: null, // Google does not publish emails.
      website: clean(p.websiteUri, 300),
      instagram: null,
      address: clean(p.formattedAddress, 300),
      hasHours: !!p.regularOpeningHours,
    });
  }
  return out;
}

/** Pure: 1-based position of a place in ordered result IDs, or null if not present. */
export function positionOf(ids: string[], placeId: string): number | null {
  const i = ids.indexOf(placeId);
  return i >= 0 ? i + 1 : null;
}

/** Translates Google's error into a short, safe message (never echoes the key). */
export function placesErrorMessage(status: number, body: SearchResponse | null): string {
  const reason = body?.error?.status ?? "";
  if (status === 403 || reason === "PERMISSION_DENIED") return "Google Places key rejected — enable \"Places API (New)\" and billing for this key in Google Cloud";
  if (status === 429 || reason === "RESOURCE_EXHAUSTED") return "Google Places quota reached — try again later";
  if (status === 400) return `Google Places rejected the search${body?.error?.message ? `: ${body.error.message.slice(0, 120)}` : ""}`;
  return `Google Places returned ${status}`;
}

async function searchText(textQuery: string, fieldMask: string, pageToken?: string, pageSize = PAGE_SIZE): Promise<SearchResponse> {
  const key = env.GOOGLE_PLACES_API_KEY;
  if (!key) throw new Error("Google Places is not configured (GOOGLE_PLACES_API_KEY)");
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": key, "x-goog-fieldmask": fieldMask },
    body: JSON.stringify({ textQuery, pageSize, languageCode: "en", ...(pageToken ? { pageToken } : {}) }),
    signal: AbortSignal.timeout(20_000),
    cache: "no-store",
  });
  const body = (await res.json().catch(() => null)) as SearchResponse | null;
  if (!res.ok || !body) throw new Error(placesErrorMessage(res.status, body));
  return body;
}

/** Runs a text search across up to `maxPages` pages (20 results each). */
async function searchPages(textQuery: string, fieldMask: string, maxPages: number): Promise<GooglePlace[]> {
  const all: GooglePlace[] = [];
  let token: string | undefined;
  for (let page = 0; page < Math.min(maxPages, 3); page++) {
    const r = await searchText(textQuery, fieldMask, token);
    all.push(...(r.places ?? []));
    token = r.nextPageToken;
    if (!token) break;
  }
  return all;
}

export async function discoverGooglePlaces(search: string, city: string, country: string): Promise<{ leads: DiscoveredLead[]; area: string }> {
  const places = await searchPages(`${search} in ${city}, ${country}`, LEAD_FIELDS, env.GOOGLE_PLACES_MAX_PAGES);
  return { leads: parsePlaces(places), area: `${city}, ${country}` };
}

/** Resolves the Founder's business ("Iron Gym Bandra Mumbai") to its Google place. */
export async function findBusiness(query: string): Promise<{ id: string; name: string; address: string | null } | null> {
  const r = await searchText(query, MATCH_FIELDS, undefined, 1);
  const p = r.places?.[0];
  return p?.id ? { id: p.id, name: p.displayName?.text?.slice(0, 200) || query, address: p.formattedAddress?.slice(0, 300) ?? null } : null;
}

/** Where a place ranks for a keyword in Google's results (top 60), using the free IDs-only request. */
export async function rankForKeyword(keyword: string, placeId: string): Promise<{ position: number | null; scanned: number }> {
  const ids = (await searchPages(keyword, ID_FIELDS, 3)).map((p) => p.id).filter((id): id is string => !!id);
  return { position: positionOf(ids, placeId), scanned: Math.min(ids.length, MAX_RANK_DEPTH) };
}
