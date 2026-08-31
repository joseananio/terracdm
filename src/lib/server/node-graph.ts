import { graphNodeColors, type GraphLink, type GraphNode, type Signal } from "@/src/lib/intelligence";
import { agentHelpers } from "../catalog/agents";
import { graphDistanceKm, packGraphRelation } from "../catalog/graph";
import { getSignalPack } from "../catalog/registry";
import { formatCatalogValue, resolveCatalogValue } from "../catalog/value";
import type { NodeGraph, NodeGraphEntity, NodeGraphExpansion } from "@/src/lib/node-graph";
import { fetchJson } from "@/src/lib/server/fetch-json";
import { findObservationById, queryObservations, type ObservationQuery } from "@/src/lib/server/observation-repository";
import { getGraphImplementation } from "./pack-registry";
import type { GraphImplementation, GraphWikidataResult } from "./pack-implementation-types";

type WikidataSearchResult = { id?: string; label?: string; description?: string; match?: { text?: string } };
type WikidataSearchResponse = { search?: WikidataSearchResult[] };
type WikidataSnak = { snaktype?: string; datavalue?: { value?: { id?: string } } };
type WikidataClaim = { mainsnak?: WikidataSnak };
type WikidataEntity = { id?: string; labels?: Record<string, { value?: string }>; descriptions?: Record<string, { value?: string }>; claims?: Record<string, WikidataClaim[]> };
type WikidataEntitiesResponse = { entities?: Record<string, WikidataEntity> };
type SparqlBinding = Record<string, { type?: string; value?: string }>;
type SparqlResponse = { results?: { bindings?: SparqlBinding[] } };

type CachedGraph = GraphWikidataResult;

const WIKIDATA_API = "https://www.wikidata.org/w/api.php";
const WIKIDATA_SPARQL = "https://query.wikidata.org/sparql";
const WIKIDATA_CACHE_TTL_MS = 24 * 60 * 60 * 1_000;
const WIKIDATA_CACHE_MAX_ENTRIES = 1_000;
const wikidataCache = new Map<string, { value: CachedGraph; expiresAt: number }>();
const wikidataInFlight = new Map<string, Promise<CachedGraph>>();

const expandableRelations: Record<string, { label: string; type: GraphNode["type"] }> = {
  P17: { label: "COUNTRY", type: "location" },
  P35: { label: "HEAD OF STATE", type: "person" },
  P36: { label: "CAPITAL", type: "location" },
  P47: { label: "BORDERS", type: "location" },
  P131: { label: "LOCATED IN", type: "location" },
  P137: { label: "OPERATED BY", type: "organization" },
  P127: { label: "OWNED BY", type: "organization" },
  P355: { label: "SUBSIDIARY", type: "organization" },
  P361: { label: "PART OF", type: "organization" },
  P463: { label: "MEMBER OF", type: "organization" },
  P159: { label: "HEADQUARTERS", type: "location" },
  P495: { label: "COUNTRY OF ORIGIN", type: "location" },
  P749: { label: "PARENT ORGANIZATION", type: "organization" },
  P169: { label: "CHIEF EXECUTIVE", type: "person" },
};

function wikidataPropertiesFor(domain: NodeGraphEntity["domain"]) {
  return getSignalPack(domain)?.presentation.graph?.wikidataProperties ?? [];
}

const registrationCountries = ([
  ["N", "United States"], ["G", "United Kingdom"], ["F", "France"], ["D", "Germany"], ["I", "Italy"],
  ["JA", "Japan"], ["HL", "South Korea"], ["B", "China"], ["VT", "India"], ["TC", "Turkey"],
  ["RA", "Russia"], ["UR", "Ukraine"], ["A6", "United Arab Emirates"], ["A7", "Qatar"], ["9V", "Singapore"],
  ["VH", "Australia"], ["C", "Canada"], ["PP", "Brazil"], ["PR", "Brazil"], ["EC", "Spain"], ["4X", "Israel"],
  ["HB", "Switzerland"], ["OE", "Austria"], ["PH", "Netherlands"], ["OO", "Belgium"], ["SE", "Sweden"],
] as Array<[string, string]>).sort((left, right) => right[0].length - left[0].length);

// Registration prefixes are already a country-level assertion, so use stable
// Wikidata ids here rather than creating an isolated local fact node. That
// keeps the relationship graph navigable even when the aircraft operator is
// unknown or its callsign lookup fails.
const registrationCountryWikidata: Record<string, string> = {
  "United States": "Q30",
  "United Kingdom": "Q145",
  France: "Q142",
  Germany: "Q183",
  Italy: "Q38",
  Japan: "Q17",
  "South Korea": "Q884",
  China: "Q148",
  India: "Q668",
  Turkey: "Q43",
  Russia: "Q159",
  Ukraine: "Q212",
  "United Arab Emirates": "Q878",
  Qatar: "Q846",
  Singapore: "Q334",
  Australia: "Q408",
  Canada: "Q16",
  Brazil: "Q155",
  Spain: "Q29",
  Israel: "Q801",
  Switzerland: "Q39",
  Austria: "Q40",
  Netherlands: "Q55",
  Belgium: "Q31",
  Sweden: "Q34",
  "Hong Kong": "Q8646",
  "New Zealand": "Q664",
};

function normalize(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/gi, " ").trim().toLowerCase();
}

function cleanText(value: unknown, limit = 120) {
  return typeof value === "string" ? value.replace(/[\u0000-\u001f]/g, " ").trim().slice(0, limit) : "";
}

function property(entity: NodeGraphEntity, key: string) {
  return entity.properties?.[key];
}

function propertyText(entity: NodeGraphEntity, key: string, limit = 120) {
  const value = property(entity, key);
  return typeof value === "string" || typeof value === "number" ? cleanText(String(value), limit) : "";
}

function wikidataUrl(params: Record<string, string>) {
  const url = new URL(WIKIDATA_API);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.toString();
}

async function wikidataFetch<T>(params: Record<string, string>) {
  return fetchJson<T>(wikidataUrl({ action: "", format: "json", formatversion: "2", ...params }), {
    headers: { "user-agent": "TerraCDM relationship graph/0.2 (operator@terracdm.local)" },
  }, 8_000);
}

async function sparql(query: string) {
  const url = new URL(WIKIDATA_SPARQL);
  url.searchParams.set("query", query);
  url.searchParams.set("format", "json");
  const result = await fetchJson<SparqlResponse>(url.toString(), {
    headers: { accept: "application/sparql-results+json", "user-agent": "TerraCDM relationship graph/0.2 (operator@terracdm.local)" },
  }, 10_000);
  return result.results?.bindings ?? [];
}

function itemId(claim: WikidataClaim) {
  const id = claim.mainsnak?.snaktype === "value" ? claim.mainsnak.datavalue?.value?.id : undefined;
  return id && /^Q\d+$/.test(id) ? id : null;
}

function wikidataNode(id: string, label: string, detail: string | undefined, type: GraphNode["type"]): GraphNode {
  return { id: `wikidata:${id}`, wikidataId: id, label: label.slice(0, 48), detail: detail?.slice(0, 96), type, color: graphNodeColors[type], source: "wikidata" };
}

function localNode(id: string, label: string, detail: string, type: GraphNode["type"]): GraphNode {
  return { id, label: label.slice(0, 48), detail: detail.slice(0, 96), type, color: graphNodeColors[type], source: "local" };
}

async function cachedGraph(key: string, loader: () => Promise<CachedGraph>) {
  const cached = wikidataCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    wikidataCache.delete(key);
    wikidataCache.set(key, cached);
    return cached.value;
  }
  if (!wikidataInFlight.has(key)) {
    wikidataInFlight.set(key, loader().then((value) => {
      if (value.status !== "unavailable") {
        if (wikidataCache.size >= WIKIDATA_CACHE_MAX_ENTRIES) wikidataCache.delete(wikidataCache.keys().next().value as string);
        wikidataCache.set(key, { value, expiresAt: Date.now() + WIKIDATA_CACHE_TTL_MS });
      }
      return value;
    }).finally(() => wikidataInFlight.delete(key)));
  }
  return wikidataInFlight.get(key)!;
}

async function searchExactWikidata(name: string) {
  const search = await wikidataFetch<WikidataSearchResponse>({ action: "wbsearchentities", search: name, language: "en", uselang: "en", type: "item", limit: "6" });
  const expected = normalize(name);
  return (search.search ?? []).find((item) => [item.label, item.match?.text].some((candidate) => normalize(candidate ?? "") === expected)) ?? null;
}

async function relationsForItem(id: string, propertyIds: string[], sourceId = "root"): Promise<CachedGraph> {
  try {
    const rootResponse = await wikidataFetch<WikidataEntitiesResponse>({ action: "wbgetentities", ids: id, props: "labels|descriptions|claims", languages: "en" });
    const root = rootResponse.entities?.[id];
    if (!root) return { status: "no_match", nodes: [], links: [] };
    const targets = propertyIds.flatMap((propertyId) => (root.claims?.[propertyId] ?? [])
      .map(itemId).filter((target): target is string => Boolean(target))
      .map((target) => ({ id: target, propertyId })))
      .filter((item, index, all) => all.findIndex((candidate) => candidate.id === item.id) === index)
      .slice(0, 10);
    if (!targets.length) return { status: "live", id, nodes: [], links: [] };
    const labels = await wikidataFetch<WikidataEntitiesResponse>({ action: "wbgetentities", ids: targets.map((item) => item.id).join("|"), props: "labels|descriptions", languages: "en" });
    const nodes: GraphNode[] = [];
    const links: GraphLink[] = [];
    for (const target of targets) {
      const entity = labels.entities?.[target.id];
      const label = entity?.labels?.en?.value;
      const relation = expandableRelations[target.propertyId];
      if (!label || !relation) continue;
      nodes.push(wikidataNode(target.id, label, entity?.descriptions?.en?.value, relation.type));
      links.push({ source: sourceId, target: `wikidata:${target.id}`, label: relation.label });
    }
    return { status: "live", id, nodes, links };
  } catch (error) {
    return { status: "unavailable", nodes: [], links: [], error: error instanceof Error ? error.message : "Wikidata request failed" };
  }
}

async function aviationWikidata(entity: NodeGraphEntity): Promise<CachedGraph> {
  const callsign = propertyText(entity, "callsign") || entity.name;
  const prefix = callsign.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 3);
  if (prefix.length < 2) return { status: "no_match", nodes: [], links: [] };
  try {
    const rows = await sparql(`SELECT ?item ?itemLabel WHERE { ?item wdt:P230 \"${prefix}\" . SERVICE wikibase:label { bd:serviceParam wikibase:language \"en\" . } } LIMIT 1`);
    const itemUrl = rows[0]?.item?.value ?? "";
    const id = itemUrl.match(/Q\d+$/)?.[0];
    const label = rows[0]?.itemLabel?.value;
    if (!id || !label) return { status: "no_match", nodes: [], links: [] };
    const operator = wikidataNode(id, label, "ICAO callsign operator", "organization");
    const connections = await relationsForItem(id, wikidataPropertiesFor(entity.domain), `wikidata:${id}`);
    return { ...connections, id, nodes: [operator, ...connections.nodes], links: [{ source: "root", target: operator.id, label: "OPERATED BY" }, ...connections.links] };
  } catch (error) {
    return { status: "unavailable", nodes: [], links: [], error: error instanceof Error ? error.message : "ICAO operator lookup failed" };
  }
}

async function cctvWikidata(entity: NodeGraphEntity): Promise<CachedGraph> {
  const agency = propertyText(entity, "source") || entity.source.name;
  if (!agency) return { status: "no_match", nodes: [], links: [] };
  return cachedGraph(`cctv-agency:${normalize(agency)}`, async () => {
    try {
      const found = await searchExactWikidata(agency);
      if (!found?.id || !found.label) return { status: "no_match", nodes: [], links: [] };
      const operator = wikidataNode(found.id, found.label, found.description ?? "Camera network operator", "organization");
      const connections = await relationsForItem(found.id, wikidataPropertiesFor(entity.domain), `wikidata:${found.id}`);
      return { ...connections, id: found.id, nodes: [operator, ...connections.nodes], links: [{ source: "root", target: operator.id, label: "OPERATED BY" }, ...connections.links] };
    } catch (error) {
      return { status: "unavailable", nodes: [], links: [], error: error instanceof Error ? error.message : "Camera agency lookup failed" };
    }
  });
}

async function entityWikidata(entity: NodeGraphEntity): Promise<CachedGraph> {
  const allowed = wikidataPropertiesFor(entity.domain);
  if (!allowed.length) return { status: "no_match", nodes: [], links: [] };
  const found = await searchExactWikidata(entity.name).catch(() => null);
  if (!found?.id) return { status: "no_match", nodes: [], links: [] };
  return relationsForItem(found.id, allowed);
}

async function typedWikidata(entity: NodeGraphEntity) {
  const cacheKey = [entity.domain, normalize(entity.name), propertyText(entity, "icao24"), propertyText(entity, "mmsi"), propertyText(entity, "noradId"), entity.source.id].join(":");
  const resolver = getSignalPack(entity.domain)?.presentation.graph?.resolver;
  const implementation = getGraphImplementation(resolver);
  return cachedGraph(cacheKey, () => implementation?.wikidata?.(entity) ?? entityWikidata(entity));
}

function aviationCountry(registration: string) {
  const normalized = registration.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return registrationCountries.find(([prefix]) => normalized.startsWith(prefix))?.[1];
}

function addSharedCountry(nodes: GraphNode[], links: GraphLink[], entity: NodeGraphEntity, country: string, detail: string, relation: string) {
  const wikidataId = registrationCountryWikidata[country];
  if (wikidataId) {
    const countryNode = wikidataNode(wikidataId, country, detail, "location");
    nodes.push(countryNode);
    links.push({ source: entity.id, target: countryNode.id, label: relation });
    return;
  }
  const countryId = `country:${normalize(country)}`;
  nodes.push(localNode(countryId, country, detail, "location"));
  links.push({ source: entity.id, target: countryId, label: relation });
}

function aviationFacts(entity: NodeGraphEntity, add: (id: string, label: string, detail: string, relation: string, type?: GraphNode["type"]) => void) {
  const aircraftClass = propertyText(entity, "aircraftClass");
  const aircraftType = propertyText(entity, "aircraftType");
  if (aircraftClass) add("class", aircraftClass.replace(/-/g, " ").toUpperCase(), "Provider aircraft classification", "CLASSIFICATION");
  if (aircraftType) add("model", aircraftType, "ADS-B aircraft type", "AIRCRAFT TYPE", "aircraft");
}

function maritimeFacts(entity: NodeGraphEntity, add: (id: string, label: string, detail: string, relation: string, type?: GraphNode["type"]) => void) {
  const vesselClass = propertyText(entity, "vesselClass");
  const destination = propertyText(entity, "destination");
  if (vesselClass) add("class", vesselClass.toUpperCase(), "AIS vessel classification", "VESSEL CLASS", "vessel");
  if (destination) add("destination", destination, "AIS reported destination", "DESTINATION", "location");
}

function spaceFacts(entity: NodeGraphEntity, add: (id: string, label: string, detail: string, relation: string, type?: GraphNode["type"]) => void) {
  const spaceClass = propertyText(entity, "spaceClass");
  const noradId = propertyText(entity, "noradId");
  if (spaceClass) add("class", spaceClass.replace(/-/g, " ").toUpperCase(), "CelesTrak classification", "MISSION CLASS");
  if (noradId) add("norad", `NORAD ${noradId}`, "Satellite catalogue identifier", "CATALOGUE ID");
}

function conflictFacts(entity: NodeGraphEntity, add: (id: string, label: string, detail: string, relation: string, type?: GraphNode["type"]) => void) {
  const actor1 = propertyText(entity, "actor1");
  const actor2 = propertyText(entity, "actor2");
  if (actor1) add("actor-1", actor1, "ACLED primary actor", "ACTOR", "organization");
  if (actor2) add("actor-2", actor2, "ACLED secondary actor", "COUNTERPART", "organization");
}

function cctvFacts(entity: NodeGraphEntity, add: (id: string, label: string, detail: string, relation: string, type?: GraphNode["type"]) => void) {
  const city = propertyText(entity, "city");
  if (city) add("city", city, "Camera provider location", "CITY", "location");
}

function newsFacts(entity: NodeGraphEntity, add: (id: string, label: string, detail: string, relation: string, type?: GraphNode["type"]) => void) {
  const mediaKind = propertyText(entity, "mediaKind");
  if (mediaKind) add("medium", mediaKind.toUpperCase(), "Live broadcast delivery", "MEDIUM");
}

function fireFacts(entity: NodeGraphEntity, add: (id: string, label: string, detail: string, relation: string, type?: GraphNode["type"]) => void) {
  const fireKind = propertyText(entity, "fireKind");
  const satellite = propertyText(entity, "satellite");
  if (fireKind) add("kind", fireKind.toUpperCase(), "Fire-domain observation type", "TYPE");
  if (satellite) add("satellite", satellite, "FIRMS thermal hotspot platform", "DETECTED BY");
}

function naturalHazardsFacts(entity: NodeGraphEntity, add: (id: string, label: string, detail: string, relation: string, type?: GraphNode["type"]) => void) {
  if (entity.subdomainId === "seismic") {
    const magnitude = propertyText(entity, "magnitude");
    const tsunami = propertyText(entity, "tsunami");
    if (magnitude) add("magnitude", `M ${magnitude}`, "USGS earthquake magnitude", "MAGNITUDE");
    if (tsunami === "true") add("tsunami", "TSUNAMI FLAGGED", "USGS tsunami indicator", "TSUNAMI STATUS");
    return;
  }
  const weatherType = propertyText(entity, "weatherType") || propertyText(entity, "type");
  if (weatherType) add("weather-type", weatherType.toUpperCase(), "Weather hazard type", "TYPE");
}

function localFacts(entity: NodeGraphEntity): NodeGraphExpansion {
  const nodes: GraphNode[] = [];
  const links: GraphLink[] = [];
  const add = (id: string, label: string, detail: string, relation: string, type: GraphNode["type"] = "concept") => {
    nodes.push(localNode(`${entity.id}:${id}`, label, detail, type));
    links.push({ source: entity.id, target: `${entity.id}:${id}`, label: relation });
  };
  const catalogFacts = getSignalPack(entity.domain)?.presentation.graph?.facts ?? getSignalPack(entity.domain)?.presentation.node?.fields ?? [];
  for (const fact of catalogFacts) {
    const value = formatCatalogValue(resolveCatalogValue(entity, fact.value), fact.format);
    if (value !== "—") add(`catalog:${fact.label}`, value, "Signal pack fact", fact.label);
  }
  const graphResolver = getSignalPack(entity.domain)?.presentation.graph?.resolver;
  const implementation = getGraphImplementation(graphResolver);
  implementation?.facts?.(entity, add);
  const registration = propertyText(entity, "registration");
  const registrationCountry = registration ? aviationCountry(registration) : undefined;
  const providerCountry = propertyText(entity, "country");
  const country = registrationCountry || providerCountry;
  if (country) {
    const countryRelation = implementation?.country?.(entity, registrationCountry);
    const relation = countryRelation?.relation ?? "LOCATED IN";
    const detail = countryRelation?.detail ?? "Provider location country";
    addSharedCountry(nodes, links, entity, country, detail, relation);
  }
  return { nodes, links };
}

function localConnection(root: NodeGraphEntity, candidate: NodeGraphEntity) {
  return packGraphRelation(root, candidate, getSignalPack);
}

function graphNodeKindForEntity(entity: NodeGraphEntity): GraphNode["type"] {
  const configured = getSignalPack(entity.domain)?.presentation.graph?.nodeType ?? getSignalPack(entity.domain)?.presentation.node?.graphNodeType;
  return configured ?? "organization";
}

function graphNodeForEntity(entity: NodeGraphEntity): GraphNode {
  const type = graphNodeKindForEntity(entity);
  return { id: entity.id, label: entity.name.slice(0, 48), detail: entity.description.slice(0, 96), type, color: graphNodeColors[type], source: "local", inSystem: true };
}

function graphNodeForSignal(signal: Signal): GraphNode {
  const configured = getSignalPack(signal.domain)?.presentation.graph?.nodeType;
  const type = configured ?? "event";
  return { id: `signal:${signal.id}`, label: signal.name.slice(0, 48), detail: signal.description.slice(0, 96), type, color: graphNodeColors[type], source: "local", inSystem: true };
}

function localGraphLinks(entities: NodeGraphEntity[]) {
  const links: GraphLink[] = [];
  for (let index = 0; index < entities.length; index += 1) {
    for (let targetIndex = index + 1; targetIndex < entities.length; targetIndex += 1) {
      const source = entities[index];
      const target = entities[targetIndex];
      const connection = localConnection(source, target);
      if (!connection) continue;
      links.push({ source: source.id, target: target.id, label: connection.relation });
    }
  }
  return links;
}

function nearestEntity(signal: Signal, entities: NodeGraphEntity[]) {
  const coordinates = signal.location?.coordinates;
  if (!coordinates) return null;
  return entities
    .map((entity) => ({ entity, distance: graphDistanceKm(entity, coordinates) }))
    .sort((left, right) => left.distance - right.distance)[0]?.entity ?? null;
}

/**
 * Builds a graph for a canonical observation context supplied by the server
 * repository. External enrichment belongs to the selected-node operation
 * below; every local relationship comes from the source and target packs.
 */
export function buildContextGraph(entities: NodeGraphEntity[], signals: Signal[] = []): Pick<NodeGraph, "rootId" | "nodes" | "links" | "sources" | "helpers" | "fetchedAt"> {
  const contextEntities = [...new Map(entities.map((entity) => [entity.id, entity])).values()].slice(0, 80);
  const contextSignals = [...new Map(signals.map((signal) => [signal.id, signal])).values()].slice(0, 40);
  const nodes = contextEntities.map(graphNodeForEntity);
  const links = localGraphLinks(contextEntities);
  const entityIds = new Set(contextEntities.map((entity) => entity.id));
  for (const signal of contextSignals) {
    const target = nearestEntity(signal, contextEntities);
    if (!target || !entityIds.has(target.id)) continue;
    nodes.push(graphNodeForSignal(signal));
    links.push({ source: `signal:${signal.id}`, target: target.id, label: "SIGNAL NEARBY" });
  }
  const uniqueNodes = [...new Map(nodes.map((node) => [node.id, node])).values()];
  const uniqueLinks = [...new Map(links.map((link) => [`${link.source}:${link.target}:${link.label}`, link])).values()];
  return {
    rootId: "context",
    nodes: uniqueNodes,
    links: uniqueLinks,
    sources: { local: uniqueLinks.length, wikidata: "no_match" },
    helpers: agentHelpers["entity-intel"],
    fetchedAt: new Date().toISOString(),
  };
}

export async function buildRepositoryContextGraph(query: Pick<ObservationQuery, "domains" | "limit"> = {}) {
  const limit = Math.min(query.limit ?? 120, 400);
  const [entityResult, signalResult] = await Promise.all([
    queryObservations({ kinds: ["entity"], domains: query.domains, limit }),
    queryObservations({ kinds: ["signal"], domains: query.domains, limit }),
  ]);
  return buildContextGraph(
    entityResult.observations.filter((observation): observation is NodeGraphEntity => observation.kind === "entity"),
    signalResult.observations.filter((observation): observation is Signal => observation.kind === "signal"),
  );
}

function materializeLinks(links: GraphLink[], rootId: string) {
  return links.map((link) => ({ ...link, source: link.source === "root" ? rootId : link.source }));
}

export async function buildNodeGraph(root: NodeGraphEntity, candidates: NodeGraphEntity[]): Promise<NodeGraph> {
  const [wikidata, facts] = await Promise.all([typedWikidata(root), Promise.resolve(localFacts(root))]);
  const local = candidates
    .filter((candidate) => candidate.id !== root.id)
    .map((candidate) => ({ candidate, connection: localConnection(root, candidate) }))
    .filter((item): item is { candidate: NodeGraphEntity; connection: NonNullable<ReturnType<typeof localConnection>> } => Boolean(item.connection))
    .sort((left, right) => right.connection.score - left.connection.score || left.connection.distance - right.connection.distance)
    .slice(0, 6);

  const nodes: GraphNode[] = [graphNodeForEntity(root), ...facts.nodes, ...wikidata.nodes];
  const links: GraphLink[] = [...facts.links, ...materializeLinks(wikidata.links, root.id)];
  for (const item of local) {
    nodes.push(graphNodeForEntity(item.candidate));
    links.push({ source: root.id, target: item.candidate.id, label: item.connection.relation });
  }
  const uniqueNodes = [...new Map(nodes.map((node) => [node.id, node])).values()];
  const uniqueLinks = [...new Map(links.map((link) => [`${link.source}:${link.target}:${link.label}`, link])).values()];
  const localFactCount = facts.nodes.filter((node) => node.source === "local").length;
  return { rootId: root.id, nodes: uniqueNodes, links: uniqueLinks, sources: { local: localFactCount + local.length, wikidata: wikidata.status, wikidataId: wikidata.id, error: wikidata.error }, helpers: agentHelpers["entity-intel"], fetchedAt: new Date().toISOString() };
}

export async function buildRepositoryNodeGraph(selectedObservationId: string) {
  const observation = await findObservationById(selectedObservationId);
  if (!observation) return { error: "The selected observation is not available in the server repository", status: 404 as const };
  if (observation.kind !== "entity") return { error: "A selected entity observation is required", status: 400 as const };

  const candidates = await queryObservations({ kinds: ["entity"], limit: 2_000 });
  return buildNodeGraph(
    observation,
    candidates.observations.filter((candidate): candidate is NodeGraphEntity => candidate.kind === "entity" && candidate.id !== observation.id),
  );
}

export async function expandNodeGraph(wikidataId: string): Promise<NodeGraphExpansion> {
  const id = wikidataId.replace(/^wikidata:/, "");
  if (!/^Q\d+$/.test(id)) return { nodes: [], links: [] };
  const graph = await cachedGraph(`expand:${id}`, () => relationsForItem(id, Object.keys(expandableRelations), `wikidata:${id}`));
  return { nodes: [wikidataNode(id, id, "Wikidata entity", "concept"), ...graph.nodes], links: graph.links };
}

export const aviationGraphImplementation: GraphImplementation = {
    wikidata: aviationWikidata,
    facts: aviationFacts,
    country: (entity, registrationCountry) => registrationCountry ? { relation: "REGISTERED IN", detail: `${propertyText(entity, "registration")} registration prefix` } : undefined,
};

export const maritimeGraphImplementation: GraphImplementation = { facts: maritimeFacts };
export const spaceGraphImplementation: GraphImplementation = { facts: spaceFacts };
export const conflictGraphImplementation: GraphImplementation = {
    facts: conflictFacts,
    country: () => ({ relation: "EVENT COUNTRY", detail: "ACLED event country" }),
};
export const cctvGraphImplementation: GraphImplementation = { wikidata: cctvWikidata, facts: cctvFacts };
export const newsGraphImplementation: GraphImplementation = { facts: newsFacts };
export const firesGraphImplementation: GraphImplementation = { facts: fireFacts };
export const naturalHazardsGraphImplementation: GraphImplementation = { facts: naturalHazardsFacts };
