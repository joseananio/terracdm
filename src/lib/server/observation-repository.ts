import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { riskScoreFromLevel, type Domain, type GeoPoint, type Observation, type Risk } from "../intelligence";
import type { ObservationKind } from "../catalog/types";

/**
 * Server-side observation access.
 *
 * The memory index keeps the application usable without Supabase. Persisted
 * reads use normalized, indexed observation rows; snapshot JSON is history,
 * not a query index.
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
  viewport?: { west: number; south: number; east: number; north: number };
  cursor?: string;
  limit?: number;
};

export type ObservationQueryResult = {
  observations: Observation[];
  total: number;
  storage: "memory" | "persisted" | "mixed";
  nextCursor?: string;
};

const MEMORY_MAX_OBSERVATIONS = 20_000;
const memoryObservations = new Map<string, Observation>();

type ObservationCursor = { observedAt: string; riskScore: number; id: string };
type PersistedObservationRow = { payload?: unknown; has_more?: boolean };

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

function encodeCursor(observation: Observation) {
  return Buffer.from(JSON.stringify({ observedAt: observation.observedAt, riskScore: observation.riskScore, id: observation.id } satisfies ObservationCursor)).toString("base64url");
}

function decodeCursor(value?: string): ObservationCursor | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Partial<ObservationCursor>;
    if (typeof parsed.observedAt !== "string" || !Number.isFinite(Date.parse(parsed.observedAt)) || !Number.isFinite(parsed.riskScore) || typeof parsed.id !== "string" || !parsed.id) return null;
    return { observedAt: parsed.observedAt, riskScore: Number(parsed.riskScore), id: parsed.id };
  } catch {
    return null;
  }
}

async function persistedObservationPage(query: ObservationQuery, limit: number, cursor: ObservationCursor | null) {
  const client = supabaseServer();
  if (!client) return { observations: [] as Observation[], total: 0, hasMore: false, available: false };

  const { data, error } = await client.rpc("query_intelligence_observations", {
    p_ids: query.ids?.length ? query.ids : null,
    p_kinds: query.kinds?.length ? query.kinds : null,
    p_domains: query.domains?.length ? query.domains.map((domain) => domain.toLowerCase()) : null,
    p_subdomain_ids: query.subdomainIds?.length ? query.subdomainIds : null,
    p_risk: query.risk ?? null,
    p_source_ids: query.sourceIds?.length ? query.sourceIds.map((sourceId) => sourceId.toLowerCase()) : null,
    p_query: query.query?.trim() || null,
    p_center_lat: query.center?.lat ?? null,
    p_center_lng: query.center?.lng ?? null,
    p_radius_km: query.center && query.radiusKm !== undefined ? query.radiusKm : null,
    p_west: query.viewport?.west ?? null,
    p_south: query.viewport?.south ?? null,
    p_east: query.viewport?.east ?? null,
    p_north: query.viewport?.north ?? null,
    p_cursor_observed_at: cursor?.observedAt ?? null,
    p_cursor_risk_score: cursor?.riskScore ?? null,
    p_cursor_id: cursor?.id ?? null,
    p_limit: limit,
  });
  if (error || !data) return { observations: [] as Observation[], total: 0, hasMore: false, available: false };

  const rows = data as PersistedObservationRow[];
  const observations = rows.map((row) => parseObservation(row.payload)).filter((observation): observation is Observation => Boolean(observation));
  const hasMore = Boolean(rows[0]?.has_more);
  return {
    observations,
    total: observations.length + (hasMore ? 1 : 0),
    hasMore,
    available: true,
  };
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
  if (query.viewport) {
    const coordinates = observation.location?.coordinates;
    if (!coordinates || coordinates.lat < query.viewport.south || coordinates.lat > query.viewport.north) return false;
    const longitudeMatches = query.viewport.west <= query.viewport.east
      ? coordinates.lng >= query.viewport.west && coordinates.lng <= query.viewport.east
      : coordinates.lng >= query.viewport.west || coordinates.lng <= query.viewport.east;
    if (!longitudeMatches) return false;
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

function followsCursor(observation: Observation, cursor: ObservationCursor | null) {
  if (!cursor) return true;
  if (observation.observedAt !== cursor.observedAt) return observation.observedAt < cursor.observedAt;
  if (observation.riskScore !== cursor.riskScore) return observation.riskScore < cursor.riskScore;
  return observation.id > cursor.id;
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
  const limit = Math.min(Math.max(query.limit ?? 500, 1), 2_000);
  const cursor = decodeCursor(query.cursor);
  const persisted = await persistedObservationPage(query, limit, cursor);
  const memoryMatches = [...memoryObservations.values()]
    .filter((observation) => matches(observation, query) && followsCursor(observation, cursor))
    .sort(observationOrder);
  const combined = new Map<string, Observation>();
  for (const observation of persisted.observations) combined.set(observation.id, observation);
  for (const observation of memoryMatches) combined.set(observation.id, observation);
  const combinedObservations = [...combined.values()].sort(observationOrder);
  const observations = combinedObservations.slice(0, limit);
  const total = Math.max(persisted.total, memoryMatches.length, combinedObservations.length);
  const hasMore = persisted.hasMore || combinedObservations.length > observations.length;
  return {
    observations,
    total,
    storage: persisted.observations.length && memoryMatches.length ? "mixed" : persisted.observations.length ? "persisted" : "memory",
    nextCursor: hasMore && observations.length ? encodeCursor(observations.at(-1)!) : undefined,
  };
}

export async function findObservationById(id: string) {
  const local = memoryObservations.get(id);
  if (local) return local;
  return (await queryObservations({ ids: [id], limit: 1 })).observations[0] ?? null;
}
