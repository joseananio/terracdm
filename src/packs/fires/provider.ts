import type { Entity, ProviderSnapshot, Signal } from "../../lib/intelligence";
import { fetchJson, fetchText, isoTime, locationText, ProviderError } from "../../lib/server/fetch-json";
import type { ProviderImplementation } from "../../lib/catalog/types";
import type { ProviderDefinition, SignalPack } from "../../lib/catalog/types";

type EonetEvent = { id?: string; title?: string; description?: string; categories?: Array<{ title?: string }>; sources?: Array<{ url?: string }>; geometry?: Array<{ date?: string; type?: string; coordinates?: unknown }> };
type FirmsRow = { lat: number; lng: number; brightness: number; date: string; time: string; confidence: string | null; satellite: string | null; dataset: string };

function safeUrl(value: string, fallback?: string) {
  try { return value ? new URL(value, fallback).toString() : fallback; } catch { return fallback; }
}

function firesOutputContext(pack: SignalPack, provider: ProviderDefinition) {
  const signal = pack.signals?.find((item) => item.providerId === provider.id);
  return { domain: pack.domain, providerId: provider.id, signalType: signal?.id, subdomainId: signal?.subdomainId ?? pack.subdomains[0]?.id };
}

async function getEonetFires(context: ReturnType<typeof firesOutputContext>): Promise<ProviderSnapshot> {
  try {
    const data = await fetchJson<{ events?: EonetEvent[] }>("https://eonet.gsfc.nasa.gov/api/v3/events?status=open&limit=200");
    const observations: Array<Entity | Signal> = [];
    for (const event of data.events ?? []) {
      const geometry = event.geometry?.at(-1);
      if (!geometry || geometry.type !== "Point" || !Array.isArray(geometry.coordinates)) continue;
      const [lng, lat] = geometry.coordinates;
      if (typeof lat !== "number" || typeof lng !== "number") continue;
      const category = String(event.categories?.[0]?.title ?? "Wildfire");
      if (!category.toLowerCase().includes("wildfire")) continue;
      const id = `eonet:${event.id ?? `${lat}:${lng}`}`;
      const sourceUrl = event.sources?.map((source) => safeUrl(source.url ?? "")).find(Boolean);
      const observedAt = isoTime(geometry.date);
      const entity: Entity = { id, kind: "entity", domain: context.domain, signalType: context.signalType, subdomainId: context.subdomainId, name: String(event.title ?? category), description: `${category} · ${observedAt.slice(0, 10)}`, risk: "medium", riskScore: 62, location: { coordinates: { lat, lng }, label: locationText(lat, lng) }, source: { id: context.providerId, name: "NASA EONET", url: sourceUrl }, providerId: context.providerId, observedAt, properties: { category, fireKind: "wildfire event", detail: event.description ?? null } };
      observations.push(entity);
      observations.push({ id: `${id}:signal`, kind: "signal", domain: context.domain, signalType: context.signalType, subdomainId: context.subdomainId, name: entity.name, description: category, risk: "medium", riskScore: 62, location: { coordinates: { lat, lng }, label: locationText(lat, lng) }, source: { id: context.providerId, name: "NASA EONET", url: sourceUrl }, providerId: context.providerId, observedAt, url: sourceUrl, properties: { category, fireKind: "wildfire event" } });
    }
    return { domain: context.domain, providerId: context.providerId, source: { id: context.providerId, name: "NASA EONET" }, status: "live", fetchedAt: new Date().toISOString(), observations, nextPollSeconds: 120 };
  } catch (error) {
    throw new ProviderError(error instanceof Error ? error.message : "EONET request failed");
  }
}

const firmsSources = [
  { id: "viirs-snpp", dataset: "VIIRS_SNPP_NRT" }, { id: "viirs-noaa20", dataset: "VIIRS_NOAA20_NRT" }, { id: "viirs-noaa21", dataset: "VIIRS_NOAA21_NRT" }, { id: "modis", dataset: "MODIS_NRT" },
] as const;
const FIRMS_SOURCE_SAMPLE_LIMIT = 1_500;
const FIRMS_VISIBLE_LIMIT = 5_000;
const FIRES_CACHE_TTL_MS = 2 * 60 * 1_000;
let firesCache: { snapshot: ProviderSnapshot; expiresAt: number } | null = null;
let firesFetchPromise: Promise<ProviderSnapshot> | null = null;

function firmsRows(csv: string, dataset: string): FirmsRow[] {
  const [header, ...allRows] = csv.trim().split(/\r?\n/);
  const columns = header?.split(",") ?? [];
  const index = (name: string) => columns.indexOf(name);
  const latitude = index("latitude");
  const longitude = index("longitude");
  if (latitude < 0 || longitude < 0) throw new ProviderError(`FIRMS ${dataset} returned an invalid CSV response`);
  const brightness = index("bright_ti4") >= 0 ? index("bright_ti4") : index("brightness");
  const date = index("acq_date");
  const time = index("acq_time");
  const confidence = index("confidence");
  const satellite = index("satellite");
  const step = Math.max(1, Math.ceil(allRows.length / FIRMS_SOURCE_SAMPLE_LIMIT));
  const rows: FirmsRow[] = [];
  for (let rowIndex = 0; rowIndex < allRows.length; rowIndex += step) {
    const cells = allRows[rowIndex].split(",");
    const lat = Number(cells[latitude]);
    const lng = Number(cells[longitude]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    rows.push({ lat, lng, brightness: Number(cells[brightness]) || 0, date: date >= 0 ? cells[date] ?? "" : "", time: time >= 0 ? cells[time] ?? "0000" : "0000", confidence: confidence >= 0 ? cells[confidence] ?? null : null, satellite: satellite >= 0 ? cells[satellite] ?? null : null, dataset });
  }
  return rows;
}

async function loadFirms(context: ReturnType<typeof firesOutputContext>): Promise<ProviderSnapshot> {
  const mapKey = process.env.FIRMS_MAP_KEY?.trim() || process.env.FIRMS_API_KEY?.trim();
  if (!mapKey) return { domain: context.domain, providerId: context.providerId, source: { id: context.providerId, name: "NASA FIRMS" }, status: "key_required", fetchedAt: new Date().toISOString(), observations: [], error: "FIRMS_MAP_KEY is required for NASA FIRMS hotspot data", nextPollSeconds: 300 };
  const results = await Promise.allSettled(firmsSources.map(async (source) => ({ source, rows: firmsRows(await fetchText(`https://firms.modaps.eosdis.nasa.gov/api/area/csv/${encodeURIComponent(mapKey)}/${source.dataset}/world/1`), source.dataset) })));
  const errors = results.flatMap((result) => result.status === "rejected" ? [result.reason instanceof Error ? result.reason.message : "FIRMS request failed"] : []);
  const uniqueRows = new Map<string, FirmsRow>();
  for (const result of results) if (result.status === "fulfilled") for (const row of result.value.rows) {
    const key = `${row.lat.toFixed(3)}:${row.lng.toFixed(3)}:${row.date}:${row.time}`;
    const existing = uniqueRows.get(key);
    if (!existing || row.brightness > existing.brightness) uniqueRows.set(key, row);
  }
  const rows = [...uniqueRows.values()].slice(0, FIRMS_VISIBLE_LIMIT);
  if (!rows.length) {
    return { domain: context.domain, providerId: context.providerId, source: { id: context.providerId, name: "NASA FIRMS" }, status: "degraded", fetchedAt: new Date().toISOString(), observations: [], error: errors.length ? errors.join("; ") : "NASA FIRMS returned no hotspot rows", nextPollSeconds: 120 };
  }
  const observations: Entity[] = rows.map((row, rowIndex) => ({ id: `firms:${row.dataset}:${rowIndex}:${row.lat}:${row.lng}`, kind: "entity", domain: context.domain, signalType: context.signalType, subdomainId: context.subdomainId, name: `FIRMS hotspot ${rowIndex + 1}`, description: `${row.date || "—"} · brightness ${row.brightness || "—"}`, risk: "medium", riskScore: 50, location: { coordinates: { lat: row.lat, lng: row.lng }, label: locationText(row.lat, row.lng) }, source: { id: context.providerId, name: "NASA FIRMS", url: `https://firms.modaps.eosdis.nasa.gov/map/#d:24hrs;@${row.lng.toFixed(3)},${row.lat.toFixed(3)},9z` }, providerId: context.providerId, observedAt: isoTime(`${row.date}T${row.time}`), properties: { confidence: row.confidence, satellite: row.satellite, dataset: row.dataset, brightness: row.brightness, fireKind: "thermal hotspot" } }));
  return { domain: context.domain, providerId: context.providerId, source: { id: context.providerId, name: "NASA FIRMS" }, status: errors.length ? "degraded" : "live", fetchedAt: new Date().toISOString(), observations, error: errors.length ? `${errors.length} FIRMS dataset${errors.length === 1 ? "" : "s"} unavailable` : undefined, nextPollSeconds: 120 };
}

export const firesEonetProviderImplementation: ProviderImplementation = async ({ pack, provider }) => {
  const context = firesOutputContext(pack, provider);
  if (firesCache && firesCache.expiresAt > Date.now()) return firesCache.snapshot;
  if (!firesFetchPromise) {
    firesFetchPromise = getEonetFires(context).then((result) => {
      if (result.observations.some((observation) => observation.kind === "entity")) firesCache = { snapshot: result, expiresAt: Date.now() + FIRES_CACHE_TTL_MS };
      return result;
    }).finally(() => { firesFetchPromise = null; });
  }
  return firesFetchPromise;
};

let firmsCache: { snapshot: ProviderSnapshot; expiresAt: number } | null = null;
let firmsFetchPromise: Promise<ProviderSnapshot> | null = null;

export const firesFirmsProviderImplementation: ProviderImplementation = async ({ pack, provider }) => {
  const context = firesOutputContext(pack, provider);
  if (firmsCache && firmsCache.expiresAt > Date.now()) return firmsCache.snapshot;
  if (!firmsFetchPromise) {
    firmsFetchPromise = loadFirms(context).then((result) => {
      if (result.observations.some((observation) => observation.kind === "entity")) firmsCache = { snapshot: result, expiresAt: Date.now() + FIRES_CACHE_TTL_MS };
      return result;
    }).finally(() => { firmsFetchPromise = null; });
  }
  return firmsFetchPromise;
};
