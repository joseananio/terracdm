import { riskFromScore, type Entity, type ProviderSnapshot, type Signal } from "../../lib/intelligence";
import { fetchJson, fetchText, isoTime } from "../../lib/server/fetch-json";
import type { ProviderImplementation } from "../../lib/catalog/types";
import * as satellite from "satellite.js";

type SatelliteTle = { name: string; line1: string; line2: string; noradId: number };
type TleApiRecord = { satelliteId?: number; name?: string; line1?: string; line2?: string };
type TleApiResponse = { member?: TleApiRecord[] };
type SpaceClass = "starlink-comms" | "military-intel" | "gps-navigation" | "earth-observation" | "stations-telescopes" | "other";

const celestrakGroups = ["active", "stations", "gps-ops", "glonass-operational", "galileo", "beidou", "oneweb", "iridium-NEXT", "globalstar", "orbcomm", "other-comm", "x-comm", "weather", "resource", "sarsat", "planet", "goes", "science", "military", "radar", "geodetic", "tdrss", "geo", "cubesat", "tle-new", "amateur", "last-30-days", "visual", "supplemental", "nnss", "musson"].map((group) => `https://celestrak.org/NORAD/elements/gp.php?GROUP=${group}&FORMAT=tle`);
const starlinkCelestrakUrl = "https://celestrak.org/NORAD/elements/gp.php?GROUP=starlink&FORMAT=tle";
const SATELLITE_VISIBLE_LIMIT = 5_000;
const SATELLITE_COMMS_RESERVE = 3_000;
const STARLINK_CANDIDATE_LIMIT = SATELLITE_COMMS_RESERVE * 2;
const STARLINK_FALLBACK_PAGE_SIZE = 100;
const STARLINK_FALLBACK_PAGE_COUNT = Math.ceil(STARLINK_CANDIDATE_LIMIT / STARLINK_FALLBACK_PAGE_SIZE);
const satelliteTleCache: { fetchedAt: number; tles: SatelliteTle[] } = { fetchedAt: 0, tles: [] };
const starlinkTleCache: { fetchedAt: number; tles: SatelliteTle[] } = { fetchedAt: 0, tles: [] };
const SATELLITE_TLE_CACHE_TTL_MS = 60 * 60 * 1_000;
const SATELLITE_POSITION_CACHE_TTL_MS = 60_000;
let satelliteTleFetchPromise: Promise<SatelliteTle[]> | null = null;
let starlinkTleFetchPromise: Promise<SatelliteTle[]> | null = null;
let satellitePositionCache: { entities: Entity[]; expiresAt: number } | null = null;
let satellitePositionFetchPromise: Promise<Entity[]> | null = null;

function parseTleText(text: string): SatelliteTle[] {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const tles: SatelliteTle[] = [];
  for (let index = 0; index < lines.length - 1;) {
    const hasName = index + 2 < lines.length && lines[index + 1].startsWith("1 ") && lines[index + 2].startsWith("2 ");
    const line1 = hasName ? lines[index + 1] : lines[index];
    const line2 = hasName ? lines[index + 2] : lines[index + 1];
    if (!line1.startsWith("1 ") || !line2.startsWith("2 ")) { index += 1; continue; }
    const noradId = Number(line1.slice(2, 7).trim());
    if (Number.isFinite(noradId)) tles.push({ name: hasName ? lines[index] : `SAT-${noradId}`, line1, line2, noradId });
    index += hasName ? 3 : 2;
  }
  return tles;
}

function classifySatellite(name: string): SpaceClass {
  const upper = name.toUpperCase();
  if (/STARLINK|ONEWEB|IRIDIUM|GLOBALSTAR|ORBCOMM|INTELSAT|SES[- ]|INMARSAT|EUTELSAT|COMM/.test(upper)) return "starlink-comms";
  if (/ISS|TIANGONG|HUBBLE|JAMES WEBB|JWST|SPACE STATION|TELESCOPE/.test(upper)) return "stations-telescopes";
  if (/GPS|NAVSTAR|GLONASS|GALILEO|BEIDOU|NAVIGATION/.test(upper)) return "gps-navigation";
  if (/USA|NROL|LACROSSE|MENTOR|ORION|TRUMPET|SBIRS|DSP|COSMOS|YAOGAN|MILITARY|NOSS|ONYX|RECON|SIGINT/.test(upper)) return "military-intel";
  if (/PLANET|WORLDVIEW|LANDSAT|SENTINEL|TERRA|AQUA|FENGYUN|GOES|METEOSAT|NOAA|CARTOSAT|RADARSAT|PLEIADES|KOMPSAT|EARTH|RESOURCE|SPOT/.test(upper)) return "earth-observation";
  return "other";
}

async function fetchCelestrakTles(url: string, timeoutMs = 15_000, attempts = 1) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const text = await fetchText(url, { headers: { accept: "text/plain", "user-agent": "TerraCDM/0.2 satellite-tracker" } }, timeoutMs);
      return text.includes("has not updated since") ? [] : parseTleText(text);
    } catch {
      if (attempt < attempts - 1) await new Promise((resolve) => setTimeout(resolve, 750 * (attempt + 1)));
    }
  }
  return [];
}

async function fetchSatnogsTles() {
  try {
    const data = await fetchJson<Array<{ tle0?: string; tle1?: string; tle2?: string }>>("https://db.satnogs.org/api/tle/?format=json");
    return data.flatMap((item) => item.tle1 && item.tle2 ? parseTleText(`${item.tle0 ?? ""}\n${item.tle1}\n${item.tle2}`) : []);
  } catch { return []; }
}

function mergeSatelliteTles(...groups: SatelliteTle[][]) {
  const merged = new Map<number, SatelliteTle>();
  for (const tles of groups) for (const tle of tles) merged.set(tle.noradId, tle);
  return [...merged.values()];
}

async function fetchStarlinkFallbackTles() {
  const pages = Array.from({ length: STARLINK_FALLBACK_PAGE_COUNT }, (_, index) => index + 1);
  const batches: number[][] = [];
  for (let index = 0; index < pages.length; index += 10) batches.push(pages.slice(index, index + 10));
  const tles: SatelliteTle[] = [];
  for (const batch of batches) {
    const results = await Promise.all(batch.map(async (page) => {
      const url = new URL("https://tle.ivanstanojevic.me/api/tle");
      url.searchParams.set("search", "STARLINK");
      url.searchParams.set("page-size", String(STARLINK_FALLBACK_PAGE_SIZE));
      url.searchParams.set("page", String(page));
      return fetchJson<TleApiResponse>(url.toString()).catch(() => ({ member: [] }));
    }));
    for (const result of results) for (const item of result.member ?? []) {
      const noradId = Number(item.satelliteId);
      if (/STARLINK/i.test(item.name ?? "") && Number.isFinite(noradId) && item.line1 && item.line2) tles.push({ name: item.name!, line1: item.line1, line2: item.line2, noradId });
    }
  }
  return mergeSatelliteTles(tles);
}

async function getStarlinkTles() {
  const cacheIsFresh = starlinkTleCache.tles.length >= STARLINK_CANDIDATE_LIMIT && Date.now() - starlinkTleCache.fetchedAt < SATELLITE_TLE_CACHE_TTL_MS;
  if (cacheIsFresh) return starlinkTleCache.tles;
  if (!starlinkTleFetchPromise) {
    starlinkTleFetchPromise = fetchCelestrakTles(starlinkCelestrakUrl, 20_000).then((tles) => tles.length >= STARLINK_CANDIDATE_LIMIT ? tles : fetchStarlinkFallbackTles()).then((tles) => {
      if (tles.length > 0) { starlinkTleCache.tles = tles; starlinkTleCache.fetchedAt = Date.now(); }
      return tles.length > 0 ? tles : starlinkTleCache.tles;
    }).finally(() => { starlinkTleFetchPromise = null; });
  }
  return starlinkTleFetchPromise;
}

async function getSatelliteTles() {
  const cacheIsFresh = satelliteTleCache.tles.length > 0 && Date.now() - satelliteTleCache.fetchedAt < SATELLITE_TLE_CACHE_TTL_MS;
  if (cacheIsFresh) return mergeSatelliteTles(satelliteTleCache.tles, await getStarlinkTles());
  if (!satelliteTleFetchPromise) {
    satelliteTleFetchPromise = (async () => {
      const starlinkTles = await getStarlinkTles();
      const results = await Promise.all(celestrakGroups.map((url) => fetchCelestrakTles(url)));
      let tles = mergeSatelliteTles(...results, starlinkTles);
      if (tles.length < 500) tles = mergeSatelliteTles(await fetchSatnogsTles(), tles, starlinkTles);
      if (tles.length > 0) { satelliteTleCache.tles = tles; satelliteTleCache.fetchedAt = Date.now(); }
      return tles.length > 0 ? tles : satelliteTleCache.tles;
    })().finally(() => { satelliteTleFetchPromise = null; });
  }
  return satelliteTleFetchPromise;
}

async function loadSatellites(domain: string) {
  const tle = await getSatelliteTles();
  const observedAt = new Date().toISOString();
  const now = new Date();
  const entities: Entity[] = [];
  const starlink = tle.filter((item) => /STARLINK/i.test(item.name));
  const otherCommunications = tle.filter((item) => !/STARLINK/i.test(item.name) && classifySatellite(item.name) === "starlink-comms");
  const remaining = tle.filter((item) => !/STARLINK/i.test(item.name) && classifySatellite(item.name) !== "starlink-comms");
  const selectedTles = [...starlink.slice(0, STARLINK_CANDIDATE_LIMIT), ...otherCommunications.slice(0, SATELLITE_COMMS_RESERVE), ...remaining.slice(0, SATELLITE_VISIBLE_LIMIT - SATELLITE_COMMS_RESERVE)];
  let starlinkCount = 0;
  let otherCount = 0;
  for (const item of selectedTles) {
    try {
      const isStarlink = /STARLINK/i.test(item.name);
      if (isStarlink ? starlinkCount >= SATELLITE_COMMS_RESERVE : otherCount >= SATELLITE_VISIBLE_LIMIT - SATELLITE_COMMS_RESERVE) continue;
      const satrec = satellite.twoline2satrec(item.line1, item.line2);
      const position = satellite.propagate(satrec, now);
      if (!position || typeof position === "boolean" || !position.position) continue;
      const geodetic = satellite.eciToGeodetic(position.position, satellite.gstime(now));
      const lat = satellite.degreesLat(geodetic.latitude);
      const lng = satellite.degreesLong(geodetic.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      const altitude = geodetic.height;
      const spaceClass = classifySatellite(item.name);
      entities.push({ id: `satellite:${item.noradId}`, kind: "entity", domain, subdomainId: spaceClass, name: item.name, description: `${altitude.toFixed(0)} km orbit · NORAD ${item.noradId}`, risk: riskFromScore(10), riskScore: 10, location: { coordinates: { lat, lng }, label: item.name }, source: { id: "celestrak", name: "CelesTrak", url: "https://celestrak.org/" }, providerId: "celestrak", observedAt, url: "https://celestrak.org/", properties: { noradId: item.noradId, altitudeKm: Number(altitude.toFixed(1)), spaceClass } });
      if (isStarlink) starlinkCount += 1; else otherCount += 1;
    } catch { /* malformed TLEs are skipped; the feed remains authoritative */ }
  }
  return entities;
}

async function getSatellites(domain: string) {
  if (satellitePositionCache && satellitePositionCache.expiresAt > Date.now()) return satellitePositionCache.entities.map((entity) => ({ ...entity, domain }));
  if (!satellitePositionFetchPromise) {
    satellitePositionFetchPromise = loadSatellites(domain).then((entities) => { if (entities.length > 0) satellitePositionCache = { entities, expiresAt: Date.now() + SATELLITE_POSITION_CACHE_TTL_MS }; return entities; }).finally(() => { satellitePositionFetchPromise = null; });
  }
  return satellitePositionFetchPromise;
}

type NoaaKpSample = { kp_index?: string | number; Kp?: string | number; time_tag?: string };
type NoaaAlert = { product_id?: string; issue_datetime?: string; message?: string };
type NoaaFlare = { max_class?: string; begin_time?: string; peak_time?: string; end_time?: string };
type SpaceWeatherFeeds = { solar: PromiseSettledResult<Array<Array<string | number>>>; kp: PromiseSettledResult<NoaaKpSample[]>; alerts: PromiseSettledResult<NoaaAlert[]>; flares: PromiseSettledResult<NoaaFlare[]> };
const SPACE_WEATHER_CACHE_TTL_MS = 5 * 60 * 1_000;
const SPACE_WEATHER_ERROR_CACHE_TTL_MS = 60_000;
let spaceWeatherCache: { feeds: SpaceWeatherFeeds; expiresAt: number } | null = null;
let spaceWeatherFetchPromise: Promise<SpaceWeatherFeeds> | null = null;

async function getSpaceWeatherFeeds(): Promise<SpaceWeatherFeeds> {
  if (spaceWeatherCache && spaceWeatherCache.expiresAt > Date.now()) return spaceWeatherCache.feeds;
  if (!spaceWeatherFetchPromise) {
    spaceWeatherFetchPromise = Promise.allSettled([
      fetchJson<Array<Array<string | number>>>("https://services.swpc.noaa.gov/products/geospace/propagated-solar-wind-1-hour.json"), fetchJson<NoaaKpSample[]>("https://services.swpc.noaa.gov/json/planetary_k_index_1m.json"), fetchJson<NoaaAlert[]>("https://services.swpc.noaa.gov/json/alerts.json"), fetchJson<NoaaFlare[]>("https://services.swpc.noaa.gov/json/goes/primary/xray-flares-latest.json"),
    ]).then(([solar, kp, alerts, flares]) => { const feeds: SpaceWeatherFeeds = { solar, kp, alerts, flares }; const hasLiveFeed = [solar, kp, alerts, flares].some((feed) => feed.status === "fulfilled"); spaceWeatherCache = { feeds, expiresAt: Date.now() + (hasLiveFeed ? SPACE_WEATHER_CACHE_TTL_MS : SPACE_WEATHER_ERROR_CACHE_TTL_MS) }; return feeds; }).finally(() => { spaceWeatherFetchPromise = null; });
  }
  return spaceWeatherFetchPromise;
}

export const spaceProviderImplementation: ProviderImplementation = async ({ pack, provider }) => {
  const weatherSubdomain = pack.signals?.find((signal) => signal.providerId === provider.id)?.subdomainId ?? pack.subdomains[0]?.id;
  const [weather, satellites] = await Promise.all([getSpaceWeatherFeeds(), getSatellites(pack.domain).then((value) => ({ status: "fulfilled", value }) as const).catch((reason) => ({ status: "rejected", reason }) as const)]);
  const { solar, kp, alerts, flares } = weather;
  const entities: Entity[] = [];
  const signals: Signal[] = [];
  if (solar.status === "fulfilled") {
    const latest = solar.value.at(-1); const speed = Number(latest?.[1]); const density = Number(latest?.[2]);
    const observedAt = isoTime(latest?.[0]);
    const riskScore = Number.isFinite(speed) ? Math.min(100, Math.round(speed / 8)) : 0;
    const entity: Entity = { id: "noaa:solar-wind", kind: "entity", domain: pack.domain, subdomainId: weatherSubdomain, name: "NOAA solar wind monitor", description: `density ${Number.isFinite(density) ? density.toFixed(1) : "—"} p/cm³ · speed ${Number.isFinite(speed) ? speed.toFixed(0) : "—"} km/s`, risk: riskFromScore(riskScore), riskScore, location: { coordinates: { lat: 0, lng: 0 }, label: "Heliographic monitor" }, source: { id: "noaa-swpc", name: "NOAA SWPC", url: "https://www.swpc.noaa.gov/" }, providerId: provider.id, observedAt, url: "https://www.swpc.noaa.gov/", properties: { density, speed } };
    entities.push(entity); signals.push({ id: "noaa:solar-wind:signal", kind: "signal", domain: pack.domain, subdomainId: weatherSubdomain, name: "Solar wind sample received", description: entity.description, risk: entity.risk, riskScore, location: { label: "Heliographic monitor" }, source: { id: "noaa-swpc", name: "NOAA SWPC", url: "https://www.swpc.noaa.gov/" }, providerId: provider.id, observedAt, url: "https://www.swpc.noaa.gov/", properties: { density, speed } });
  }
  if (kp.status === "fulfilled") { const latest = kp.value.at(-1); const kpIndex = Number(latest?.kp_index ?? latest?.Kp ?? 0); const observedAt = isoTime(latest?.time_tag); const riskScore = kpIndex >= 5 ? 80 : kpIndex >= 3 ? 50 : 20; signals.push({ id: "noaa:kp:signal", kind: "signal", domain: pack.domain, subdomainId: weatherSubdomain, name: `Geomagnetic Kp ${Number.isFinite(kpIndex) ? kpIndex.toFixed(1) : "—"}`, description: kpIndex >= 5 ? "Geomagnetic storm threshold reached" : "Solar activity monitor", risk: riskFromScore(riskScore), riskScore, location: { label: "Global geomagnetic index" }, source: { id: "noaa-swpc", name: "NOAA SWPC", url: "https://www.swpc.noaa.gov/" }, providerId: provider.id, observedAt, url: "https://www.swpc.noaa.gov/", properties: { kpIndex } }); }
  if (alerts.status === "fulfilled") for (const [index, alert] of alerts.value.slice(0, 10).entries()) { const observedAt = isoTime(alert.issue_datetime); signals.push({ id: `noaa:alert:${alert.product_id ?? index}`, kind: "signal", domain: pack.domain, subdomainId: weatherSubdomain, name: alert.product_id ?? "NOAA space-weather alert", description: String(alert.message ?? "").slice(0, 240), risk: "medium", riskScore: 50, location: { label: "NOAA SWPC" }, source: { id: "noaa-swpc", name: "NOAA SWPC", url: "https://www.swpc.noaa.gov/" }, providerId: provider.id, observedAt, url: "https://www.swpc.noaa.gov/", properties: { issueDatetime: alert.issue_datetime ?? null } }); }
  if (flares.status === "fulfilled") for (const [index, flare] of flares.value.slice(0, 5).entries()) { const observedAt = isoTime(flare.peak_time ?? flare.begin_time); const riskScore = /^(X|M)/i.test(flare.max_class ?? "") ? 80 : 50; signals.push({ id: `noaa:flare:${flare.peak_time ?? index}`, kind: "signal", domain: pack.domain, subdomainId: weatherSubdomain, name: `Solar flare ${flare.max_class ?? "detected"}`, description: `peak ${flare.peak_time ?? "—"}`, risk: riskFromScore(riskScore), riskScore, location: { label: "GOES solar monitor" }, source: { id: "noaa-goes", name: "NOAA GOES", url: "https://www.swpc.noaa.gov/" }, providerId: provider.id, observedAt, url: "https://www.swpc.noaa.gov/", properties: { flareClass: flare.max_class ?? null, begin: flare.begin_time ?? null, peak: flare.peak_time ?? null, end: flare.end_time ?? null } }); }
  if (satellites.status === "fulfilled") entities.push(...satellites.value);
  const errors = [solar, kp, alerts, flares, satellites].map((item) => item.status === "rejected" ? String(item.reason) : "").filter(Boolean);
  const snapshot: ProviderSnapshot = { domain: pack.domain, providerId: provider.id, source: { id: provider.sourceId ?? provider.id, name: provider.label }, status: !entities.length && !signals.length ? "degraded" : errors.length ? "degraded" : "live", fetchedAt: new Date().toISOString(), observations: [...entities, ...signals], error: errors.join("; ") || (!entities.length && !signals.length ? "Space providers unavailable" : undefined), nextPollSeconds: provider.pollSeconds ?? 300 };
  return snapshot;
};
