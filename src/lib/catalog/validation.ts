import type { SignalPack } from "./types";

const supportedProviderKinds = ["http-json", "geojson", "rss", "csv", "code"] as const;

export function validateSignalPacks(packs: SignalPack[]): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  const providerIds = new Set<string>();
  for (const pack of packs) {
    if (!pack.domain.trim()) errors.push("pack is missing a domain");
    if (ids.has(pack.domain)) errors.push(`duplicate pack domain: ${pack.domain}`);
    ids.add(pack.domain);
    if (!pack.version) errors.push(`pack ${pack.domain} is missing a version`);
    if (!pack.label.trim()) errors.push(`pack ${pack.domain} is missing a label`);
    if (pack.presentation.map.id !== pack.domain) errors.push(`pack ${pack.domain} map id must match pack domain`);
    if (!pack.presentation.map.label.trim() || !pack.presentation.map.short.trim() || !pack.presentation.map.color.trim() || !pack.presentation.map.source.trim()) errors.push(`pack ${pack.domain} has an invalid presentation map`);
    const subdomainIds = new Set<string>();
    if (!pack.subdomains.length) errors.push(`pack ${pack.domain} must declare at least one subdomain`);
    for (const subdomain of pack.subdomains) {
      if (!subdomain.id.trim() || !subdomain.label.trim()) errors.push(`pack ${pack.domain} has an invalid subdomain`);
      if (subdomainIds.has(subdomain.id)) errors.push(`duplicate subdomain id in pack ${pack.domain}: ${subdomain.id}`);
      subdomainIds.add(subdomain.id);
    }
    const detailIds = new Set<string>();
    for (const detail of pack.presentation.map.details) {
      if (!detail.id.trim() || !detail.label.trim()) errors.push(`pack ${pack.domain} has an invalid map detail`);
      if (detailIds.has(detail.id)) errors.push(`duplicate map detail in pack ${pack.domain}: ${detail.id}`);
      detailIds.add(detail.id);
    }
    for (const provider of pack.providers) {
      if (!provider.id.trim() || !provider.label.trim()) errors.push(`pack ${pack.domain} has an invalid provider`);
      if (providerIds.has(provider.id)) errors.push(`duplicate provider id: ${provider.id}`);
      providerIds.add(provider.id);
      if (provider.domain !== pack.domain) errors.push(`provider ${provider.id} points at unknown domain ${provider.domain}`);
      if (!supportedProviderKinds.includes(provider.type)) errors.push(`provider ${provider.id} has an unsupported provider type ${provider.type}`);
      if (provider.type === "code" && !provider.implementation?.trim()) errors.push(`code provider ${provider.id} is missing an implementation id`);
      if (provider.type !== "code" && !provider.endpoint) errors.push(`${provider.type} provider ${provider.id} is missing an endpoint`);
      if (provider.type !== "code" && !provider.mapping?.entity && !provider.mapping?.signal) errors.push(`${provider.type} provider ${provider.id} needs an entity or signal mapping`);
      if (provider.endpoint) {
        try { new URL(provider.endpoint); } catch { errors.push(`provider ${provider.id} has an invalid endpoint`); }
      }
      if (provider.auth && !provider.auth.env.trim()) errors.push(`provider ${provider.id} has an invalid auth environment variable`);
      if (provider.cache && (!Number.isFinite(provider.cache.maxAgeSeconds) || provider.cache.maxAgeSeconds <= 0)) errors.push(`provider ${provider.id} has an invalid cache max age`);
      if (provider.cache?.staleIfErrorSeconds !== undefined && (!Number.isFinite(provider.cache.staleIfErrorSeconds) || provider.cache.staleIfErrorSeconds < 0)) errors.push(`provider ${provider.id} has an invalid stale cache age`);
      if (provider.mapping?.signalType && !(pack.signals ?? []).some((signal) => signal.id === provider.mapping?.signalType && signal.providerId === provider.id)) errors.push(`provider ${provider.id} references unknown signal type ${provider.mapping.signalType}`);
    }
    const signalIds = new Set<string>();
    for (const signal of pack.signals ?? []) {
      if (!signal.id.trim() || !signal.label.trim()) errors.push(`pack ${pack.domain} has an invalid signal definition`);
      if (signalIds.has(signal.id)) errors.push(`duplicate signal id in pack ${pack.domain}: ${signal.id}`);
      signalIds.add(signal.id);
      if (!pack.providers.some((provider) => provider.id === signal.providerId)) errors.push(`signal ${signal.id} references unknown provider ${signal.providerId}`);
      if (!signal.subdomainId || !subdomainIds.has(signal.subdomainId)) errors.push(`signal ${signal.id} references unknown subdomain ${signal.subdomainId || "(missing)"}`);
    }
    const actionIds = new Set<string>();
    for (const action of pack.presentation.menu ?? []) {
      if (!action.id.trim() || !action.label.trim()) errors.push(`pack ${pack.domain} has an invalid menu action`);
      if (actionIds.has(action.id)) errors.push(`duplicate menu action in pack ${pack.domain}: ${action.id}`);
      actionIds.add(action.id);
      if (action.kind === "open-url" && !action.url) errors.push(`menu action ${action.id} is missing a URL`);
      if (action.kind === "agent-command" && !action.command?.trim()) errors.push(`menu action ${action.id} is missing an agent command`);
    }
    const toolIds = new Set<string>();
    const capabilityIds = new Set<string>();
    for (const tool of pack.agents?.tools ?? []) {
      if (!tool.id.trim() || !tool.label.trim()) errors.push(`pack ${pack.domain} has an invalid agent tool`);
      if (toolIds.has(tool.id)) errors.push(`duplicate agent tool in pack ${pack.domain}: ${tool.id}`);
      toolIds.add(tool.id);
    }
    for (const capability of pack.agents?.capabilities ?? []) {
      if (capabilityIds.has(capability.id)) errors.push(`duplicate agent capability in pack ${pack.domain}: ${capability.id}`);
      capabilityIds.add(capability.id);
      for (const toolId of capability.toolIds ?? []) if (!toolIds.has(toolId)) errors.push(`agent capability ${capability.id} references unknown tool ${toolId}`);
    }
    const relationIds = new Set<string>();
    for (const relation of pack.presentation.graph?.relations ?? []) {
      if (!relation.id || !relation.label || relation.score <= 0) errors.push(`invalid graph relation in pack ${pack.domain}`);
      if (relationIds.has(relation.id)) errors.push(`duplicate graph relation in pack ${pack.domain}: ${relation.id}`);
      relationIds.add(relation.id);
    }
  }
  return errors;
}
