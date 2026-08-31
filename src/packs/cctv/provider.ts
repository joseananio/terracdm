import { riskFromScore, type Entity, type MediaSource, type ProviderSnapshot, type Signal, type SourceStatus } from "../../lib/intelligence";
import { fetchJson, fetchText, isoTime, ProviderError } from "../../lib/server/fetch-json";
import { getAlbertaCctv, getAsfinagCctv, getAustraliaCctv, getDriveBcCctv, getFinlandCctv, getIcelandCctv, getIllinoisCctv, getOntarioCctv, getTaiwanCctv, getTorontoCctv, getUtahCctv } from "./sources";
import type { ProviderImplementation } from "../../lib/catalog/types";

type CctvContext = { domain: string; subdomainId: string };

const cctvSnapshot = (context: CctvContext, sourceId: string, source: string, status: SourceStatus, entities: Entity[], _signals: Signal[], error?: string): ProviderSnapshot => ({
  domain: context.domain, providerId: sourceId, source: { id: sourceId, name: source }, status, observations: entities.map((entity) => ({ ...entity, domain: context.domain, subdomainId: context.subdomainId })), fetchedAt: new Date().toISOString(), error, nextPollSeconds: status === "live" ? 60 : 300,
});

function textTag(block: string, tag: string) {
  const match = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
  return match?.[1]?.replace(/<!\[CDATA\[|\]\]>/g, "").replace(/<[^>]+>/g, "").trim() ?? "";
}

function safeUrl(value: string, fallback?: string) {
  try { return value ? new URL(value, fallback).toString() : fallback; } catch { return fallback; }
}

function media(kind: MediaSource["kind"], url: string | null | undefined, extra: Record<string, unknown> = {}): MediaSource | undefined {
  if (!url) return undefined;
  return { kind, url, ...extra } as MediaSource;
}

const jamcamBase = "https://s3-eu-west-1.amazonaws.com/jamcams.tfl.gov.uk/";

function jamcamImageUrl(value: string) {
  if (!value) return null;
  try {
    const candidate = new URL(value, jamcamBase);
    if (candidate.hostname === "content.tfl.gov.uk" || candidate.hostname === "s3-eu-west-1.amazonaws.com") {
      const file = candidate.pathname.split("/").filter(Boolean).at(-1) ?? "";
      const normalizedFile = file.replace(/^(\d{5})(\d{5})(\.jpg)?$/i, "$1.$2.jpg");
      return normalizedFile ? new URL(normalizedFile, jamcamBase).toString() : null;
    }
    return candidate.protocol === "https:" ? candidate.toString() : null;
  } catch { return null; }
}

const CCTV_INDEX_CACHE_TTL_MS = 30 * 60 * 1_000;
let cctvIndexCache: { snapshot: ProviderSnapshot; expiresAt: number } | null = null;
let cctvIndexFetchPromise: Promise<ProviderSnapshot> | null = null;

async function loadCctv(context: CctvContext) {
  const adapters = [
    { name: "TfL", load: () => getTflCctv(context) },
    { name: "WSDOT", load: () => getWsdotCctv(context) },
    { name: "Caltrans", load: () => getCaltransCctv(context) },
    { name: "Singapore LTA", load: () => getSingaporeCctv(context) },
    { name: "ODOT TripCheck", load: () => getOregonCctv(context) },
    { name: "Hong Kong Transport", load: () => getHongKongCctv(context) },
    { name: "NZTA", load: () => getNewZealandCctv(context) },
    { name: "MDOT MiDrive", load: () => getMichiganCctv(context) },
    { name: "ASFINAG", load: () => getAsfinagCctv(context) },
    { name: "NSW Live Traffic", load: () => getAustraliaCctv(context) },
    { name: "Fintraffic", load: () => getFinlandCctv(context) },
    { name: "Vegagerðin", load: () => getIcelandCctv(context) },
    { name: "UDOT", load: () => getUtahCctv(context) },
    { name: "Ontario 511", load: () => getOntarioCctv(context) },
    { name: "Alberta 511", load: () => getAlbertaCctv(context) },
    { name: "City of Toronto", load: () => getTorontoCctv(context) },
    { name: "DriveBC", load: () => getDriveBcCctv(context) },
    { name: "Illinois DOT", load: () => getIllinoisCctv(context) },
    { name: "Taiwan Highway Bureau", load: () => getTaiwanCctv(context) },
  ];
  const results = await Promise.allSettled(adapters.map((adapter) => adapter.load()));
  const entities = results.flatMap((result) => result.status === "fulfilled" ? result.value.entities.map((entity) => ({ ...entity, domain: context.domain, subdomainId: context.subdomainId })) : []);
  const errors = results.flatMap((result, index) => result.status === "rejected" ? [`${adapters[index].name}: ${result.reason instanceof Error ? result.reason.message : "adapter failed"}`] : []);
  if (!entities.length) return cctvSnapshot(context, "cctv-network", "Public CCTV network", "degraded", [], [], errors.join("; ") || "CCTV providers returned no cameras");
  return cctvSnapshot(context, "cctv-network", "Public traffic-camera networks", "live", entities, [], errors.length ? `Partial adapter failure: ${errors.join("; ")}` : undefined);
}

async function loadCctvSnapshot(context: CctvContext) {
  if (cctvIndexCache && cctvIndexCache.expiresAt > Date.now()) return cctvIndexCache.snapshot;
  if (!cctvIndexFetchPromise) {
    cctvIndexFetchPromise = loadCctv(context).then((result) => {
      if (result.observations.length) {
        cctvIndexCache = { snapshot: result, expiresAt: Date.now() + CCTV_INDEX_CACHE_TTL_MS };
        return result;
      }
      if (cctvIndexCache) return { ...cctvIndexCache.snapshot, status: "degraded" as const, error: result.error ?? "Camera indexes unavailable; serving the last successful catalog" };
      return result;
    }).finally(() => { cctvIndexFetchPromise = null; });
  }
  return cctvIndexFetchPromise;
}

function cameraEntity(context: CctvContext, input: { id: string; name: string; lat: number; lng: number; source: string; feedUrl?: string | null; streamUrl?: string | null; streamKind?: "jpg" | "mjpeg" | "hls" | "iframe"; liveUrl?: string; city?: string; country?: string; postCode?: string | null; county?: string | null; route?: string | null; direction?: string | null; postmile?: number | null; district?: number | null; observedAt?: string }): Entity | null {
  if (!Number.isFinite(input.lat) || !Number.isFinite(input.lng)) return null;
  const feedUrl = input.feedUrl ?? input.streamUrl;
  const kind = input.streamKind ?? "jpg";
  const cameraMedia = input.streamUrl && kind !== "jpg"
    ? media(kind, input.streamUrl, { liveUrl: input.liveUrl })
    : media("jpg", feedUrl, { refreshSeconds: 30, liveUrl: input.liveUrl });
  return {
    id: `cctv:${input.source.toLowerCase().replace(/[^a-z0-9]+/g, "-")}:${input.id}`,
    kind: "entity",
    domain: context.domain,
    subdomainId: context.subdomainId,
    name: input.name,
    description: `${kind.toUpperCase()} traffic camera · ${input.source}`,
    risk: riskFromScore(12),
    riskScore: 12,
    location: { coordinates: { lat: input.lat, lng: input.lng }, label: input.name },
    source: { id: input.source.toLowerCase().replace(/[^a-z0-9]+/g, "-"), name: input.source, url: input.liveUrl },
    providerId: input.source.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    observedAt: input.observedAt ?? new Date().toISOString(),
    url: input.liveUrl,
    media: cameraMedia,
    properties: {
      feedUrl: feedUrl ?? null,
      available: Boolean(feedUrl || input.streamUrl),
      source: input.source,
      city: input.city ?? null,
      country: input.country ?? null,
      postCode: input.postCode ?? null,
      county: input.county ?? null,
      route: input.route ?? null,
      direction: input.direction ?? null,
      postmile: input.postmile ?? null,
      district: input.district ?? null,
    },
  };
}

async function getTflCctv(context: CctvContext) {
  const xml = await fetchText("https://content.tfl.gov.uk/camera-list.xml", { headers: { accept: "application/xml,text/xml,*/*", "user-agent": "TerraCDM/0.1" } });
  const blocks = xml.match(/<camera\b[^>]*>[\s\S]*?<\/camera>/gi) ?? [];
  const entities = blocks.map((block, index) => {
    const attr = (name: string) => block.match(new RegExp(`${name}=['\"]([^'\"]+)['\"]`, "i"))?.[1] ?? "";
    const file = textTag(block, "file");
    return cameraEntity(context, { id: attr("id") || String(index), name: textTag(block, "location") || `TfL camera ${index + 1}`, lat: Number(textTag(block, "lat")), lng: Number(textTag(block, "lng")), source: "TfL JamCams", feedUrl: jamcamImageUrl(file), liveUrl: "https://tfl.gov.uk/modes/driving/traffic-cameras", city: "London", country: "United Kingdom", postCode: textTag(block, "postCode") || null, observedAt: isoTime(textTag(block, "captureTime")) });
  }).filter((entity): entity is Entity => Boolean(entity));
  return { entities };
}

async function getWsdotCctv(context: CctvContext) {
  const accessCode = process.env.WSDOT_ACCESS_CODE?.trim();
  if (!accessCode) throw new ProviderError("WSDOT_ACCESS_CODE is not configured", 401, "key_required");
  const url = new URL("https://wsdot.wa.gov/Traffic/api/HighwayCameras/HighwayCamerasREST.svc/GetCamerasAsJson");
  url.searchParams.set("AccessCode", accessCode);
  const data = await fetchJson<Array<{ CameraID?: string | number; Title?: string; ImageURL?: string; IsActive?: boolean; CameraLocation?: { Latitude?: number; Longitude?: number } }>>(url.toString());
  const entities = data.filter((camera) => camera.IsActive !== false).map((camera, index) => cameraEntity(context, { id: String(camera.CameraID ?? index), name: camera.Title || `WSDOT camera ${index + 1}`, lat: Number(camera.CameraLocation?.Latitude), lng: Number(camera.CameraLocation?.Longitude), source: "WSDOT", feedUrl: camera.ImageURL, liveUrl: "https://wsdot.com/Travel/Real-time/Map/" })).filter((entity): entity is Entity => Boolean(entity));
  return { entities };
}

async function getCaltransCctv(context: CctvContext) {
  const url = "https://caltrans-gis.dot.ca.gov/arcgis/rest/services/CHhighway/CCTV/FeatureServer/0/query?where=1%3D1&outFields=*&f=json";
  const data = await fetchJson<{ features?: Array<{ attributes?: Record<string, unknown> }> }>(url);
  const entities = (data.features ?? []).map((feature, index) => {
    const attrs = feature.attributes ?? {};
    const postmile = Number(attrs.postmile);
    const district = Number(attrs.district);
    return cameraEntity(context, {
      id: String(attrs.OBJECTID ?? index),
      name: String(attrs.locationName ?? attrs.nearbyPlace ?? `Caltrans camera ${index + 1}`),
      lat: Number(attrs.latitude ?? attrs.Latitude),
      lng: Number(attrs.longitude ?? attrs.Longitude),
      source: "Caltrans",
      feedUrl: String(attrs.currentImageURL ?? attrs.imageURL ?? ""),
      liveUrl: "https://cwwp2.dot.ca.gov/vm/streamlist.htm",
      city: typeof attrs.nearbyPlace === "string" ? attrs.nearbyPlace : undefined,
      county: typeof attrs.county === "string" ? attrs.county : undefined,
      route: typeof attrs.route === "string" ? attrs.route : undefined,
      direction: typeof attrs.direction === "string" ? attrs.direction : undefined,
      postmile: Number.isFinite(postmile) ? postmile : null,
      district: Number.isFinite(district) ? district : null,
      country: "United States",
    });
  }).filter((entity): entity is Entity => Boolean(entity));
  return { entities };
}

async function getSingaporeCctv(context: CctvContext) {
  const data = await fetchJson<{ items?: Array<{ timestamp?: string; cameras?: Array<{ camera_id?: string; image?: string; location?: { latitude?: number; longitude?: number } }> }> }>("https://api.data.gov.sg/v1/transport/traffic-images");
  const cameras = data.items?.at(-1)?.cameras ?? [];
  const entities = cameras.map((camera, index) => cameraEntity(context, { id: String(camera.camera_id ?? index), name: `Singapore traffic camera ${camera.camera_id ?? index + 1}`, lat: Number(camera.location?.latitude), lng: Number(camera.location?.longitude), source: "Singapore LTA", feedUrl: camera.image, liveUrl: "https://onemotoring.lta.gov.sg/content/onemotoring/home/driving/traffic_information/traffic-cameras.html", city: "Singapore", country: "Singapore" })).filter((entity): entity is Entity => Boolean(entity));
  return { entities };
}

function cameraXmlText(block: string, tag: string) {
  const match = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
  return match?.[1]?.replace(/<!\[CDATA\[|\]\]>/g, "").replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&").trim() ?? "";
}

function cameraInBounds(lat: number, lng: number, bounds: { minLat: number; maxLat: number; minLng: number; maxLng: number }) {
  return Number.isFinite(lat) && Number.isFinite(lng) && lat >= bounds.minLat && lat <= bounds.maxLat && lng >= bounds.minLng && lng <= bounds.maxLng;
}

async function getOregonCctv(context: CctvContext) {
  const text = await fetchText("https://www.tripcheck.com/Scripts/map/data/cctvinventory.js", { headers: { accept: "*/*", "user-agent": "TerraCDM/0.1" } }, 15_000);
  const data = JSON.parse(text) as { features?: Array<{ attributes?: { cameraId?: string | number; filename?: string; latitude?: number; longitude?: number; route?: string; title?: string } }> };
  const bounds = { minLat: 41.9, maxLat: 46.3, minLng: -124.6, maxLng: -116.4 };
  const entities = (data.features ?? []).map((feature, index) => {
    const attributes = feature.attributes ?? {};
    const lat = Number(attributes.latitude);
    const lng = Number(attributes.longitude);
    const filename = String(attributes.filename ?? "").trim();
    if (!filename || !cameraInBounds(lat, lng, bounds)) return null;
    return cameraEntity(context, {
      id: String(attributes.cameraId ?? index),
      name: String(attributes.title ?? attributes.route ?? `ODOT camera ${index + 1}`),
      lat,
      lng,
      source: "ODOT TripCheck",
      feedUrl: safeUrl(filename, "https://tripcheck.com/RoadCams/cams/"),
      liveUrl: "https://www.tripcheck.com/",
      route: attributes.route,
      city: "Oregon",
      country: "United States",
    });
  }).filter((entity): entity is Entity => Boolean(entity));
  return { entities };
}

async function getHongKongCctv(context: CctvContext) {
  const xml = await fetchText("https://static.data.gov.hk/td/traffic-snapshot-images/code/Traffic_Camera_Locations_En.xml", { headers: { accept: "application/xml,text/xml,*/*", "user-agent": "TerraCDM/0.1" } }, 15_000);
  const bounds = { minLat: 22.1, maxLat: 22.6, minLng: 113.8, maxLng: 114.5 };
  const entities = (xml.match(/<image\b[^>]*>[\s\S]*?<\/image>/gi) ?? []).map((block, index) => {
    const key = cameraXmlText(block, "key");
    const feedUrl = cameraXmlText(block, "url");
    const lat = Number(cameraXmlText(block, "latitude"));
    const lng = Number(cameraXmlText(block, "longitude"));
    if (!key || !feedUrl || !cameraInBounds(lat, lng, bounds)) return null;
    return cameraEntity(context, {
      id: key,
      name: cameraXmlText(block, "description").replace(/\s*\[[^\]]*\]\s*$/, "") || `HK camera ${key}`,
      lat,
      lng,
      source: "HK Transport Department",
      feedUrl,
      liveUrl: "https://www.td.gov.hk/en/transport_in_hong_kong/traffic_information/traffic_cameras/index.html",
      city: cameraXmlText(block, "district") || cameraXmlText(block, "region") || "Hong Kong",
      country: "Hong Kong",
    });
  }).filter((entity): entity is Entity => Boolean(entity));
  return { entities };
}

async function getNewZealandCctv(context: CctvContext) {
  const xml = await fetchText("https://trafficnz.info/service/traffic/rest/4/cameras/all", { headers: { accept: "application/xml,text/xml,*/*", "user-agent": "TerraCDM/0.1" } }, 15_000);
  const bounds = { minLat: -47.5, maxLat: -34, minLng: 166, maxLng: 179 };
  const entities = (xml.match(/<camera\b[^>]*>[\s\S]*?<\/camera>/gi) ?? []).map((block, index) => {
    const region = cameraXmlText(block.match(/<region\b[^>]*>[\s\S]*?<\/region>/i)?.[0] ?? "", "name");
    const flat = block.replace(/<(journey|journeyLeg|region|way)>[\s\S]*?<\/\1>/g, "");
    const id = cameraXmlText(flat, "id");
    const imageUrl = safeUrl(cameraXmlText(flat, "imageUrl"), "https://trafficnz.info");
    const lat = Number(cameraXmlText(flat, "latitude"));
    const lng = Number(cameraXmlText(flat, "longitude"));
    if (!id || !imageUrl || cameraXmlText(flat, "offline") === "true" || cameraXmlText(flat, "underMaintenance") === "true" || !cameraInBounds(lat, lng, bounds)) return null;
    const name = cameraXmlText(flat, "name") || cameraXmlText(flat, "description") || `NZTA camera ${id}`;
    const direction = cameraXmlText(flat, "direction");
    return cameraEntity(context, {
      id,
      name: direction && direction !== "NA" ? `${name} (${direction})` : name,
      lat,
      lng,
      source: "NZTA",
      feedUrl: imageUrl,
      liveUrl: `https://trafficnz.info/camera/view/${encodeURIComponent(id)}`,
      route: cameraXmlText(flat, "highway") || undefined,
      direction: direction && direction !== "NA" ? direction : undefined,
      city: region || "New Zealand",
      country: "New Zealand",
    });
  }).filter((entity): entity is Entity => Boolean(entity));
  return { entities };
}

function stripHtml(value: string) { return value.replace(/<br\s*\/?>(\s*)/gi, " ").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').trim(); }

function cameraPlainText(value: string) {
  return stripHtml(value.replace(/<a\b[\s\S]*?<\/a>/gi, "")).replace(/\s+/g, " ").trim();
}

async function getMichiganCctv(context: CctvContext) {
  const records = await fetchJson<Array<{ route?: string | null; county?: string | null; location?: string | null; direction?: string | null; image?: string | null }>>("https://mdotjboss.state.mi.us/MiDrive/camera/list", { headers: { "user-agent": "TerraCDM/0.1" } }, 15_000);
  const bounds = { minLat: 41.6, maxLat: 48.3, minLng: -90.5, maxLng: -82.1 };
  const entities = records.map((record, index) => {
    const county = String(record.county ?? "");
    const image = String(record.image ?? "");
    const coordinates = county.match(/lat=(-?[\d.]+)&(?:amp;)?lon=(-?[\d.]+)/);
    const imageUrl = image.match(/src="(https?:\/\/[^\"]+)"/i)?.[1];
    const id = county.match(/[?&]id=(\d+)/)?.[1];
    const lat = Number(coordinates?.[1]);
    const lng = Number(coordinates?.[2]);
    if (!id || !imageUrl || !cameraInBounds(lat, lng, bounds)) return null;
    const route = String(record.route ?? "").trim();
    const location = String(record.location ?? "").trim();
    return cameraEntity(context, {
      id,
      name: [route, location].filter(Boolean).join(" ") || `MDOT camera ${id}`,
      lat,
      lng,
      source: "MDOT MiDrive",
      feedUrl: imageUrl,
      liveUrl: "https://mdotjboss.state.mi.us/MiDrive/map",
      route: route || undefined,
      direction: String(record.direction ?? "").trim() || undefined,
      city: cameraPlainText(county) || "Michigan",
      country: "United States",
    });
  }).filter((entity): entity is Entity => Boolean(entity));
  return { entities };
}

export const cctvProviderImplementation: ProviderImplementation = async ({ pack, provider }) => {
  const result = await loadCctvSnapshot({ domain: pack.domain, subdomainId: pack.subdomains[0].id });
  return { ...result, nextPollSeconds: provider.pollSeconds ?? result.nextPollSeconds };
};
