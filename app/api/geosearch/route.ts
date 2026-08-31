import { NextRequest, NextResponse } from "next/server";
import type { GeosearchKind, GeosearchResult } from "@/src/lib/geosearch";
import { fetchJson } from "@/src/lib/server/fetch-json";

export const runtime = "nodejs";

type PhotonFeature = {
  geometry?: { coordinates?: unknown };
  bbox?: unknown;
  properties?: Record<string, unknown>;
};
type PhotonResponse = { features?: PhotonFeature[] };
type NominatimResult = {
  place_id?: number | string;
  lat?: string;
  lon?: string;
  display_name?: string;
  boundingbox?: string[];
  addresstype?: string;
  category?: string;
  type?: string;
  name?: string;
};

const RESULT_LIMIT = 6;
const CACHE_TTL_MS = 5 * 60 * 1_000;
const CACHE_MAX_ENTRIES = 100;
const cache = new Map<string, { results: GeosearchResult[]; expiresAt: number }>();
const inFlight = new Map<string, Promise<GeosearchResult[]>>();
let nextNominatimRequestAt = 0;

function placeKind(values: Array<unknown>): GeosearchKind {
  const value = values.filter(Boolean).join(" ").toLowerCase();
  if (/\bcountry\b/.test(value)) return "country";
  if (/\b(state|region|province|county|district|administrative|boundary)\b/.test(value)) return "region";
  if (/\b(city|town|village|municipality|suburb|hamlet|locality)\b/.test(value)) return "city";
  if (/\b(address|house|street|road|residential|building)\b/.test(value)) return "address";
  return "poi";
}

function detail(parts: Array<unknown>) {
  return [...new Set(parts.map((part) => String(part ?? "").trim()).filter(Boolean))].join(" · ");
}

function photonResult(feature: PhotonFeature, index: number): GeosearchResult | null {
  const coordinates = feature.geometry?.coordinates;
  if (!Array.isArray(coordinates) || !Number.isFinite(coordinates[0]) || !Number.isFinite(coordinates[1])) return null;
  const properties = feature.properties ?? {};
  const name = String(properties.name ?? properties.label ?? "").trim();
  if (!name) return null;
  const kind = placeKind([properties.osm_key, properties.osm_value, properties.type]);
  const bbox = feature.bbox;
  const bounds = Array.isArray(bbox) && bbox.length === 4 && bbox.every((value) => Number.isFinite(value))
    ? [Number(bbox[0]), Number(bbox[1]), Number(bbox[2]), Number(bbox[3])] as [number, number, number, number]
    : undefined;
  return {
    id: `photon:${String(properties.osm_id ?? `${coordinates[0]}:${coordinates[1]}:${index}`)}`,
    label: name,
    detail: detail([properties.city, properties.state, properties.country, properties.postcode]),
    kind,
    coordinates: [Number(coordinates[0]), Number(coordinates[1])],
    bounds,
    source: "photon",
  };
}

function nominatimResult(result: NominatimResult, index: number): GeosearchResult | null {
  const lng = Number(result.lon);
  const lat = Number(result.lat);
  if (!Number.isFinite(lng) || !Number.isFinite(lat) || !result.display_name) return null;
  const bounds = result.boundingbox?.length === 4 && result.boundingbox.every((value) => Number.isFinite(Number(value)))
    ? [Number(result.boundingbox[2]), Number(result.boundingbox[0]), Number(result.boundingbox[3]), Number(result.boundingbox[1])] as [number, number, number, number]
    : undefined;
  const [label, ...rest] = result.display_name.split(",");
  return {
    id: `nominatim:${String(result.place_id ?? `${lng}:${lat}:${index}`)}`,
    label: result.name?.trim() || label.trim(),
    detail: rest.map((part) => part.trim()).filter(Boolean).slice(0, 3).join(" · "),
    kind: placeKind([result.addresstype, result.category, result.type]),
    coordinates: [lng, lat],
    bounds,
    source: "nominatim",
  };
}

function unique(results: GeosearchResult[]) {
  const seen = new Set<string>();
  return results.filter((result) => {
    const key = `${result.kind}:${result.label.toLowerCase()}:${result.coordinates[0].toFixed(3)}:${result.coordinates[1].toFixed(3)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, RESULT_LIMIT);
}

async function searchPlaces(query: string) {
  const photonUrl = new URL("https://photon.komoot.io/api/");
  photonUrl.searchParams.set("q", query);
  photonUrl.searchParams.set("limit", String(RESULT_LIMIT));
  photonUrl.searchParams.set("lang", "en");
  const photon = await fetchJson<PhotonResponse>(photonUrl.toString(), { headers: { "user-agent": "TerraCDM geosearch" } }, 8_000)
    .then((result) => (result.features ?? []).map(photonResult).filter((item): item is GeosearchResult => Boolean(item)))
    .catch(() => []);

  // Nominatim supplements Photon, but the public service is deliberately
  // rate-limited so client type-ahead never turns into an upstream request fan-out.
  if (Date.now() < nextNominatimRequestAt) return unique(photon);
  nextNominatimRequestAt = Date.now() + 1_100;
  const nominatimUrl = new URL("https://nominatim.openstreetmap.org/search");
  nominatimUrl.searchParams.set("q", query);
  nominatimUrl.searchParams.set("format", "jsonv2");
  nominatimUrl.searchParams.set("addressdetails", "1");
  nominatimUrl.searchParams.set("limit", String(RESULT_LIMIT));
  const nominatim = await fetchJson<NominatimResult[]>(nominatimUrl.toString(), { headers: { "accept-language": "en", "user-agent": "TerraCDM geosearch" } }, 8_000)
    .then((result) => result.map(nominatimResult).filter((item): item is GeosearchResult => Boolean(item)))
    .catch(() => []);
  return unique([...photon, ...nominatim]);
}

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("q")?.trim().replace(/\s+/g, " ") ?? "";
  if (query.length < 2) return NextResponse.json({ results: [] }, { headers: { "cache-control": "no-store" } });

  const key = query.toLocaleLowerCase();
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return NextResponse.json({ results: cached.results }, { headers: { "cache-control": "no-store" } });

  if (!inFlight.has(key)) {
    inFlight.set(key, searchPlaces(query).then((results) => {
      if (cache.size >= CACHE_MAX_ENTRIES) cache.delete(cache.keys().next().value as string);
      cache.set(key, { results, expiresAt: Date.now() + CACHE_TTL_MS });
      return results;
    }).finally(() => { inFlight.delete(key); }));
  }
  return NextResponse.json({ results: await inFlight.get(key)! }, { headers: { "cache-control": "no-store" } });
}
