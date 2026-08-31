import { defaultCatalogLayerIds, getCatalog } from "./catalog/registry";
import { matchesCatalogPredicate } from "./catalog/value";

export type Domain = string & {};

export type Layer = {
  id: Domain;
  label: string;
  short: string;
  count: string;
  color: string;
  source: string;
  status: "live" | "cached" | "key_required" | "unavailable";
  packId?: string;
  defaultEnabled?: boolean;
};

export type SourceStatus = "live" | "cached" | "key_required" | "degraded" | "error" | "unavailable";

export type GeoPoint = { lat: number; lng: number };

export type Risk = "low" | "medium" | "high";

export type ObservationLocation = {
  coordinates?: GeoPoint;
  label?: string;
};

export type ObservationSource = {
  id: string;
  name: string;
  url?: string;
};

export type MediaHealth = {
  status: "healthy" | "degraded" | "blocked" | "unavailable";
  manifestStatus: number | null;
  cors: "allowed" | "blocked" | "unknown";
  geo: "clear" | "blocked" | "unknown";
  segmentFreshness: "fresh" | "stale" | "unknown";
  segmentAgeSeconds?: number | null;
  checkedAt: string;
  error?: string;
};

export type MediaSource =
  | { kind: "youtube"; url: string; channelId?: string; liveUrl?: string }
  | { kind: "hls"; url: string; liveUrl?: string; health?: MediaHealth; fallback?: MediaSource }
  | { kind: "mjpeg"; url: string; liveUrl?: string }
  | { kind: "jpg"; url: string; refreshSeconds?: number; liveUrl?: string }
  | { kind: "iframe"; url: string; liveUrl?: string }
  | { kind: "external"; url: string; reason?: string };

export type ObservationBase = {
  id: string;
  domain: Domain;
  subdomainId: string;
  name: string;
  description: string;
  risk: Risk;
  riskScore: number;
  location?: ObservationLocation;
  source: ObservationSource;
  providerId: string;
  observedAt: string;
  url?: string;
  imageUrl?: string;
  properties?: Record<string, string | number | boolean | null>;
  packId?: string;
  signalType?: string;
  media?: MediaSource;
  mediaSources?: MediaSource[];
};

export type Entity = ObservationBase & {
  kind: "entity";
  location: ObservationLocation & { coordinates: GeoPoint };
};

export type Signal = ObservationBase & {
  kind: "signal";
};

export type Observation = Entity | Signal;

export function riskFromScore(score: number): Risk {
  if (score >= 70) return "high";
  if (score >= 40) return "medium";
  return "low";
}

export function riskScoreFromLevel(risk: Risk): number {
  if (risk === "high") return 80;
  if (risk === "medium") return 50;
  return 20;
}

export type LayerDetail = {
  id: string;
  label: string;
  match: (entity: Entity) => boolean;
};

export type ProviderSnapshot = {
  domain: Domain;
  providerId: string;
  source: ObservationSource;
  status: SourceStatus;
  fetchedAt: string;
  observations: Observation[];
  error?: string;
  nextPollSeconds?: number;
  packId?: string;
};

export type CanonicalProviderSnapshot = ProviderSnapshot & { packId: string };

export type IntelligenceSnapshot = {
  fetchedAt: string;
  viewport: { west: number; south: number; east: number; north: number };
  snapshots: CanonicalProviderSnapshot[];
  observations: Observation[];
};

export type GraphNodeKind = "aircraft" | "vessel" | "satellite" | "device" | "organization" | "person" | "location" | "event" | "concept";

// Stable semantic colours for relationship graphs. These describe what a node
// is, rather than which provider happened to supply it.
export const graphNodeColors: Record<GraphNodeKind, string> = {
  aircraft: "#4ed4ff",
  vessel: "#55e0ad",
  satellite: "#c39aff",
  device: "#c5d46f",
  organization: "#f0c85d",
  person: "#b58cff",
  location: "#8de85b",
  event: "#ff9d62",
  concept: "#9cabb7",
};

export type GraphNode = {
  id: string;
  label: string;
  type: GraphNodeKind;
  color: string;
  detail?: string;
  source?: "local" | "wikidata";
  wikidataId?: string;
  inSystem?: boolean;
  x?: number;
  y?: number;
};

export type GraphLink = { source: string; target: string; label: string };

export const layers: Layer[] = getCatalog().layers.map((layer) => ({ ...layer, id: layer.id, count: "—", packId: layer.id }));

export const defaultLayerIds = defaultCatalogLayerIds();

export const layerDetails: Record<string, LayerDetail[]> = Object.fromEntries(
  getCatalog().layers.map((layer) => [layer.id, layer.details.map((item) => ({ id: item.id, label: item.label, match: (entity: Entity) => matchesCatalogPredicate(entity, item.when) }))]),
);

export const signals: Signal[] = [];

export const entities: Entity[] = [];

export const graphNodes: GraphNode[] = [];

export const graphLinks: GraphLink[] = [];

export const formatTime = () => new Date().toISOString().slice(11, 19) + "Z";
