import { riskFromScore, Entity, MediaSource } from "../../lib/intelligence";
import { fetchJson } from "../../lib/server/fetch-json";

type CameraInput = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  source: string;
  feedUrl?: string | null;
  liveUrl: string;
  city?: string;
  country?: string;
  route?: string;
  direction?: string;
};

export type CctvOutputContext = { domain: string; subdomainId: string };
type CameraAdapter = { entities: Entity[] };

function absoluteHttps(value: unknown, base?: string) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value, base);
    return url.protocol === "https:" ? url.toString() : null;
  } catch { return null; }
}

function asString(value: unknown) {
  return typeof value === "string" ? value.trim() : value === undefined || value === null ? "" : String(value).trim();
}

function asNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : NaN;
}

function coordinatesOf(value: unknown) {
  if (!Array.isArray(value)) return [] as unknown[];
  return Array.isArray(value[0]) ? value[0] : value;
}

function cameraEntity(context: CctvOutputContext, input: CameraInput): Entity | null {
  if (!Number.isFinite(input.lat) || !Number.isFinite(input.lng)) return null;
  const feedUrl = absoluteHttps(input.feedUrl);
  const media = feedUrl ? { kind: "jpg", url: feedUrl, refreshSeconds: 30, liveUrl: input.liveUrl } satisfies MediaSource : undefined;
  return {
    id: `cctv:${input.source.toLowerCase().replace(/[^a-z0-9]+/g, "-")}:${input.id}`,
    kind: "entity",
    domain: context.domain,
    subdomainId: context.subdomainId,
    name: input.name,
    description: `JPG traffic camera · ${input.source}`,
    risk: riskFromScore(12),
    riskScore: 12,
    location: { coordinates: { lat: input.lat, lng: input.lng }, label: input.name },
    source: { id: input.source.toLowerCase().replace(/[^a-z0-9]+/g, "-"), name: input.source, url: input.liveUrl },
    providerId: input.source.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    observedAt: new Date().toISOString(),
    url: input.liveUrl,
    media,
    properties: {
      feedUrl,
      available: Boolean(feedUrl),
      source: input.source,
      city: input.city ?? null,
      country: input.country ?? null,
      route: input.route ?? null,
      direction: input.direction ?? null,
    },
  };
}

function result(context: CctvOutputContext, candidates: Array<CameraInput | null>): CameraAdapter {
  return { entities: candidates.filter((candidate): candidate is CameraInput => candidate !== null).map((candidate) => cameraEntity(context, candidate)).filter((entity): entity is Entity => Boolean(entity)) };
}

type AsfinagCamera = { wcs_id?: string; wgs84_lat?: number; wgs84_lon?: number; position_txt?: string; direction_txt?: string; url_campic?: string };

export async function getAsfinagCctv(context: CctvOutputContext): Promise<CameraAdapter> {
  const cameras = await fetchJson<AsfinagCamera[]>("https://odo.asfinag.at/odo/rest/sec/resource/001/json/webcams?language=atDE", {
    headers: {
      accept: "application/json",
      "accept-language": "en,en-US;q=0.9,de;q=0.8",
      authorization: "Basic bWFwX3dpZGdldDp0ZWdkaXc=",
      "content-type": "application/json; charset=utf-8",
      origin: "https://www.asfinag.at",
      referer: "https://www.asfinag.at/",
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:150.0) Gecko/20100101 Firefox/150.0",
    },
  }, 15_000);
  return result(context, cameras.map((camera, index) => {
    const id = asString(camera.wcs_id) || String(index);
    if (id.startsWith("Utinform")) return null;
    return { id, name: asString(camera.position_txt) || asString(camera.direction_txt) || `ASFINAG camera ${index + 1}`, lat: asNumber(camera.wgs84_lat), lng: asNumber(camera.wgs84_lon), source: "ASFINAG", feedUrl: camera.url_campic, liveUrl: "https://www.asfinag.at/verkehr-sicherheit/webcams/", city: "Austria", country: "Austria", direction: asString(camera.direction_txt) || undefined };
  }));
}

type AustraliaCamera = { eventType?: string; path?: string; geometry?: { coordinates?: unknown }; properties?: { title?: string; region?: string; href?: string } };

export async function getAustraliaCctv(context: CctvOutputContext): Promise<CameraAdapter> {
  const records = await fetchJson<AustraliaCamera[]>("https://www.livetraffic.com/datajson/all-feeds-web.json", { headers: { accept: "application/json", "user-agent": "TerraCDM/0.1" } }, 15_000);
  return result(context, records.filter((record) => record.eventType === "liveCams").map((camera, index) => {
    const coordinates = camera.geometry?.coordinates;
    return {
      id: asString(camera.path) || String(index),
      name: asString(camera.properties?.title) || `Live Traffic camera ${index + 1}`,
      lat: asNumber(Array.isArray(coordinates) ? coordinates[1] : undefined),
      lng: asNumber(Array.isArray(coordinates) ? coordinates[0] : undefined),
      source: "NSW Live Traffic",
      feedUrl: camera.properties?.href,
      liveUrl: "https://www.livetraffic.com/",
      city: asString(camera.properties?.region) || "New South Wales",
      country: "Australia",
    };
  }));
}

type FinlandStation = { id?: string; geometry?: { coordinates?: unknown }; properties?: { name?: string; municipality?: string; presets?: Array<{ id?: string; imageUrl?: string }> } };

export async function getFinlandCctv(context: CctvOutputContext): Promise<CameraAdapter> {
  const data = await fetchJson<{ features?: FinlandStation[] }>("https://tie.digitraffic.fi/api/weathercam/v1/stations", { headers: { "digitraffic-user": "TerraCDM/0.1" } }, 15_000);
  return result(context, (data.features ?? []).map((station, index) => {
    const coordinates = station.geometry?.coordinates;
    const properties = station.properties;
    const preset = properties?.presets?.[0];
    const presetId = asString(preset?.id);
    return {
      id: asString(station.id) || String(index),
      name: asString(properties?.name) || `Fintraffic camera ${index + 1}`,
      lat: asNumber(Array.isArray(coordinates) ? coordinates[1] : undefined),
      lng: asNumber(Array.isArray(coordinates) ? coordinates[0] : undefined),
      source: "Fintraffic",
      feedUrl: preset?.imageUrl || (presetId ? `https://weathercam.digitraffic.fi/${encodeURIComponent(presetId)}.jpg` : null),
      liveUrl: "https://liikennetilanne.fintraffic.fi/",
      city: asString(properties?.municipality) || "Finland",
      country: "Finland",
    };
  }));
}

type IcelandCamera = { Maelist_nr?: number; Myndavel?: string; Vegheiti?: string; Skyring?: string; Slod?: string; Breidd?: number; Lengd?: number };

export async function getIcelandCctv(context: CctvOutputContext): Promise<CameraAdapter> {
  const cameras = await fetchJson<IcelandCamera[]>("https://gagnaveita.vegagerdin.is/api/vefmyndavelar2014_1", undefined, 15_000);
  return result(context, cameras.map((camera, index) => ({
    id: `${asString(camera.Maelist_nr) || index}-${index}`,
    name: [asString(camera.Myndavel), asString(camera.Skyring)].filter(Boolean).join(" · ") || `Vegagerðin camera ${index + 1}`,
    lat: asNumber(camera.Breidd),
    lng: asNumber(camera.Lengd),
    source: "Vegagerðin",
    feedUrl: absoluteHttps(camera.Slod, "https://www.vegagerdin.is"),
    liveUrl: "https://umferdin.is/",
    city: asString(camera.Myndavel) || "Iceland",
    country: "Iceland",
    route: asString(camera.Vegheiti) || undefined,
  })));
}

type UtahCamera = { id?: number; location?: string; roadway?: string; latLng?: { geography?: { wellKnownText?: string } }; images?: Array<{ blocked?: boolean; disabled?: boolean }> };
type UtahPage = { recordsTotal?: number; data?: UtahCamera[] };
const utahBase = "https://prod-ut.ibi511.com";

function utahQuery(start: number) {
  return new URLSearchParams({
    query: JSON.stringify({ columns: [{ data: null, name: "" }, { name: "sortOrder", s: true }, { name: "roadway", s: true }, { data: 3, name: "" }], order: [{ column: 1, dir: "asc" }], start, length: 100, search: { value: "" } }),
    lang: "en-US",
  });
}

function utahPoint(value: unknown) {
  const match = asString(value).match(/POINT\s*\(\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s*\)/i);
  return match ? { lng: Number(match[1]), lat: Number(match[2]) } : null;
}

function utahCamera(camera: UtahCamera): CameraInput | null {
  const id = camera.id;
  const point = utahPoint(camera.latLng?.geography?.wellKnownText);
  const image = camera.images?.[0];
  if (typeof id !== "number" || !point || image?.blocked || image?.disabled || point.lat < 36.9 || point.lat > 42.1 || point.lng < -114.2 || point.lng > -108.9) return null;
  return { id: String(id), name: asString(camera.location) || asString(camera.roadway) || "UDOT traffic camera", lat: point.lat, lng: point.lng, source: "UDOT", feedUrl: `${utahBase}/map/Cctv/${id}`, liveUrl: "https://udottraffic.utah.gov/", city: "Utah", country: "United States", route: asString(camera.roadway) || undefined };
}

export async function getUtahCctv(context: CctvOutputContext): Promise<CameraAdapter> {
  const request = (start: number) => fetchJson<UtahPage>(`${utahBase}/List/GetData/Cameras?${utahQuery(start)}`, { headers: { accept: "application/json", "x-requested-with": "XMLHttpRequest" } }, 15_000);
  const first = await request(0);
  const starts: number[] = [];
  for (let start = 100; start < Math.min(Math.max(Number(first.recordsTotal) || 0, 0), 2_500); start += 100) starts.push(start);
  const pages = await Promise.allSettled(starts.map(request));
  const cameras = [first, ...pages.flatMap((page) => page.status === "fulfilled" ? [page.value] : [])].flatMap((page) => page.data ?? []).map(utahCamera);
  return result(context, cameras);
}

type OntarioCamera = { id?: string | number; Id?: string | number; latitude?: number; longitude?: number; Latitude?: number; Longitude?: number; description?: string; name?: string; Location?: string; imageUrl?: string; url?: string; Views?: Array<{ Url?: string }> };
type AlbertaCamera = { Id?: string | number; Latitude?: number; Longitude?: number; Location?: string; Views?: Array<{ Url?: string }> };
type TorontoFeature = { geometry?: { coordinates?: unknown }; properties?: { REC_ID?: string | number; MAINROAD?: string; CROSSROAD?: string; IMAGEURL?: string } };
type DriveBcCamera = { id?: string | number; name?: string; caption?: string; location?: { coordinates?: unknown }; links?: { imageDisplay?: string } };

function listOf<T>(value: unknown, keys: string[] = []) {
  if (Array.isArray(value)) return value as T[];
  if (!value || typeof value !== "object") return [] as T[];
  const record = value as Record<string, unknown>;
  for (const key of keys) if (Array.isArray(record[key])) return record[key] as T[];
  return [] as T[];
}

export async function getOntarioCctv(context: CctvOutputContext): Promise<CameraAdapter> {
  const data = await fetchJson<unknown>("https://511on.ca/api/v2/get/cameras", undefined, 15_000);
  return result(context, listOf<OntarioCamera>(data, ["cameras", "items"]).map((camera, index) => ({
    id: asString(camera.id) || asString(camera.Id) || String(index),
    name: asString(camera.description) || asString(camera.name) || asString(camera.Location) || `Ontario camera ${index + 1}`,
    lat: asNumber(camera.latitude ?? camera.Latitude),
    lng: asNumber(camera.longitude ?? camera.Longitude),
    source: "Ontario 511",
    feedUrl: camera.imageUrl || camera.url || camera.Views?.[0]?.Url,
    liveUrl: "https://511on.ca/",
    city: "Ontario",
    country: "Canada",
  })));
}

export async function getAlbertaCctv(context: CctvOutputContext): Promise<CameraAdapter> {
  const data = await fetchJson<unknown>("https://511.alberta.ca/api/v2/get/cameras", undefined, 15_000);
  return result(context, listOf<AlbertaCamera>(data, ["cameras", "items"]).map((camera, index) => ({ id: asString(camera.Id) || String(index), name: asString(camera.Location) || `Alberta camera ${index + 1}`, lat: asNumber(camera.Latitude), lng: asNumber(camera.Longitude), source: "Alberta 511", feedUrl: camera.Views?.[0]?.Url, liveUrl: "https://511.alberta.ca/", city: "Alberta", country: "Canada" })));
}

export async function getTorontoCctv(context: CctvOutputContext): Promise<CameraAdapter> {
  const data = await fetchJson<{ features?: TorontoFeature[] }>("https://ckan0.cf.opendata.inter.prod-toronto.ca/dataset/a3309088-5fd4-4d34-8297-77c8301840ac/resource/4a568300-c7f8-496d-b150-dff6f5dc6d4f/download/traffic-camera-list-4326.geojson", undefined, 15_000);
  return result(context, (data.features ?? []).map((feature, index) => {
    const coordinates = coordinatesOf(feature.geometry?.coordinates);
    const properties = feature.properties;
    return { id: asString(properties?.REC_ID) || String(index), name: [asString(properties?.MAINROAD), asString(properties?.CROSSROAD)].filter(Boolean).join(" / ") || `Toronto camera ${index + 1}`, lat: asNumber(coordinates[1]), lng: asNumber(coordinates[0]), source: "City of Toronto", feedUrl: properties?.IMAGEURL, liveUrl: "https://www.toronto.ca/services-payments/streets-parking-transportation/road-restrictions-closures/traffic-cameras/", city: "Toronto", country: "Canada" };
  }));
}

export async function getDriveBcCctv(context: CctvOutputContext): Promise<CameraAdapter> {
  const data = await fetchJson<unknown>("https://drivebc.ca/api/webcams", undefined, 15_000);
  return result(context, listOf<DriveBcCamera>(data, ["webcams", "items"]).map((camera, index) => {
    const coordinates = camera.location?.coordinates;
    return { id: asString(camera.id) || String(index), name: asString(camera.name) || asString(camera.caption) || `DriveBC camera ${index + 1}`, lat: asNumber(Array.isArray(coordinates) ? coordinates[1] : undefined), lng: asNumber(Array.isArray(coordinates) ? coordinates[0] : undefined), source: "DriveBC", feedUrl: absoluteHttps(camera.links?.imageDisplay, "https://drivebc.ca"), liveUrl: "https://www.drivebc.ca/", city: "British Columbia", country: "Canada" };
  }));
}

type IllinoisResponse = { cameraReports?: Array<{ id?: string | number; latitude?: number; longitude?: number; cameraName?: string; description?: string; imageUrl?: string; url?: string }> };

export async function getIllinoisCctv(context: CctvOutputContext): Promise<CameraAdapter> {
  const data = await fetchJson<IllinoisResponse>("https://www.travelmidwest.com/lmiga/cameraReport.json", undefined, 15_000);
  return result(context, (data.cameraReports ?? []).slice(0, 800).map((camera, index) => ({ id: asString(camera.id) || String(index), name: asString(camera.cameraName) || asString(camera.description) || `Illinois DOT camera ${index + 1}`, lat: asNumber(camera.latitude), lng: asNumber(camera.longitude), source: "Illinois DOT", feedUrl: camera.imageUrl || camera.url, liveUrl: "https://www.travelmidwest.com/", city: "Illinois", country: "United States" })));
}

type TaiwanCamera = { id?: string; gisy?: string | number; gisx?: string | number; stakenumber?: string; html?: string };

function taiwanCity(lat: number, lng: number) {
  if (lat > 24.9 && lat < 25.2 && lng > 121.4 && lng < 121.7) return "Taipei";
  if (lat > 24.0 && lat < 24.3 && lng > 120.5 && lng < 120.9) return "Taichung";
  if (lat > 22.5 && lat < 22.8 && lng > 120.1 && lng < 120.5) return "Kaohsiung";
  if (lat > 22.9 && lat < 23.1 && lng > 120.1 && lng < 120.3) return "Tainan";
  if (lat > 24.7 && lat < 25.0 && lng > 121.0 && lng < 121.5) return "Taoyuan";
  return "Taiwan";
}

export async function getTaiwanCctv(context: CctvOutputContext): Promise<CameraAdapter> {
  const cameras = await fetchJson<TaiwanCamera[]>("https://thbapp.thb.gov.tw/services/cctv/thb", { headers: { accept: "application/json" } }, 20_000);
  return result(context, cameras.map((camera, index) => {
    const lat = asNumber(camera.gisy);
    const lng = asNumber(camera.gisx);
    const feedBase = absoluteHttps(camera.html);
    const stake = asString(camera.stakenumber);
    return { id: asString(camera.id) || stake.replace(/[^a-z0-9]/gi, "-").toLowerCase() || String(index), name: stake || `THB camera ${index + 1}`, lat, lng, source: "Taiwan Highway Bureau", feedUrl: feedBase ? `${feedBase.replace(/\/$/, "")}/snapshot` : null, liveUrl: "https://thbapp.thb.gov.tw/", city: taiwanCity(lat, lng), country: "Taiwan" };
  }));
}
