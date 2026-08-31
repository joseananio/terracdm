import { riskFromScore, riskScoreFromLevel, type CanonicalProviderSnapshot, type Entity, type Observation, type ProviderSnapshot, type Risk, type Signal, type SourceStatus } from "../intelligence";
import { matchesCatalogPredicate, readCatalogPath, resolveCatalogValue } from "./value";
import type { CatalogValue, ProviderImplementation, ProviderImplementationContext, ProviderCachePolicy, ProviderDefinition, ProviderLocationMapping, ProviderMapping, ProviderRequest, ProviderViewport } from "./types";
import { getSignalPack } from "./registry";
import { normalizeProviderSnapshot } from "./observations";
import { getProviderImplementation } from "../server/pack-registry";
import "../server/catalog-assembly";

type CachedProviderSnapshot = {
  snapshot: CanonicalProviderSnapshot;
  expiresAt: number;
  staleUntil: number;
};

const DEFAULT_CACHE_POLICY: ProviderCachePolicy = { maxAgeSeconds: 60, staleIfErrorSeconds: 300 };
const PROVIDER_CACHE_MAX_ENTRIES = 250;
const providerCache = new Map<string, CachedProviderSnapshot>();
const providerInFlight = new Map<string, Promise<CanonicalProviderSnapshot>>();

function envValue(name: string) {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : undefined;
}

function endpointFor(provider: ProviderDefinition) {
  if (!provider.endpoint) throw new Error(`Provider ${provider.id} is missing an endpoint`);
  const url = new URL(provider.endpoint);
  if (provider.auth?.query) {
    const value = envValue(provider.auth.env);
    if (value) url.searchParams.set(provider.auth.query, value);
  }
  return url;
}

function requestHeaders(provider: ProviderDefinition) {
  const headers: Record<string, string> = { accept: "application/json", "user-agent": "TerraCDM signal-pack runtime" };
  if (provider.auth?.header) {
    const value = envValue(provider.auth.env);
    if (value) headers[provider.auth.header] = value;
  }
  return headers;
}

function asNumber(value: unknown, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function asString(value: unknown, fallback = "") {
  return value === undefined || value === null ? fallback : String(value);
}

function mappedProperties(input: unknown, mapping: Record<string, CatalogValue> | undefined) {
  return Object.fromEntries(Object.entries(mapping ?? {}).map(([key, value]) => [key, resolveCatalogValue(input, value)]));
}

function mappedSignalLocation(input: unknown, mapping: CatalogValue | ProviderLocationMapping | undefined) {
  if (!mapping) return undefined;
  if (typeof mapping === "object" && mapping !== null && "lat" in mapping && "lng" in mapping) {
    const lat = asNumber(resolveCatalogValue(input, mapping.lat), NaN);
    const lng = asNumber(resolveCatalogValue(input, mapping.lng), NaN);
    return Number.isFinite(lat) && Number.isFinite(lng)
      ? { coordinates: { lat, lng }, label: mapping.label ? asString(resolveCatalogValue(input, mapping.label)) : undefined }
      : undefined;
  }
  return { label: asString(resolveCatalogValue(input, mapping as CatalogValue), "Unknown") };
}

function risk(value: unknown): Risk {
  if (value === "high" || value === "medium" || value === "low") return value;
  return riskFromScore(asNumber(value));
}

function scoreForRisk(value: unknown, explicitScore?: number) {
  if (explicitScore !== undefined && Number.isFinite(explicitScore)) return explicitScore;
  const numericValue = asNumber(value, NaN);
  return Number.isFinite(numericValue) ? numericValue : riskScoreFromLevel(risk(value));
}

function itemsFromPayload(payload: unknown, path?: string) {
  const value = path ? readCatalogPath(payload, path) : payload;
  return Array.isArray(value) ? value : value && typeof value === "object" ? [value] : [];
}

function csvRows(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const next = text[index + 1];
    if (character === '"' && quoted && next === '"') { cell += '"'; index += 1; continue; }
    if (character === '"') { quoted = !quoted; continue; }
    if (character === "," && !quoted) { row.push(cell.trim()); cell = ""; continue; }
    if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && next === "\n") index += 1;
      row.push(cell.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      cell = "";
      continue;
    }
    cell += character;
  }
  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  const headers = rows.shift() ?? [];
  return rows.map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])));
}

function xmlText(block: string, tag: string) {
  const match = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
  return match?.[1]?.replace(/<!\[CDATA\[|\]\]>/g, "").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').trim() ?? "";
}

function rssItems(text: string) {
  const blocks = text.match(/<(?:item|entry)\b[\s\S]*?<\/(?:item|entry)>/gi) ?? [];
  return blocks.map((block) => ({
    id: xmlText(block, "guid") || xmlText(block, "id") || xmlText(block, "link"),
    title: xmlText(block, "title"),
    description: xmlText(block, "description") || xmlText(block, "summary") || xmlText(block, "content"),
    link: xmlText(block, "link"),
    pubDate: xmlText(block, "pubDate") || xmlText(block, "published") || xmlText(block, "updated"),
    location: xmlText(block, "location"),
  }));
}

function mappedSnapshot(context: ProviderImplementationContext, payload: unknown, mapping: ProviderMapping): ProviderSnapshot {
  const fetchedAt = new Date().toISOString();
  const items = itemsFromPayload(payload, mapping.itemsPath);
  const observations: Array<Entity | Signal> = [];

  for (const item of items) {
    const signalDefinition = context.pack.signals?.find((candidate) => candidate.providerId === context.provider.id && (!mapping.signalType || candidate.id === mapping.signalType) && (!candidate.when || matchesCatalogPredicate(item, candidate.when)));
    if (context.pack.signals?.length && !signalDefinition && mapping.signal) continue;
    if (mapping.entity) {
      const entity = mapping.entity;
      const lat = asNumber(resolveCatalogValue(item, entity.location.lat), NaN);
      const lng = asNumber(resolveCatalogValue(item, entity.location.lng), NaN);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      const riskScore = entity.riskScore ? asNumber(resolveCatalogValue(item, entity.riskScore), NaN) : undefined;
      const mappedRisk = entity.risk ? resolveCatalogValue(item, entity.risk) : riskScore;
      observations.push({
        id: asString(resolveCatalogValue(item, entity.id), `${context.provider.id}:${observations.length}`),
        kind: "entity",
        domain: context.provider.domain,
        subdomainId: signalDefinition?.subdomainId ?? context.pack.subdomains[0].id,
        name: asString(resolveCatalogValue(item, entity.name), context.provider.label),
        description: asString(entity.description ? resolveCatalogValue(item, entity.description) : "", "Live provider observation"),
        risk: risk(mappedRisk),
        riskScore: scoreForRisk(mappedRisk, riskScore),
        location: { coordinates: { lat, lng }, label: entity.location.label ? asString(resolveCatalogValue(item, entity.location.label)) : undefined },
        source: { id: context.provider.sourceId ?? context.provider.id, name: context.provider.label },
        providerId: context.provider.id,
        observedAt: entity.observedAt ? asString(resolveCatalogValue(item, entity.observedAt)) : fetchedAt,
        url: entity.url ? asString(resolveCatalogValue(item, entity.url)) : undefined,
        signalType: signalDefinition?.id ?? mapping.signalType,
        properties: mappedProperties(item, entity.properties),
      });
    }
    if (mapping.signal) {
      const signal = mapping.signal;
      const signalScore = signal.riskScore ? asNumber(resolveCatalogValue(item, signal.riskScore), NaN) : undefined;
      const mappedRisk = signal.risk ? resolveCatalogValue(item, signal.risk) : signalScore;
      observations.push({
        id: asString(resolveCatalogValue(item, signal.id), `${context.provider.id}:signal:${observations.length}`),
        kind: "signal",
        domain: context.provider.domain,
        subdomainId: signalDefinition?.subdomainId ?? context.pack.subdomains[0].id,
        name: asString(resolveCatalogValue(item, signal.name), context.provider.label),
        description: asString(resolveCatalogValue(item, signal.description), "Provider signal"),
        risk: risk(mappedRisk),
        riskScore: scoreForRisk(mappedRisk, signalScore),
        location: mappedSignalLocation(item, signal.location),
        source: { id: context.provider.sourceId ?? context.provider.id, name: context.provider.label },
        providerId: context.provider.id,
        observedAt: signal.observedAt ? asString(resolveCatalogValue(item, signal.observedAt), fetchedAt) : fetchedAt,
        signalType: signalDefinition?.id ?? mapping.signalType,
        url: signal.url ? asString(resolveCatalogValue(item, signal.url)) : undefined,
        properties: mappedProperties(item, signal.properties),
      });
    }
  }

  return {
    domain: context.provider.domain,
    providerId: context.provider.id,
    source: { id: context.provider.sourceId ?? context.provider.id, name: context.provider.label },
    status: "live",
    fetchedAt,
    observations,
    nextPollSeconds: context.provider.pollSeconds ?? 60,
  };
}

async function declarativeProvider(context: ProviderImplementationContext): Promise<ProviderSnapshot> {
  const response = await fetch(endpointFor(context.provider), { headers: requestHeaders(context.provider), signal: AbortSignal.timeout(15_000), cache: "no-store" });
  if (!response.ok) throw new Error(`${context.provider.label} returned HTTP ${response.status}`);
  const providerKind = context.provider.type;
  const mapping = { ...(context.provider.mapping ?? {}) };
  if (providerKind === "rss") return mappedSnapshot(context, rssItems(await response.text()), mapping);
  if (providerKind === "csv") return mappedSnapshot(context, csvRows(await response.text()), mapping);
  const payload = await response.json() as unknown;
  if (providerKind === "geojson" && !mapping.itemsPath) mapping.itemsPath = "features";
  return mappedSnapshot(context, payload, mapping);
}

function cachePolicy(provider: ProviderDefinition): ProviderCachePolicy {
  return provider.cache ?? { maxAgeSeconds: provider.pollSeconds ?? DEFAULT_CACHE_POLICY.maxAgeSeconds, staleIfErrorSeconds: DEFAULT_CACHE_POLICY.staleIfErrorSeconds };
}

function inViewport(observation: Observation, viewport: ProviderViewport) {
  const coordinates = observation.location?.coordinates;
  if (!coordinates) return true;
  const longitudeMatches = viewport.west <= viewport.east
    ? coordinates.lng >= viewport.west && coordinates.lng <= viewport.east
    : coordinates.lng >= viewport.west || coordinates.lng <= viewport.east;
  return longitudeMatches && coordinates.lat >= viewport.south && coordinates.lat <= viewport.north;
}

function filterToViewport(snapshot: CanonicalProviderSnapshot, viewport?: ProviderViewport): CanonicalProviderSnapshot {
  if (!viewport) return snapshot;
  return { ...snapshot, observations: snapshot.observations.filter((observation) => inViewport(observation, viewport)) };
}

function roundedViewport(viewport: ProviderViewport, zoom?: number): ProviderViewport {
  const precision = zoom === undefined || zoom < 5 ? 1 : zoom < 8 ? 0.25 : 0.05;
  const down = (value: number) => Math.floor(value / precision) * precision;
  const up = (value: number) => Math.ceil(value / precision) * precision;
  return {
    west: down(viewport.west),
    south: down(viewport.south),
    east: up(viewport.east),
    north: up(viewport.north),
  };
}

function cacheKey(provider: ProviderDefinition, request: ProviderRequest) {
  if (provider.coverage !== "viewport" || !request.viewport) return `${provider.id}:global`;
  const viewport = roundedViewport(request.viewport, request.zoom);
  return `${provider.id}:viewport:${viewport.west},${viewport.south},${viewport.east},${viewport.north}`;
}

function cacheResult(key: string, snapshot: CanonicalProviderSnapshot, policy: ProviderCachePolicy) {
  const now = Date.now();
  providerCache.set(key, {
    snapshot,
    expiresAt: now + policy.maxAgeSeconds * 1_000,
    staleUntil: now + (policy.maxAgeSeconds + (policy.staleIfErrorSeconds ?? 0)) * 1_000,
  });
  while (providerCache.size > PROVIDER_CACHE_MAX_ENTRIES) providerCache.delete(providerCache.keys().next().value as string);
}

function cachedSnapshot(snapshot: CanonicalProviderSnapshot): CanonicalProviderSnapshot {
  return snapshot.status === "error" || snapshot.status === "key_required" ? snapshot : { ...snapshot, status: "cached" };
}

async function loadProvider(provider: ProviderDefinition, request: ProviderRequest): Promise<CanonicalProviderSnapshot> {
  if (provider.enabled === false) {
    return {
      domain: provider.domain,
      providerId: provider.id,
      source: { id: provider.sourceId ?? provider.id, name: provider.label },
      status: "unavailable",
      fetchedAt: new Date().toISOString(),
      observations: [],
      packId: provider.domain,
      error: "Provider disabled by instance configuration",
      nextPollSeconds: provider.pollSeconds ?? 60,
    };
  }
  const key = cacheKey(provider, request);
  const policy = cachePolicy(provider);
  const now = Date.now();
  const cached = providerCache.get(key);
  if (cached && cached.expiresAt > now) {
    providerCache.delete(key);
    providerCache.set(key, cached);
    return cachedSnapshot(cached.snapshot);
  }

  const inFlight = providerInFlight.get(key);
  if (inFlight) return inFlight;

  const task = (async () => {
    const pack = getSignalPack(provider.domain);
    if (!pack) throw new Error(`No signal pack registered for provider domain ${provider.domain}`);
    const context: ProviderImplementationContext = {
      pack,
      provider,
      request: provider.coverage === "viewport" && request.viewport
        ? { ...request, viewport: roundedViewport(request.viewport, request.zoom) }
        : request,
    };
    const implementation: ProviderImplementation | undefined = provider.type === "code"
      ? provider.implementation ? getProviderImplementation(provider.implementation) : undefined
      : declarativeProvider;
    if (!implementation) throw new Error(`No provider implementation registered for ${provider.implementation ?? provider.type}`);
    try {
      const result = normalizeProviderSnapshot(await implementation(context), pack, provider);
      if (result.status !== "error" && result.status !== "key_required") cacheResult(key, result, policy);
      return result;
    } catch (error) {
      const stale = providerCache.get(key);
      if (stale && stale.staleUntil > Date.now()) {
        return {
          ...stale.snapshot,
          status: "degraded" as const,
          error: `${error instanceof Error ? error.message : "Provider failed"}; serving stale cached data`,
        };
      }
      throw error;
    }
  })().finally(() => { providerInFlight.delete(key); });

  providerInFlight.set(key, task);
  return task;
}

export async function runProvider(provider: ProviderDefinition, request: ProviderRequest = {}): Promise<CanonicalProviderSnapshot> {
  return filterToViewport(await loadProvider(provider, request), request.viewport);
}

export function providerErrorSnapshot(provider: ProviderDefinition, error: unknown): CanonicalProviderSnapshot {
  return {
    domain: provider.domain,
    providerId: provider.id,
    source: { id: provider.sourceId ?? provider.id, name: provider.label },
    status: "error" as SourceStatus,
    fetchedAt: new Date().toISOString(),
    observations: [],
    packId: provider.domain,
    error: error instanceof Error ? error.message : "Provider failed",
    nextPollSeconds: provider.pollSeconds ?? 60,
  };
}
