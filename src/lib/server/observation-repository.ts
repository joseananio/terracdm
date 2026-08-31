import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { riskScoreFromLevel, type Domain, type GeoPoint, type Observation, type Risk } from "../intelligence";
import type { ObservationKind } from "../catalog/types";

/**
 * Server-side observation access.
 *
 * The memory index is the fast path and keeps the application usable without
 * Supabase. When persistence is configured, the repository also reads the
 * canonical observations embedded in the existing intelligence snapshots.
 * This keeps graph and agent retrieval independent from the browser's loaded
 * subset while we retain one canonical observation contract.
 */

export type ObservationQuery = {
  ids?: string[];
  kinds?: ObservationKind[];
  domains?: string[];
  subdomainIds?: string[];
  risk?: Risk;
  sourceIds?: string[];
  query?: string;
  center?: GeoPoint;
  radiusKm?: number;
  limit?: number;
};

export type ObservationQueryResult = {
  observations: Observation[];
  total: number;
  storage: "memory" | "persisted" | "mixed";
};

const MEMORY_MAX_OBSERVATIONS = 20_000;
const PERSISTED_SNAPSHOT_LIMIT = 200;
const PERSISTED_CACHE_TTL_MS = 15_000;
const memoryObservations = new Map<string, Observation>();
let persistedCache: { observations: Observation[]; expiresAt: number } | null = null;

function supabaseServer(): SupabaseClient | null {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
}

function scalarProperties(value: unknown) {
  if (!value || typeof value !== "object") return undefined;
  const properties: Record<string, string | number | boolean | null> = {};
  for (const [key, item] of Object.entries(value)) {
    if (key.length > 80) continue;
    if (typeof item === "string" || typeof item === "number" || typeof item === "boolean" || item === null) properties[key] = item;
    if (Object.keys(properties).length >= 64) break;
  }
  return Object.keys(properties).length ? properties : undefined;
}

function parseObservation(value: unknown): Observation | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  const kind = item.kind === "entity" || item.kind === "signal" ? item.kind : null;
  const id = typeof item.id === "string" ? item.id : "";
  const domain = typeof item.domain === "string" ? item.domain : "";
  const subdomainId = typeof item.subdomainId === "string" ? item.subdomainId : "";
  const name = typeof item.name === "string" ? item.name : "";
  const description = typeof item.description === "string" ? item.description : "";
  const providerId = typeof item.providerId === "string" ? item.providerId : "";
  const observedAt = typeof item.observedAt === "string" ? item.observedAt : "";
  const sourceValue = item.source && typeof item.source === "object" ? item.source as Record<string, unknown> : null;
  const sourceId = typeof sourceValue?.id === "string" ? sourceValue.id : "";
  const sourceName = typeof sourceValue?.name === "string" ? sourceValue.name : "";
  const risk = item.risk === "low" || item.risk === "medium" || item.risk === "high" ? item.risk : null;
  const riskScore = Number(item.riskScore);
  const coordinatesValue = item.location && typeof item.location === "object"
    ? (item.location as Record<string, unknown>).coordinates
    : undefined;
  const coordinates = coordinatesValue && typeof coordinatesValue === "object"
    ? coordinatesValue as Record<string, unknown>
    : null;
  const lat = Number(coordinates?.lat);
  const lng = Number(coordinates?.lng);

  if (!kind || !id || !domain || !subdomainId || !name || !providerId || !observedAt || !sourceId || !sourceName || !risk) return null;
  if (kind === "entity" && (!Number.isFinite(lat) || !Number.isFinite(lng))) return null;

  const locationValue = item.location && typeof item.location === "object" ? item.location as Record<string, unknown> : null;
  const location = {
    coordinates: Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : undefined,
    label: typeof locationValue?.label === "string" ? locationValue.label : undefined,
  };
  const base = {
    id,
    domain: domain as Domain,
    subdomainId,
    name,
    description,
    risk: risk as Risk,
    riskScore: Number.isFinite(riskScore) ? riskScore : riskScoreFromLevel(risk as Risk),
    location,
    source: { id: sourceId, name: sourceName, url: typeof sourceValue?.url === "string" ? sourceValue.url : undefined },
    providerId,
    observedAt,
    url: typeof item.url === "string" ? item.url : undefined,
    imageUrl: typeof item.imageUrl === "string" ? item.imageUrl : undefined,
    properties: scalarProperties(item.properties),
    packId: typeof item.packId === "string" ? item.packId : undefined,
    signalType: typeof item.signalType === "string" ? item.signalType : undefined,
  };

  return kind === "entity"
    ? { ...base, kind, location: { ...location, coordinates: { lat, lng } } }
    : { ...base, kind };
}

function snapshotObservations(payload: unknown) {
  if (!payload || typeof payload !== "object") return [];
  const value = payload as Record<string, unknown>;
  const observations = Array.isArray(value.observations) ? value.observations : Array.isArray(payload) ? payload : [];
  return observations.map(parseObservation).filter((item): item is Observation => Boolean(item));
}

async function persistedObservations() {
  if (persistedCache && persistedCache.expiresAt > Date.now()) return persistedCache.observations;
  const client = supabaseServer();
  if (!client) return [];

  const { data, error } = await client
    .from("intelligence_snapshots")
    .select("payload,fetched_at")
    .order("fetched_at", { ascending: false })
    .limit(PERSISTED_SNAPSHOT_LIMIT);
  if (error || !data) {
    persistedCache = { observations: [], expiresAt: Date.now() + PERSISTED_CACHE_TTL_MS };
    return [];
  }

  const byId = new Map<string, Observation>();
  for (const row of data as Array<{ payload?: unknown }>) {
    for (const observation of snapshotObservations(row.payload)) {
      const previous = byId.get(observation.id);
      if (!previous || observation.observedAt > previous.observedAt) byId.set(observation.id, observation);
    }
  }
  const observations = [...byId.values()];
  persistedCache = { observations, expiresAt: Date.now() + PERSISTED_CACHE_TTL_MS };
  return observations;
}

function distanceKm(left: GeoPoint, right: GeoPoint) {
  const radians = Math.PI / 180;
  const latitude = (right.lat - left.lat) * radians;
  const longitude = (right.lng - left.lng) * radians;
  const a = Math.sin(latitude / 2) ** 2 + Math.cos(left.lat * radians) * Math.cos(right.lat * radians) * Math.sin(longitude / 2) ** 2;
  return 6_371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function matches(observation: Observation, query: ObservationQuery) {
  if (query.ids?.length && !query.ids.includes(observation.id)) return false;
  if (query.kinds?.length && !query.kinds.includes(observation.kind)) return false;
  if (query.domains?.length && !query.domains.some((domain) => domain.toLowerCase() === observation.domain.toLowerCase())) return false;
  if (query.subdomainIds?.length && !query.subdomainIds.includes(observation.subdomainId)) return false;
  if (query.risk && observation.risk !== query.risk) return false;
  if (query.sourceIds?.length && !query.sourceIds.some((sourceId) => sourceId.toLowerCase() === observation.source.id.toLowerCase())) return false;
  if (query.center && query.radiusKm !== undefined) {
    const coordinates = observation.location?.coordinates;
    if (!coordinates || distanceKm(query.center, coordinates) > query.radiusKm) return false;
  }
  const terms = query.query?.toLowerCase().split(/\s+/).filter(Boolean) ?? [];
  if (terms.length) {
    const haystack = [
      observation.name,
      observation.description,
      observation.location?.label,
      observation.domain,
      observation.subdomainId,
      observation.source.id,
      observation.source.name,
      observation.providerId,
      JSON.stringify(observation.properties),
    ].filter(Boolean).join(" ").toLowerCase();
    if (!terms.every((term) => haystack.includes(term))) return false;
  }
  return true;
}

function observationOrder(left: Observation, right: Observation) {
  return right.observedAt.localeCompare(left.observedAt) || right.riskScore - left.riskScore || left.id.localeCompare(right.id);
}

export function ingestObservations(observations: Observation[]) {
  for (const observation of observations) {
    const parsed = parseObservation(observation);
    if (parsed) memoryObservations.set(parsed.id, parsed);
  }
  while (memoryObservations.size > MEMORY_MAX_OBSERVATIONS) {
    const oldest = memoryObservations.keys().next().value;
    if (typeof oldest !== "string") break;
    memoryObservations.delete(oldest);
  }
}

export async function queryObservations(query: ObservationQuery = {}): Promise<ObservationQueryResult> {
  const persisted = await persistedObservations();
  const combined = new Map<string, Observation>();
  for (const observation of persisted) combined.set(observation.id, observation);
  for (const observation of memoryObservations.values()) combined.set(observation.id, observation);
  const filtered = [...combined.values()].filter((observation) => matches(observation, query)).sort(observationOrder);
  const limit = Math.min(Math.max(query.limit ?? 500, 1), 2_000);
  return {
    observations: filtered.slice(0, limit),
    total: filtered.length,
    storage: persisted.length && memoryObservations.size ? "mixed" : persisted.length ? "persisted" : "memory",
  };
}

export async function findObservationById(id: string) {
  const local = memoryObservations.get(id);
  if (local) return local;
  return (await queryObservations({ ids: [id], limit: 1 })).observations[0] ?? null;
}
