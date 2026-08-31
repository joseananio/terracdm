import { riskFromScore, type Entity, type ProviderSnapshot, type Signal } from "../../lib/intelligence";
import { fetchJson, isoTime, locationText, ProviderError } from "../../lib/server/fetch-json";
import type { ProviderImplementation } from "../../lib/catalog/types";

type ConflictTuple = readonly [string, string, number, number, number, string];
const staticConflict: readonly ConflictTuple[] = [
  ["ukraine", "Ukraine conflict theater", 49.0, 32.0, 82, "Interstate conflict following Russia’s invasion of Ukraine; monitor front-line and infrastructure reporting."], ["gaza", "Gaza conflict theater", 31.4, 34.4, 88, "Armed conflict and humanitarian crisis centered on Gaza and the surrounding Israel–Palestine theater."], ["sudan", "Sudan conflict theater", 15.5, 32.5, 84, "Civil war between the SAF and RSF with severe humanitarian and displacement risk."], ["myanmar", "Myanmar conflict theater", 21.9, 95.9, 72, "Multi-front conflict between the military junta and armed resistance groups."], ["drc", "DRC conflict theater", -2.9, 23.7, 69, "Armed-group violence and displacement risk, concentrated in eastern provinces."], ["yemen", "Yemen conflict theater", 15.4, 48.5, 76, "Civil conflict and Red Sea security risk involving the Houthis and regional actors."], ["syria", "Syria conflict theater", 35.0, 38.0, 68, "Fragmented conflict theater with cross-border strikes and multiple armed actors."], ["lebanon", "Lebanon tension theater", 33.85, 35.86, 71, "Israel–Hezbollah border tension and spillover risk from the wider Gaza conflict."], ["sahel", "Sahel insecurity theater", 14.5, 0.5, 66, "Insurgent violence and political instability across the central Sahel."], ["somalia", "Somalia insecurity theater", 5.2, 46.2, 64, "Al-Shabaab insurgency and persistent security risk around population centers and routes."], ["red-sea", "Red Sea tension corridor", 15.0, 42.0, 73, "Maritime security risk around the Bab el-Mandeb and Red Sea shipping lanes."], ["taiwan", "Taiwan Strait tension", 24.4, 119.8, 61, "Cross-strait military and political tension around Taiwan and adjacent waters."], ["korea", "Korean Peninsula tension", 38.2, 127.3, 55, "Inter-Korean military tension and elevated regional deterrence risk."],
];
function conflictEntities(domain: string, theaterSubdomain: string): Entity[] {
  return staticConflict.map(([id, name, lat, lng, risk, detail]) => ({ id: `${domain}:${id}`, kind: "entity", domain, subdomainId: theaterSubdomain, name, description: detail, risk: riskFromScore(risk), riskScore: risk, location: { coordinates: { lat, lng }, label: name }, source: { id: "conflict-baseline", name: "OSINT baseline" }, providerId: "conflict-baseline", observedAt: new Date().toISOString(), properties: { detail, baseline: true } }));
}

type AcledEvent = { event_id_cnty?: string | number; event_id_no_cnty?: string | number; event_date?: string; event_type?: string; sub_event_type?: string; actor1?: string; actor2?: string; country?: string; admin1?: string; location?: string; latitude?: string | number; longitude?: string | number; fatalities?: string | number };
const ACLED_TOKEN_TTL_MS = (24 * 60 - 5) * 60 * 1_000;
const ACLED_SNAPSHOT_CACHE_TTL_MS = 2 * 60 * 1_000;
const acledEnabled = process.env.ACLED_ENABLED === "true";
let acledToken: { value: string; expiresAt: number } | null = null;
let acledTokenPromise: Promise<string> | null = null;
let conflictSnapshotCache: { snapshot: ProviderSnapshot; expiresAt: number } | null = null;
let conflictSnapshotFetchPromise: Promise<ProviderSnapshot> | null = null;

async function getAcledToken() {
  const username = process.env.ACLED_USERNAME?.trim();
  const password = process.env.ACLED_PASSWORD;
  if (!username || !password) throw new ProviderError("ACLED_USERNAME and ACLED_PASSWORD are not configured", 401, "key_required");
  if (acledToken && acledToken.expiresAt > Date.now()) return acledToken.value;
  if (!acledTokenPromise) {
    acledTokenPromise = fetchJson<{ access_token?: string }>("https://acleddata.com/oauth/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "password", client_id: "acled", scope: "authenticated", username, password }) }, 15_000).then((response) => {
      if (!response.access_token) throw new ProviderError("ACLED OAuth response did not contain an access token", 401, "key_required");
      acledToken = { value: response.access_token, expiresAt: Date.now() + ACLED_TOKEN_TTL_MS };
      return acledToken.value;
    }).finally(() => { acledTokenPromise = null; });
  }
  return acledTokenPromise;
}

function acledRisk(event: AcledEvent) {
  const fatalities = Math.max(0, Number(event.fatalities ?? 0));
  const violent = /battle|explosions|violence/i.test(`${event.event_type ?? ""} ${event.sub_event_type ?? ""}`);
  return Math.min(100, 42 + (violent ? 18 : 0) + Math.min(40, fatalities * 4));
}

function acledEntities(domain: string, eventSubdomain: string, events: AcledEvent[]) {
  const entities: Entity[] = [];
  const signals: Signal[] = [];
  for (const [index, event] of events.entries()) {
    const lat = Number(event.latitude);
    const lng = Number(event.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const id = String(event.event_id_cnty ?? event.event_id_no_cnty ?? `${event.event_date ?? "unknown"}:${lat}:${lng}:${index}`);
    const observedAt = isoTime(event.event_date);
    const eventType = String(event.sub_event_type ?? event.event_type ?? "Conflict event");
    const country = String(event.country ?? "Unknown country");
    const place = String(event.location ?? event.admin1 ?? country);
    const fatalities = Math.max(0, Number(event.fatalities ?? 0));
    const detail = [eventType, place, fatalities ? `${fatalities} reported fatalities` : null].filter(Boolean).join(" · ");
    const risk = acledRisk(event);
    const entity: Entity = { id: `acled:${id}`, kind: "entity", domain, subdomainId: eventSubdomain, name: `${eventType} · ${country}`, description: detail, risk: riskFromScore(risk), riskScore: risk, location: { coordinates: { lat, lng }, label: place }, source: { id: "acled", name: "ACLED", url: "https://acleddata.com/acled-api-documentation" }, providerId: "acled", observedAt, url: "https://acleddata.com/acled-api-documentation", properties: { eventId: id, eventType: String(event.event_type ?? "Conflict"), subEventType: eventType, country, admin1: event.admin1 ?? null, location: event.location ?? null, actor1: event.actor1 ?? null, actor2: event.actor2 ?? null, fatalities } };
    entities.push(entity);
    signals.push({ id: `${entity.id}:signal`, kind: "signal", domain, subdomainId: eventSubdomain, name: entity.name, description: detail, risk: riskFromScore(risk), riskScore: risk, location: { coordinates: { lat, lng }, label: locationText(lat, lng) }, source: { id: "acled", name: "ACLED", url: entity.source.url }, providerId: "acled", observedAt, url: entity.url, properties: { eventId: id, fatalities, eventType: String(event.event_type ?? "Conflict") } });
  }
  return { entities, signals };
}

async function loadConflict(context: { domain: string; theaterSubdomain: string; eventSubdomain: string; provider: { sourceId?: string; id: string; label: string; pollSeconds?: number } }): Promise<ProviderSnapshot> {
  const baseline = conflictEntities(context.domain, context.theaterSubdomain);
  if (!acledEnabled) return { domain: context.domain, providerId: "conflict-baseline", source: { id: "conflict-baseline", name: "OSINT baseline" }, status: "cached", fetchedAt: new Date().toISOString(), observations: [...baseline, ...baseline.map((entity) => ({ id: `${entity.id}:signal`, kind: "signal" as const, domain: context.domain, subdomainId: entity.subdomainId, name: entity.name, description: entity.description, risk: entity.risk, riskScore: entity.riskScore, location: entity.location, source: entity.source, providerId: entity.providerId, observedAt: new Date().toISOString(), properties: { baseline: true } }))], nextPollSeconds: context.provider.pollSeconds ?? 300 };
  try {
    const token = await getAcledToken();
    const endDate = new Date();
    const startDate = new Date(endDate.getTime() - 14 * 24 * 60 * 60 * 1_000);
    const params = new URLSearchParams({ event_type: "Battles|Explosions/Remote violence|Violence against civilians", event_date: `${startDate.toISOString().slice(0, 10)}|${endDate.toISOString().slice(0, 10)}`, event_date_where: "BETWEEN", limit: "500", _format: "json" });
    const response = await fetchJson<{ data?: AcledEvent[] }>(`https://acleddata.com/api/acled/read?${params}`, { headers: { authorization: `Bearer ${token}` } }, 15_000);
    const live = acledEntities(context.domain, context.eventSubdomain, response.data ?? []);
    return { domain: context.domain, providerId: "acled", source: { id: "acled", name: "ACLED conflict events + theater baseline" }, status: "live", fetchedAt: new Date().toISOString(), observations: [...baseline, ...live.entities, ...live.signals], error: live.entities.length ? undefined : "ACLED returned no geolocated conflict events in the requested window", nextPollSeconds: context.provider.pollSeconds ?? 120 };
  } catch (error) {
    return { domain: context.domain, providerId: "conflict-baseline", source: { id: "conflict-baseline", name: "ACLED unavailable · theater baseline" }, status: "degraded", fetchedAt: new Date().toISOString(), observations: baseline, error: error instanceof Error ? error.message : "ACLED request failed", nextPollSeconds: context.provider.pollSeconds ?? 120 };
  }
}

export const conflictProviderImplementation: ProviderImplementation = async ({ pack, provider }) => {
  if (conflictSnapshotCache && conflictSnapshotCache.expiresAt > Date.now()) return conflictSnapshotCache.snapshot;
  if (!conflictSnapshotFetchPromise) {
    const theaterSubdomain = pack.signals?.find((signal) => signal.providerId === provider.id)?.subdomainId ?? pack.subdomains[0]?.id ?? "";
    const eventSubdomain = pack.subdomains.find((subdomain) => subdomain.id !== theaterSubdomain)?.id ?? theaterSubdomain;
    conflictSnapshotFetchPromise = loadConflict({ domain: pack.domain, theaterSubdomain, eventSubdomain, provider }).then((result) => {
      conflictSnapshotCache = { snapshot: result, expiresAt: Date.now() + ACLED_SNAPSHOT_CACHE_TTL_MS };
      return result;
    }).finally(() => { conflictSnapshotFetchPromise = null; });
  }
  return conflictSnapshotFetchPromise;
};
