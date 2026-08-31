import type { Entity, GraphNodeKind, Observation, ProviderSnapshot, Signal } from "../intelligence";

export type CatalogSourceMode = "live" | "cached" | "key_required" | "unavailable";

export type CatalogScalar = string | number | boolean | null;

export type CatalogPath = string;

export type CatalogValue =
  | CatalogScalar
  | { path: CatalogPath }
  | { template: string };

export type CatalogPredicate =
  | { field: CatalogPath; equals: CatalogScalar }
  | { field: CatalogPath; notEquals: CatalogScalar }
  | { field: CatalogPath; in: CatalogScalar[] }
  | { field: CatalogPath; exists: boolean }
  | { field: CatalogPath; gte: number }
  | { field: CatalogPath; lte: number }
  | { all: CatalogPredicate[] }
  | { any: CatalogPredicate[] }
  | { not: CatalogPredicate };

export type CatalogField = {
  label: string;
  value: CatalogValue;
  format?: "text" | "number" | "date" | "boolean";
};

export type CatalogDetail = {
  id: string;
  label: string;
  when?: CatalogPredicate;
};

export type CatalogLayer = {
  id: string;
  label: string;
  short: string;
  color: string;
  source: string;
  status: CatalogSourceMode;
  defaultEnabled?: boolean;
  details: CatalogDetail[];
};

export type ProviderAuth = {
  env: string;
  header?: string;
  query?: string;
};

export type ProviderMapping = {
  itemsPath?: CatalogPath;
  signalType?: string;
  entity?: {
    id: CatalogValue;
    name: CatalogValue;
    description?: CatalogValue;
    location: ProviderLocationMapping;
    risk?: CatalogValue;
    riskScore?: CatalogValue;
    observedAt?: CatalogValue;
    url?: CatalogValue;
    imageUrl?: CatalogValue;
    properties?: Record<string, CatalogValue>;
  };
  signal?: {
    id: CatalogValue;
    name: CatalogValue;
    description: CatalogValue;
    observedAt?: CatalogValue;
    location?: CatalogValue | ProviderLocationMapping;
    risk?: CatalogValue;
    riskScore?: CatalogValue;
    url?: CatalogValue;
    imageUrl?: CatalogValue;
    properties?: Record<string, CatalogValue>;
  };
};

export type ProviderLocationMapping = {
  lat: CatalogValue;
  lng: CatalogValue;
  label?: CatalogValue;
};

export type ProviderCachePolicy = {
  maxAgeSeconds: number;
  staleIfErrorSeconds?: number;
};

export type ProviderCoverage = "global" | "viewport";

export type ProviderViewport = {
  west: number;
  south: number;
  east: number;
  north: number;
};

export type ProviderRequest = {
  viewport?: ProviderViewport;
  zoom?: number;
};

export type ProviderDefinitionBase = {
  id: string;
  label: string;
  sourceId?: string;
  sourceMode?: CatalogSourceMode;
  /** Runtime-only switch; manifests cannot set this field. */
  enabled?: boolean;
  note?: string;
  domain: string;
  endpoint?: string;
  auth?: ProviderAuth;
  pollSeconds?: number;
  cache?: ProviderCachePolicy;
  coverage?: ProviderCoverage;
  mapping?: ProviderMapping;
};

export type ProviderKind = "http-json" | "geojson" | "rss" | "csv" | "code";
export type DeclarativeProviderKind = Exclude<ProviderKind, "code">;

export type ProviderDefinition = ProviderDefinitionBase & (
  | { type: DeclarativeProviderKind; implementation?: never }
  | { type: "code"; implementation: string }
);

export type ProviderManifestBase = Omit<ProviderDefinitionBase, "domain" | "enabled">;

export type ProviderManifest = ProviderManifestBase & (
  | { type: DeclarativeProviderKind; implementation?: never }
  | { type: "code"; implementation: string }
);

export type SignalDefinition = {
  id: string;
  label: string;
  providerId: string;
  subdomainId: string;
  when?: CatalogPredicate;
};

export type NodeDefinition = {
  label?: CatalogValue;
  detail?: CatalogValue;
  subgroup?: CatalogValue;
  fields?: CatalogField[];
  graphNodeType?: GraphNodeKind;
};

export type MenuActionDefinition = {
  id: string;
  label: string;
  kind: "open-url" | "agent-command";
  url?: CatalogValue;
  command?: string;
  requiresConfirmation?: boolean;
};

export type GraphDefinition = {
  nodeType?: GraphNodeKind;
  facts?: CatalogField[];
  wikidataProperties?: string[];
  resolver?: string;
  relations?: GraphRelationDefinition[];
};

export type GraphRelationPredicate =
  | { type: "distance-km"; lessThan: number }
  | { type: "same-field"; field: CatalogPath }
  | { type: "same-source" }
  | { type: "same-domain" }
  | { type: "same-type" };

export type GraphRelationDefinition = {
  id: string;
  label: string;
  score: number;
  when: GraphRelationPredicate;
  appendDistance?: boolean;
};

export type AgentContextDefinition = {
  include: string;
  limit?: number;
  description?: string;
};

export type AgentHelperPhase = "context" | "action-ready";

export type AgentHelperDefinition = {
  id: string;
  label: string;
  description: string;
  phase: AgentHelperPhase;
};

export type AgentRoleDefinition = {
  id: string;
  label: string;
  description: string;
  helpers: AgentHelperDefinition[];
};

export type AgentCapabilityDefinition = {
  id: string;
  label: string;
  description?: string;
  permission: "read" | "confirm" | "write";
  source?: "builtin" | "provider" | "custom";
  toolIds?: string[];
};

export type AgentToolDefinition = {
  id: string;
  label: string;
  description?: string;
  source: "builtin" | "provider" | "custom";
  handler?: string;
  permission: "read" | "confirm" | "write";
};

export type AgentPackDefinition = {
  context?: AgentContextDefinition[];
  capabilities?: AgentCapabilityDefinition[];
  tools?: AgentToolDefinition[];
};

export type SignalPackManifest = {
  domain: string;
  version: string;
  label: string;
  subdomains: Array<{ id: string; label: string }>;
  providers: ProviderManifest[];
  signals?: SignalDefinition[];
  presentation: {
    map: CatalogLayer;
    node?: NodeDefinition;
    menu?: MenuActionDefinition[];
    graph?: GraphDefinition;
  };
  agents?: AgentPackDefinition;
};

export type SignalPack = {
  domain: string;
  version: string;
  label: string;
  subdomains: Array<{ id: string; label: string }>;
  providers: ProviderDefinition[];
  signals?: SignalDefinition[];
  presentation: {
    map: CatalogLayer;
    node?: NodeDefinition;
    menu?: MenuActionDefinition[];
    graph?: GraphDefinition;
  };
  agents?: AgentPackDefinition;
};

export type ProviderImplementationContext = {
  pack: SignalPack;
  provider: ProviderDefinition;
  request: ProviderRequest;
};

export type ProviderImplementation = (context: ProviderImplementationContext) => Promise<ProviderSnapshot>;

export type ObservationKind = "entity" | "signal";

export type CatalogRuntime = {
  packs: SignalPack[];
  providers: ProviderDefinition[];
  layers: CatalogLayer[];
  sourceIds: string[];
  getPack: (domain: string) => SignalPack | undefined;
  getProvider: (id: string) => ProviderDefinition | undefined;
};

export type NormalizedObservation = Observation;

export type CatalogEntity = Entity;
export type CatalogSignal = Signal;
