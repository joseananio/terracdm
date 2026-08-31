import { riskFromScore, type Entity, type ProviderSnapshot, type Signal, type SourceStatus } from "../../lib/intelligence";
import { fetchJson, isoTime, ProviderError } from "../../lib/server/fetch-json";
import type { ProviderImplementation } from "../../lib/catalog/types";

const aviationSnapshot = (domain: string, sourceId: string, source: string, status: SourceStatus, entities: Entity[], signals: Signal[], error?: string): ProviderSnapshot => ({
  domain, providerId: sourceId, source: { id: sourceId, name: source }, status, observations: [...entities, ...signals], fetchedAt: new Date().toISOString(), error, nextPollSeconds: status === "live" ? 60 : 300,
});

type OpenSkyState = (string | number | null)[];
type AircraftClass = "commercial" | "private" | "private-jets" | "military";
type AdsbAircraft = { hex?: string; flight?: string; r?: string; t?: string; lat?: number; lon?: number; alt_baro?: number | string; alt_geom?: number; altitudeMeters?: number; gs?: number; track?: number; seen_pos?: number; squawk?: string; category?: string; aircraftClass?: AircraftClass };
type AdsbResponse = { ac?: AdsbAircraft[]; now?: number; msg?: string };

let openskyToken: { value: string; expiresAt: number } | null = null;
let openskyCooldownUntil = 0;
const OPENSKY_COOLDOWN_MS = 15 * 60 * 1_000;
const AVIATION_CACHE_TTL_MS = 2 * 60 * 1_000;
let aviationCache: { snapshot: ProviderSnapshot; expiresAt: number } | null = null;
let aviationFetchPromise: Promise<ProviderSnapshot> | null = null;

async function openSkyAuthorization() {
  const clientId = process.env.OPENSKY_CLIENT_ID;
  const clientSecret = process.env.OPENSKY_CLIENT_SECRET;
  if (!clientId || !clientSecret) return undefined;
  if (openskyToken && openskyToken.expiresAt > Date.now() + 60_000) return `Bearer ${openskyToken.value}`;
  const token = await fetchJson<{ access_token?: string; expires_in?: number }>("https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: clientId, client_secret: clientSecret }),
  });
  if (!token.access_token) throw new ProviderError("OpenSky OAuth token was not returned", 401, "key_required");
  openskyToken = { value: token.access_token, expiresAt: Date.now() + Math.max(60, Number(token.expires_in ?? 1800) - 60) * 1_000 };
  return `Bearer ${openskyToken.value}`;
}

const militaryCallsigns = /^(RCH|REACH|DUKE|NAVY|ARMY|USAF|AIR|EVAC|JAKE|COBRA|VIPER|HAWK|FORTE|NATO|RRR|GAF|ASCOT|MASCOT|CNV|CFC|COSTA|PAT|TOPCAT|KNIGHT|KING|RFR|BAF|GAF|MMF|IAM|CWL|SHF|HUNTER|DEMON)/i;
const commercialCallsign = /^[A-Z]{3}\d{1,5}[A-Z]?$/i;
const registrationCallsign = /^[A-Z0-9-]{2,8}$/i;

function classifyAircraft(item: AdsbAircraft, callsign: string): AircraftClass {
  if (item.aircraftClass) return item.aircraftClass;
  if (militaryCallsigns.test(callsign.replace(/\s+/g, ""))) return "military";
  if (item.category === "military" || item.category === "military-aircraft") return "military";
  if (item.r && registrationCallsign.test(callsign) && !commercialCallsign.test(callsign)) return "private-jets";
  if (commercialCallsign.test(callsign)) return "commercial";
  return item.r ? "private-jets" : "private";
}

function aircraftEntity(domain: string, item: AdsbAircraft, sourceId: string, observedAt: string): Entity | null {
  const icao = String(item.hex ?? "").trim().toLowerCase();
  const lat = Number(item.lat);
  const lng = Number(item.lon);
  if (!icao || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const altitude = Number.isFinite(item.altitudeMeters) ? Number(item.altitudeMeters) : typeof item.alt_baro === "number" ? item.alt_baro * 0.3048 : Number(item.alt_geom ?? 0) * 0.3048;
  const callsign = String(item.flight ?? item.r ?? icao).trim() || icao;
  const aircraftClass = classifyAircraft(item, callsign);
  const emergency = item.squawk === "7700" || item.squawk === "7600" || item.squawk === "7500";
  const riskScore = emergency ? 72 : aircraftClass === "military" ? 34 : 12;
  return { id: `${sourceId}:${icao}`, kind: "entity", domain, subdomainId: aircraftClass, name: callsign, description: `${item.t ?? "aircraft"} · ${Math.round(altitude || 0)} m`, risk: riskFromScore(riskScore), riskScore, location: { coordinates: { lat, lng }, label: callsign }, source: { id: sourceId, name: sourceId, url: `https://globe.adsbexchange.com/?icao=${encodeURIComponent(icao)}` }, providerId: sourceId, observedAt, url: `https://globe.adsbexchange.com/?icao=${encodeURIComponent(icao)}`, properties: { icao24: icao, registration: item.r ?? null, aircraftType: item.t ?? null, aircraftClass, altitudeM: Math.round(altitude || 0), onGround: item.alt_baro === "ground", velocity: Number(item.gs ?? 0) * 0.514444, heading: Number(item.track ?? 0), squawk: item.squawk ?? null, category: item.category ?? null, positionAgeSeconds: Number(item.seen_pos ?? 0) } };
}

function adsbTimestamp(value: number | undefined) {
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp)) return new Date().toISOString();
  return isoTime(timestamp > 100_000_000_000 ? timestamp : timestamp * 1_000);
}

async function getOpenSkyFlights(domain: string) {
  if (Date.now() < openskyCooldownUntil) {
    const remainingMinutes = Math.ceil((openskyCooldownUntil - Date.now()) / 60_000);
    throw new ProviderError(`OpenSky is cooling down after a rate limit (${remainingMinutes} min remaining)`, 429, "cooldown");
  }
  const url = "https://opensky-network.org/api/states/all?lamin=-60&lamax=80&lomin=-180&lomax=180";
  try {
    const authorization = await openSkyAuthorization();
    const data = await fetchJson<{ time?: number; states?: OpenSkyState[] }>(url, authorization ? { headers: { authorization } } : undefined, 8_000);
    const observedAt = isoTime((data.time ?? Date.now() / 1000) * 1000);
    const entities = (data.states ?? []).slice(0, 5000).flatMap((state) => {
      const entity = aircraftEntity(domain, { hex: String(state[0] ?? ""), flight: String(state[1] ?? ""), lat: Number(state[6]), lon: Number(state[5]), altitudeMeters: Number(state[7]), gs: Number(state[9] ?? 0) * 1.94384, track: Number(state[10] ?? 0), category: String(state[17] ?? "") }, "opensky", observedAt);
      if (entity) entity.properties = { ...entity.properties, onGround: Boolean(state[8]), velocity: Number(state[9] ?? 0), heading: Number(state[10] ?? 0) };
      return entity ? [entity] : [];
    });
    if (!entities.length) throw new ProviderError("OpenSky returned no aircraft positions", 204, "empty");
    return aviationSnapshot(domain, "opensky", authorization ? "OpenSky Network · authenticated" : "OpenSky Network · anonymous", "live", entities, []);
  } catch (error) {
    if (error instanceof ProviderError && error.statusCode === 429) openskyCooldownUntil = Date.now() + OPENSKY_COOLDOWN_MS;
    throw error;
  }
}

const adsbSpecialtyFeeds: Array<{ path: string; aircraftClass: AircraftClass }> = [
  { path: "mil", aircraftClass: "military" },
  { path: "ladd", aircraftClass: "private" },
  { path: "pia", aircraftClass: "private-jets" },
  { path: "squawk/7700", aircraftClass: "commercial" },
];

async function getSpecialtyAdsbFlights(domain: string, sourceId: "airplanes-live" | "adsb-lol", baseUrl: string, source: string) {
  const results = await Promise.allSettled(adsbSpecialtyFeeds.map(async ({ path, aircraftClass }) => {
    const data = await fetchJson<AdsbResponse>(`${baseUrl}/${path}`, undefined, 6_000);
    const observedAt = adsbTimestamp(data.now);
    return (data.ac ?? []).flatMap((item) => {
      const entity = aircraftEntity(domain, { ...item, aircraftClass }, sourceId, observedAt);
      return entity ? [entity] : [];
    });
  }));
  const entities = new Map<string, Entity>();
  const errors: string[] = [];
  for (const result of results) {
    if (result.status === "fulfilled") {
      for (const entity of result.value) entities.set(entity.id, entity);
    } else {
      errors.push(result.reason instanceof Error ? result.reason.message : "specialty feed failed");
    }
  }
  if (!entities.size) throw new ProviderError(`${source} returned no specialty aircraft${errors.length ? ` (${errors.join(", ")})` : ""}`, 204, "empty");
  return aviationSnapshot(domain, sourceId, `${source} · ADS-B specialty feeds`, errors.length ? "degraded" : "live", [...entities.values()], [], errors.length ? `${errors.length} specialty feed${errors.length === 1 ? "" : "s"} failed` : undefined);
}

// Airplanes.live and ADSB.lol point endpoints are only a fallback to the
// authenticated global OpenSky feed. Keep the regions geographically even so
// an outage does not collapse the map into a few hub-city clusters.
const fallbackCities: Array<[number, number]> = [
  [50.0379, 8.5622], // Frankfurt (replaces Berlin)
  [40.7128, -74.006], // New York
  [34.0522, -118.2437], // Los Angeles
  [51.5072, -0.1276], // London
  [25.2048, 55.2708], // Dubai
  [35.6762, 139.6503], // Tokyo
  [39.9042, 116.4074], // Beijing
];
const fallbackGrid = [-45, -20, 5, 30, 55]
  .flatMap((lat) => [-150, -90, -30, 30, 90, 150].map((lng) => [lat, lng] as [number, number]));
const defaultFallbackAirspace = [...fallbackGrid, ...fallbackCities];
const configuredFallbackAirspace = process.env.AVIATION_FALLBACK_REGIONS?.trim();
const fallbackAirspace = (configuredFallbackAirspace || defaultFallbackAirspace.map(([lat, lng]) => `${lat},${lng}`).join(";"))
  .split(";")
  .map((value) => value.split(",").map(Number) as [number, number])
  .filter(([lat, lng]) => Number.isFinite(lat) && Number.isFinite(lng) && lat >= -60 && lat <= 80 && lng >= -180 && lng <= 180);

async function getAdsbFlights(domain: string, sourceId: "airplanes-live" | "adsb-lol", baseUrl: string, source: string) {
  const entities = new Map<string, Entity>();
  const errors: string[] = [];
  const deadline = Date.now() + 8_000;
  for (const [index, [lat, lng]] of fallbackAirspace.entries()) {
    if (index > 0) {
      const remaining = deadline - Date.now();
      if (remaining <= 1_050) break;
      await new Promise((resolve) => setTimeout(resolve, 1_050));
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    try {
      const data = await fetchJson<AdsbResponse>(`${baseUrl}/point/${lat}/${lng}/250`, undefined, Math.min(3_000, remaining));
      const observedAt = adsbTimestamp(data.now);
      for (const item of data.ac ?? []) {
        const entity = aircraftEntity(domain, item, sourceId, observedAt);
        if (entity) entities.set(entity.id, entity);
      }
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "region request failed");
    }
  }
  if (!entities.size) throw new ProviderError(`${source} returned no aircraft${errors.length ? ` (${errors.join(", ")})` : ""}`, 204, "empty");
  return aviationSnapshot(domain, sourceId, `${source} · keyless regional ADS-B`, errors.length ? "degraded" : "live", [...entities.values()], [], errors.length ? `${errors.length} regional request${errors.length === 1 ? "" : "s"} failed` : undefined);
}



function mergeAviationEntities(snapshots: ProviderSnapshot[]) {
  const entities = new Map<string, Entity>();
  for (const item of snapshots) {
    for (const entity of item.observations.filter((observation): observation is Entity => observation.kind === "entity")) {
      const icao = String(entity.properties?.icao24 ?? entity.id).toLowerCase();
      if (!entities.has(icao)) entities.set(icao, entity);
    }
  }
  return [...entities.values()];
}

async function loadFlights(domain: string): Promise<ProviderSnapshot> {
  const [openSky, airplanesSpecialty, adsbSpecialty] = await Promise.allSettled([
    getOpenSkyFlights(domain),
    getSpecialtyAdsbFlights(domain, "airplanes-live", "https://api.airplanes.live/v2", "Airplanes.live"),
    getSpecialtyAdsbFlights(domain, "adsb-lol", "https://api.adsb.lol/v2", "ADSB.lol"),
  ]);
  const liveSnapshots = [openSky, airplanesSpecialty, adsbSpecialty]
    .flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
  const errors: string[] = [];
  for (const [label, result] of [["OpenSky Network", openSky], ["Airplanes.live", airplanesSpecialty], ["ADSB.lol", adsbSpecialty]] as const) {
    if (result.status === "rejected") errors.push(`${label}: ${result.reason instanceof Error ? result.reason.message : "provider request failed"}`);
  }
  if (liveSnapshots.length) {
    const primary = liveSnapshots[0];
    const entities = mergeAviationEntities(liveSnapshots);
    const supplemental = liveSnapshots.filter((item) => item !== primary).map((item) => item.source.name.replace(/ ·.*$/, ""));
    return {
      ...primary,
      observations: [...entities, ...primary.observations.filter((observation) => observation.kind === "signal")],
      source: { ...primary.source, name: supplemental.length ? `${primary.source.name} + ${supplemental.join(" + ")}` : primary.source.name },
      status: errors.length ? "degraded" : primary.status,
      error: errors.length ? errors.join("; ") : primary.error,
    };
  }

  const regional = await Promise.allSettled([
    getAdsbFlights(domain, "airplanes-live", "https://api.airplanes.live/v2", "Airplanes.live"),
    getAdsbFlights(domain, "adsb-lol", "https://api.adsb.lol/v2", "ADSB.lol"),
  ]);
  const regionalSnapshots = regional.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
  for (const [label, result] of [["Airplanes.live regional", regional[0]], ["ADSB.lol regional", regional[1]]] as const) {
    if (result.status === "rejected") errors.push(`${label}: ${result.reason instanceof Error ? result.reason.message : "provider request failed"}`);
  }
  if (regionalSnapshots.length) {
    const primary = regionalSnapshots[0];
    return { ...primary, observations: [...mergeAviationEntities(regionalSnapshots), ...primary.observations.filter((observation) => observation.kind === "signal")], error: errors.join("; ") || primary.error };
  }
  return aviationSnapshot(domain, "aviation-network", "OpenSky → Airplanes.live → ADSB.lol", "degraded", [], [], errors.join("; ") || "No aviation provider returned positions");
}

export const aviationProviderImplementation: ProviderImplementation = async ({ pack, provider }): Promise<ProviderSnapshot> => {
  if (aviationCache && aviationCache.expiresAt > Date.now()) return { ...aviationCache.snapshot, nextPollSeconds: provider.pollSeconds ?? aviationCache.snapshot.nextPollSeconds };
  if (!aviationFetchPromise) {
    aviationFetchPromise = loadFlights(pack.domain).then((result) => {
      if (result.observations.some((observation) => observation.kind === "entity")) aviationCache = { snapshot: result, expiresAt: Date.now() + AVIATION_CACHE_TTL_MS };
      return result;
    }).finally(() => { aviationFetchPromise = null; });
  }
  const result = await aviationFetchPromise;
  return { ...result, nextPollSeconds: provider.pollSeconds ?? result.nextPollSeconds };
};
