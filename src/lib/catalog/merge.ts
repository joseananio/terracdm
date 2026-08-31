import type {
  AgentPackDefinition,
  CatalogLayer,
  GraphDefinition,
  MenuActionDefinition,
  NodeDefinition,
  SignalPackManifest,
} from "./types";

function deepEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (typeof left !== "object" || left === null || typeof right !== "object" || right === null) return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    return left.every((value, index) => deepEqual(value, right[index]));
  }
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  if (leftKeys.length !== rightKeys.length || leftKeys.some((key, index) => key !== rightKeys[index])) return false;
  return leftKeys.every((key) => deepEqual((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key]));
}

function conflict(domain: string, path: string) {
  throw new Error(`Cannot merge signal packs for domain ${domain}: conflicting ${path}`);
}

function mergeDefined<T>(values: Array<T | undefined>, domain: string, path: string): T | undefined {
  let merged: T | undefined;
  for (const value of values) {
    if (value === undefined) continue;
    if (merged !== undefined && !deepEqual(merged, value)) conflict(domain, path);
    merged = value;
  }
  return merged;
}

function mergeRequired<T>(values: T[], domain: string, path: string): T {
  const merged = mergeDefined(values, domain, path);
  if (merged === undefined) throw new Error(`Cannot merge signal packs for domain ${domain}: missing ${path}`);
  return merged;
}

function mergeById<T extends { id: string }>(values: T[][], domain: string, path: string) {
  const merged: T[] = [];
  const byId = new Map<string, T>();
  for (const items of values) {
    for (const item of items) {
      const existing = byId.get(item.id);
      if (existing) {
        if (!deepEqual(existing, item)) conflict(domain, `${path}.${item.id}`);
        continue;
      }
      byId.set(item.id, item);
      merged.push(item);
    }
  }
  return merged;
}

function mergeUnique<T>(values: T[][]) {
  const merged: T[] = [];
  for (const items of values) {
    for (const item of items) if (!merged.some((candidate) => deepEqual(candidate, item))) merged.push(item);
  }
  return merged;
}

function mergeCatalogLayer(layers: CatalogLayer[], domain: string): CatalogLayer {
  return {
    id: mergeRequired(layers.map((layer) => layer.id), domain, "presentation.map.id"),
    label: mergeRequired(layers.map((layer) => layer.label), domain, "presentation.map.label"),
    short: mergeRequired(layers.map((layer) => layer.short), domain, "presentation.map.short"),
    color: mergeRequired(layers.map((layer) => layer.color), domain, "presentation.map.color"),
    source: mergeRequired(layers.map((layer) => layer.source), domain, "presentation.map.source"),
    status: mergeRequired(layers.map((layer) => layer.status), domain, "presentation.map.status"),
    ...(mergeDefined(layers.map((layer) => layer.defaultEnabled), domain, "presentation.map.defaultEnabled") !== undefined
      ? { defaultEnabled: mergeDefined(layers.map((layer) => layer.defaultEnabled), domain, "presentation.map.defaultEnabled") }
      : {}),
    details: mergeById(layers.map((layer) => layer.details), domain, "presentation.map.details"),
  };
}

function mergeNode(nodes: Array<NodeDefinition | undefined>, domain: string): NodeDefinition | undefined {
  if (!nodes.some(Boolean)) return undefined;
  const label = mergeDefined(nodes.map((node) => node?.label), domain, "presentation.node.label");
  const detail = mergeDefined(nodes.map((node) => node?.detail), domain, "presentation.node.detail");
  const subgroup = mergeDefined(nodes.map((node) => node?.subgroup), domain, "presentation.node.subgroup");
  const graphNodeType = mergeDefined(nodes.map((node) => node?.graphNodeType), domain, "presentation.node.graphNodeType");
  const fields = mergeUnique(nodes.map((node) => node?.fields ?? []));
  return {
    ...(label !== undefined ? { label } : {}),
    ...(detail !== undefined ? { detail } : {}),
    ...(subgroup !== undefined ? { subgroup } : {}),
    ...(fields.length ? { fields } : {}),
    ...(graphNodeType !== undefined ? { graphNodeType } : {}),
  };
}

function mergeGraph(graphs: Array<GraphDefinition | undefined>, domain: string): GraphDefinition | undefined {
  if (!graphs.some(Boolean)) return undefined;
  const nodeType = mergeDefined(graphs.map((graph) => graph?.nodeType), domain, "presentation.graph.nodeType");
  const resolver = mergeDefined(graphs.map((graph) => graph?.resolver), domain, "presentation.graph.resolver");
  const facts = mergeUnique(graphs.map((graph) => graph?.facts ?? []));
  const wikidataProperties = mergeUnique(graphs.map((graph) => graph?.wikidataProperties ?? []));
  const relations = mergeById(graphs.map((graph) => graph?.relations ?? []), domain, "presentation.graph.relations");
  return {
    ...(nodeType !== undefined ? { nodeType } : {}),
    ...(facts.length ? { facts } : {}),
    ...(wikidataProperties.length ? { wikidataProperties } : {}),
    ...(resolver !== undefined ? { resolver } : {}),
    ...(relations.length ? { relations } : {}),
  };
}

function mergeMenu(menus: Array<MenuActionDefinition[] | undefined>, domain: string) {
  if (!menus.some((menu) => menu !== undefined)) return undefined;
  return mergeById(menus.map((menu) => menu ?? []), domain, "presentation.menu");
}

function mergeAgents(agents: Array<AgentPackDefinition | undefined>, domain: string): AgentPackDefinition | undefined {
  if (!agents.some(Boolean)) return undefined;
  const context = mergeUnique(agents.map((agent) => agent?.context ?? []));
  const capabilities = mergeById(agents.map((agent) => agent?.capabilities ?? []), domain, "agents.capabilities");
  const tools = mergeById(agents.map((agent) => agent?.tools ?? []), domain, "agents.tools");
  return {
    ...(context.length ? { context } : {}),
    ...(capabilities.length ? { capabilities } : {}),
    ...(tools.length ? { tools } : {}),
  };
}

/**
 * Combines contributions to one domain without allowing one contribution to
 * silently replace another. Arrays with stable ids are merged by id; arrays
 * without ids are merged by deep equality. Scalar metadata must agree.
 */
export function mergeSignalPackManifest(contributions: SignalPackManifest[]): SignalPackManifest {
  if (!contributions.length) throw new Error("Cannot merge an empty signal pack contribution set");
  const domain = contributions[0].domain;
  if (contributions.some((contribution) => contribution.domain !== domain)) throw new Error(`Cannot merge signal packs with different domains: ${domain}`);
  const presentation = contributions.map((contribution) => contribution.presentation);
  const signals = mergeById(contributions.map((contribution) => contribution.signals ?? []), domain, "signals");
  const agents = mergeAgents(contributions.map((contribution) => contribution.agents), domain);
  const menu = mergeMenu(presentation.map((item) => item.menu), domain);
  return {
    domain,
    version: mergeRequired(contributions.map((contribution) => contribution.version), domain, "version"),
    label: mergeRequired(contributions.map((contribution) => contribution.label), domain, "label"),
    subdomains: mergeById(contributions.map((contribution) => contribution.subdomains), domain, "subdomains"),
    providers: mergeById(contributions.map((contribution) => contribution.providers), domain, "providers"),
    ...(signals.length || contributions.some((contribution) => contribution.signals !== undefined) ? { signals } : {}),
    presentation: {
      map: mergeCatalogLayer(presentation.map((item) => item.map), domain),
      ...(mergeNode(presentation.map((item) => item.node), domain) ? { node: mergeNode(presentation.map((item) => item.node), domain) } : {}),
      ...(menu !== undefined ? { menu } : {}),
      ...(mergeGraph(presentation.map((item) => item.graph), domain) ? { graph: mergeGraph(presentation.map((item) => item.graph), domain) } : {}),
    },
    ...(agents !== undefined ? { agents } : {}),
  };
}

/** Merges contributions while preserving first-seen domain order. */
export function mergeSignalPackManifests(contributions: SignalPackManifest[]): SignalPackManifest[] {
  const grouped = new Map<string, SignalPackManifest[]>();
  for (const contribution of contributions) grouped.set(contribution.domain, [...(grouped.get(contribution.domain) ?? []), contribution]);
  return [...grouped.values()].map(mergeSignalPackManifest);
}
