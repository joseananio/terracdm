import type { GraphDefinition, ProviderManifest, SignalDefinition, SignalPackManifest } from "../lib/catalog/types";

export const detail = (id: string, label: string, when?: SignalPackManifest["presentation"]["map"]["details"][number]["when"]) => ({ id, label, when });

const relations: NonNullable<GraphDefinition["relations"]> = [
  { id: "nearby", label: "NEARBY", score: 4, when: { type: "distance-km", lessThan: 750 }, appendDistance: true },
  { id: "same-source", label: "SAME AGENCY", score: 5, when: { type: "same-source" } },
  { id: "same-country", label: "SAME COUNTRY", score: 4, when: { type: "same-field", field: "country" } },
  { id: "same-domain", label: "SAME DOMAIN", score: 3, when: { type: "same-domain" } },
];

export function graph(definition: Omit<GraphDefinition, "relations">): GraphDefinition {
  return { ...definition, relations };
}

export type BuiltInPackDefinition = {
  domain: string;
  label: string;
  short: string;
  color: string;
  source: string;
  sourceId: string;
  status: SignalPackManifest["presentation"]["map"]["status"];
  defaultEnabled?: boolean;
  subdomains: SignalPackManifest["subdomains"];
  graph: GraphDefinition;
  details: SignalPackManifest["presentation"]["map"]["details"];
  implementation?: string;
  providers?: ProviderManifest[];
  signals?: SignalDefinition[];
  signal?: { id: string; label: string; subdomainId: string };
};

export function defineCodePackManifest(input: BuiltInPackDefinition): SignalPackManifest {
  const signals = input.signals ?? [{
    id: input.signal?.id ?? `${input.domain}.observation`,
    label: input.signal?.label ?? `${input.label} observation`,
    providerId: input.sourceId,
    subdomainId: input.signal?.subdomainId ?? input.subdomains[0].id,
  }];
  const providers = (input.providers ?? [{
    id: input.sourceId,
    label: input.source,
    sourceId: input.sourceId,
    sourceMode: input.status,
    type: "code" as const,
    implementation: input.implementation ?? `pack:${input.domain}`,
  }]).map((provider) => ({
    ...provider,
    cache: provider.cache ?? { maxAgeSeconds: provider.pollSeconds ?? 60, staleIfErrorSeconds: Math.max(300, (provider.pollSeconds ?? 60) * 5) },
    coverage: provider.coverage ?? "global" as const,
  }));

  return {
    domain: input.domain,
    version: "1.0.0",
    label: input.label,
    subdomains: input.subdomains,
    providers,
    signals,
    presentation: {
      map: { id: input.domain, label: input.label, short: input.short, color: input.color, source: input.source, status: input.status, defaultEnabled: input.defaultEnabled, details: input.details },
      graph: input.graph,
    },
    agents: {
      context: signals.map((signal) => ({ include: signal.id, limit: 80, description: `${signal.label} observations loaded in the current map context` })),
      capabilities: [{ id: `${input.domain}.signal-search`, label: `Search ${input.label}`, description: `Search loaded ${input.label.toLowerCase()} signals`, permission: "read", source: "builtin", toolIds: [`${input.domain}.signal-search`] }],
      tools: [{ id: `${input.domain}.signal-search`, label: `Search ${input.label}`, description: `Search loaded ${input.label.toLowerCase()} signals`, source: "builtin", handler: "search_signals", permission: "read" }],
    },
  };
}
