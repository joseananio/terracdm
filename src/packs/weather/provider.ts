import { riskFromScore, type Entity, type ProviderSnapshot, type Signal } from "../../lib/intelligence";
import { fetchJson, fetchText, isoTime, locationText, ProviderError, severityFor } from "../../lib/server/fetch-json";
import type { ProviderDefinition, ProviderImplementation, SignalPack } from "../../lib/catalog/types";

type WeatherOutputContext = {
  domain: string;
  stormSubdomainId: string;
  alertSubdomainId: string;
  stormSignalType?: string;
  alertSignalType?: string;
};

function weatherOutputContext(pack: SignalPack, provider: ProviderDefinition): WeatherOutputContext {
  const stormSignal = pack.signals?.find((signal) => signal.providerId === provider.id && signal.subdomainId === "severe-storm");
  const alertSignal = pack.signals?.find((signal) => signal.providerId === provider.id && signal.subdomainId === "weather-alert");
  return {
    domain: pack.domain,
    stormSubdomainId: stormSignal?.subdomainId ?? "severe-storm",
    alertSubdomainId: alertSignal?.subdomainId ?? "weather-alert",
    stormSignalType: stormSignal?.id,
    alertSignalType: alertSignal?.id,
  };
}

const weatherSnapshot = (context: WeatherOutputContext, sourceId: string, source: string, status: "live" | "cached" | "degraded", entities: Entity[], signals: Signal[], error?: string): ProviderSnapshot => ({
  domain: context.domain, providerId: sourceId, source: { id: sourceId, name: source }, status, observations: [...entities, ...signals], fetchedAt: new Date().toISOString(), error, nextPollSeconds: status === "live" ? 60 : 300,
});

function safeUrl(value: string, fallback?: string) {
  try { return value ? new URL(value, fallback).toString() : fallback; } catch { return fallback; }
}

type EonetEvent = {
  id?: string;
  title?: string;
  link?: string;
  description?: string;
  categories?: Array<{ title?: string; id?: string }>;
  sources?: Array<{ id?: string; url?: string }>;
  geometry?: Array<{ date?: string; type?: string; coordinates?: unknown }>;
};
type WeatherProviderData = { entities: Entity[]; signals: Signal[]; source: string; sourceId: string };
type WeatherAlertGeometry = { coordinates?: unknown };

function xmlText(block: string, tag: string) {
  const match = block.match(new RegExp(`<(?:(?:[\\w-]+):)?${tag}[^>]*>([\\s\\S]*?)</(?:(?:[\\w-]+):)?${tag}>`, "i"));
  return match?.[1]?.replace(/<!\[CDATA\[|\]\]>/g, "").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').trim() ?? "";
}

function xmlLink(block: string) {
  const links = [...block.matchAll(/<link\b([^>]*)>/gi)];
  for (const match of links) {
    const attributes = match[1] ?? "";
    const rel = attributes.match(/\brel\s*=\s*["']([^"']+)/i)?.[1] ?? "alternate";
    const href = attributes.match(/\bhref\s*=\s*["']([^"']+)/i)?.[1] ?? "";
    if (rel === "alternate" && safeUrl(href)) return safeUrl(href);
  }
  return safeUrl(xmlText(block, "link"));
}

function pointFromNestedCoordinates(value: unknown): { lat: number; lng: number } | null {
  const points: Array<[number, number]> = [];
  const visit = (candidate: unknown) => {
    if (!Array.isArray(candidate)) return;
    if (typeof candidate[0] === "number" && typeof candidate[1] === "number") {
      points.push([candidate[0], candidate[1]]);
      return;
    }
    for (const child of candidate) visit(child);
  };
  visit(value);
  if (!points.length) return null;
  const lngs = points.map(([lng]) => lng);
  const lats = points.map(([, lat]) => lat);
  return { lng: (Math.min(...lngs) + Math.max(...lngs)) / 2, lat: (Math.min(...lats) + Math.max(...lats)) / 2 };
}

function pointFromLatLngText(value: string) {
  const [lat, lng] = value.trim().split(/[ ,]+/).map(Number);
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
}

function weatherRisk(value: string) {
  const normalized = value.toLowerCase();
  if (/extreme|red/.test(normalized)) return 82;
  if (/severe|orange/.test(normalized)) return 62;
  if (/moderate|yellow/.test(normalized)) return 44;
  return 26;
}

function weatherSignal(entity: Entity, source: string, signalType?: string): Signal {
  const coordinates = entity.location.coordinates;
  return {
    id: `${entity.id}:signal`,
    kind: "signal",
    domain: entity.domain,
    subdomainId: entity.subdomainId,
    name: entity.name,
    description: entity.description,
    risk: entity.risk,
    riskScore: entity.riskScore,
    location: { coordinates, label: locationText(coordinates.lat, coordinates.lng) },
    source: { id: entity.source.id, name: source, url: entity.source.url },
    providerId: entity.providerId,
    observedAt: entity.observedAt,
    signalType,
    url: entity.url,
    properties: { type: String(entity.properties?.weatherType ?? "weather event") },
  };
}

async function getEonetEvents(context: WeatherOutputContext): Promise<WeatherProviderData> {
  try {
    const data = await fetchJson<{ events?: EonetEvent[] }>("https://eonet.gsfc.nasa.gov/api/v3/events?status=open&category=severeStorms&limit=200");
    const entities: Entity[] = [];
    const signals: Signal[] = [];
    for (const event of data.events ?? []) {
      const geometry = event.geometry?.at(-1);
      if (!geometry || geometry.type !== "Point" || !Array.isArray(geometry.coordinates)) continue;
      const [lng, lat] = geometry.coordinates;
      if (typeof lat !== "number" || typeof lng !== "number") continue;
      const category = String(event.categories?.[0]?.title ?? "Event");
      const id = `eonet:${event.id ?? `${lat}:${lng}`}`;
      const sourceUrl = event.sources?.map((source) => safeUrl(source.url ?? "")).find(Boolean);
      const riskScore = weatherRisk(category);
      const entity: Entity = { id, kind: "entity", domain: context.domain, subdomainId: context.stormSubdomainId, name: String(event.title ?? category), description: `${category} · ${isoTime(geometry.date).slice(0, 10)}`, risk: riskFromScore(riskScore), riskScore, location: { coordinates: { lat, lng }, label: locationText(lat, lng) }, source: { id: "eonet", name: "NASA EONET", url: sourceUrl }, providerId: "eonet", observedAt: isoTime(geometry.date), url: sourceUrl, properties: { weatherType: category, detail: event.description ?? null } };
      entities.push(entity);
      signals.push(weatherSignal(entity, "NASA EONET", context.stormSignalType));
    }
    return { entities, signals, source: "NASA EONET severe storms", sourceId: "eonet" };
  } catch (error) { throw new ProviderError(error instanceof Error ? error.message : "EONET request failed"); }
}

const meteoAlarmFeeds = ["andorra", "austria", "belgium", "bosnia-herzegovina", "bulgaria", "croatia", "cyprus", "czechia", "denmark", "estonia", "finland", "france", "germany", "greece", "hungary", "iceland", "ireland", "israel", "italy", "latvia", "lithuania", "luxembourg", "malta", "moldova", "montenegro", "netherlands", "republic-of-north-macedonia", "norway", "poland", "portugal", "romania", "serbia", "slovakia", "slovenia", "spain", "sweden", "switzerland", "ukraine", "united-kingdom"];

async function getMeteoAlarmWeather(context: WeatherOutputContext): Promise<WeatherProviderData> {
  const feeds: PromiseSettledResult<{ country: string; xml: string }>[] = [];
  for (let start = 0; start < meteoAlarmFeeds.length; start += 6) {
    const batch = meteoAlarmFeeds.slice(start, start + 6).map(async (country) => {
      const xml = await fetchText(`https://feeds.meteoalarm.org/feeds/meteoalarm-legacy-atom-${country}`, { headers: { accept: "application/atom+xml,application/xml,text/xml,*/*", "user-agent": "TerraCDM/0.1" } });
      return { country, xml };
    });
    feeds.push(...await Promise.allSettled(batch));
  }
  const entities: Entity[] = [];
  for (const result of feeds) {
    if (result.status !== "fulfilled") continue;
    const { country, xml } = result.value;
    const entries = xml.match(/<entry\b[^>]*>[\s\S]*?<\/entry>/gi) ?? [];
    for (const [index, entry] of entries.slice(0, 12).entries()) {
      const polygon = xmlText(entry, "polygon");
      const point = pointFromLatLngText(xmlText(entry, "point")) ?? pointFromNestedCoordinates(polygon.split(/\s+/).map((pair) => pair.split(",").map(Number).reverse()));
      if (!point) continue;
      const type = xmlText(entry, "event") || xmlText(entry, "title") || "Weather warning";
      const severity = xmlText(entry, "severity");
      const area = xmlText(entry, "areaDesc") || country.replaceAll("-", " ");
      const observedAt = isoTime(xmlText(entry, "effective") || xmlText(entry, "updated"));
      const sourceUrl = xmlLink(entry);
      const riskScore = weatherRisk(severity);
      const entity: Entity = {
        id: `meteoalarm:${xmlText(entry, "id") || `${country}:${index}`}`,
        kind: "entity",
        domain: context.domain,
        subdomainId: context.alertSubdomainId,
        name: type,
        description: `${type} · ${area}`,
        risk: riskFromScore(riskScore),
        riskScore,
        location: { coordinates: point, label: area },
        source: { id: "meteoalarm", name: "MeteoAlarm", url: sourceUrl },
        providerId: "meteoalarm",
        observedAt,
        url: sourceUrl,
        properties: { weatherType: type, severity: severity || null, area, detail: xmlText(entry, "description") || null },
      };
      entities.push(entity);
    }
  }
  return { entities: entities.slice(0, 200), signals: entities.slice(0, 200).map((entity) => weatherSignal(entity, "MeteoAlarm", context.alertSignalType)), source: "MeteoAlarm warnings", sourceId: "meteoalarm" };
}

async function getGdacsWeather(context: WeatherOutputContext): Promise<WeatherProviderData> {
  const xml = await fetchText("https://www.gdacs.org/xml/rss.xml", { headers: { accept: "application/rss+xml,application/xml,text/xml,*/*", "user-agent": "TerraCDM/0.1" } });
  const entities: Entity[] = [];
  for (const [index, item] of (xml.match(/<item\b[^>]*>[\s\S]*?<\/item>/gi) ?? []).entries()) {
    const type = xmlText(item, "eventtype");
    const title = xmlText(item, "title");
    if (!/^(TC|FL)$/i.test(type) && !/cyclone|flood/i.test(`${title} ${type}`)) continue;
    const point = pointFromLatLngText(xmlText(item, "point")) ?? pointFromLatLngText(`${xmlText(item, "lat")} ${xmlText(item, "long")}`);
    if (!point) continue;
    const alertLevel = xmlText(item, "alertlevel");
    const observedAt = isoTime(xmlText(item, "pubDate") || xmlText(item, "fromdate"));
    const riskScore = weatherRisk(alertLevel);
    const entity: Entity = {
      id: `gdacs:${xmlText(item, "guid") || `${type}:${index}`}`,
      kind: "entity",
      domain: context.domain,
      subdomainId: context.alertSubdomainId,
      name: title || (type === "FL" ? "Flood" : "Tropical cyclone"),
      description: `${type === "FL" ? "Flood" : "Tropical cyclone"} · ${alertLevel || "monitoring"}`,
      risk: riskFromScore(riskScore),
      riskScore,
      location: { coordinates: point, label: locationText(point.lat, point.lng) },
      source: { id: "gdacs", name: "GDACS", url: xmlLink(item) },
      providerId: "gdacs",
      observedAt,
      url: xmlLink(item),
      properties: { weatherType: type === "FL" ? "Flood" : "Tropical cyclone", alertLevel: alertLevel || null, detail: xmlText(item, "description") || null },
    };
    entities.push(entity);
  }
  return { entities: entities.slice(0, 100), signals: entities.slice(0, 100).map((entity) => weatherSignal(entity, "GDACS", context.alertSignalType)), source: "GDACS cyclones / floods", sourceId: "gdacs" };
}

async function getNwsWeather(context: WeatherOutputContext): Promise<WeatherProviderData> {
  const data = await fetchJson<{ features?: Array<{ id?: string; properties?: Record<string, unknown>; geometry?: WeatherAlertGeometry }> }>("https://api.weather.gov/alerts/active?status=actual&message_type=alert", { headers: { "user-agent": "TerraCDM/0.1 (weather alert monitor)" } });
  const entities: Entity[] = [];
  for (const [index, feature] of (data.features ?? []).entries()) {
    const point = pointFromNestedCoordinates(feature.geometry?.coordinates);
    if (!point) continue;
    const properties = feature.properties ?? {};
    const type = String(properties.event ?? "Weather alert");
    const severity = String(properties.severity ?? "Unknown");
    const observedAt = isoTime(String(properties.sent ?? properties.effective ?? properties.onset ?? new Date().toISOString()));
    const riskScore = weatherRisk(severity);
    const entity: Entity = {
      id: `nws:${String(properties.id ?? feature.id ?? index)}`,
      kind: "entity",
      domain: context.domain,
      subdomainId: context.alertSubdomainId,
      name: String(properties.headline ?? type),
      description: `${type} · ${String(properties.areaDesc ?? "United States")}`,
      risk: riskFromScore(riskScore),
      riskScore,
      location: { coordinates: point, label: String(properties.areaDesc ?? "United States") },
      source: { id: "nws", name: "NOAA NWS" },
      providerId: "nws",
      observedAt,
      properties: { weatherType: type, severity, area: String(properties.areaDesc ?? "United States"), detail: String(properties.description ?? properties.headline ?? "") || null },
    };
    entities.push(entity);
  }
  return { entities: entities.slice(0, 300), signals: entities.slice(0, 300).map((entity) => weatherSignal(entity, "NOAA NWS", context.alertSignalType)), source: "NOAA NWS active alerts", sourceId: "nws" };
}

const WEATHER_CACHE_TTL_MS = 2 * 60 * 1_000;
let weatherCache: { snapshot: ProviderSnapshot; expiresAt: number } | null = null;
let weatherFetchPromise: Promise<ProviderSnapshot> | null = null;



export const weatherProviderImplementation: ProviderImplementation = async ({ pack, provider }): Promise<ProviderSnapshot> => {
  const outputContext = weatherOutputContext(pack, provider);
  if (weatherCache && weatherCache.expiresAt > Date.now()) return { ...weatherCache.snapshot, status: "cached", nextPollSeconds: provider.pollSeconds ?? weatherCache.snapshot.nextPollSeconds };
  if (!weatherFetchPromise) {
      weatherFetchPromise = Promise.allSettled([getNwsWeather(outputContext), getMeteoAlarmWeather(outputContext), getGdacsWeather(outputContext), getEonetEvents(outputContext)]).then((results) => {
      const successful = results.filter((result): result is PromiseFulfilledResult<WeatherProviderData> => result.status === "fulfilled").map((result) => result.value);
      const failures = results.filter((result): result is PromiseRejectedResult => result.status === "rejected").map((result) => result.reason instanceof Error ? result.reason.message : "provider request failed");
      const entities = successful.flatMap((result) => result.entities);
      const signals = successful.flatMap((result) => result.signals);
      const result = weatherSnapshot(outputContext, "weather-stack", successful.map((item) => item.source).join(" / ") || "Weather provider stack", entities.length ? "live" : "degraded", entities, signals, failures.length ? failures.join("; ") : undefined);
      if (entities.length || signals.length) weatherCache = { snapshot: result, expiresAt: Date.now() + WEATHER_CACHE_TTL_MS };
      if (!entities.length && !signals.length && weatherCache) {
        return {
          ...weatherCache.snapshot,
          status: "degraded" as const,
          error: ["Weather sources unavailable; serving the last successful snapshot", result.error].filter(Boolean).join("; "),
        };
      }
      return result;
    }).finally(() => { weatherFetchPromise = null; });
  }
  const result = await weatherFetchPromise;
  return { ...result, nextPollSeconds: provider.pollSeconds ?? result.nextPollSeconds };
};
