"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CircleNotch, Database, ShareNetwork, X } from "@phosphor-icons/react";
import type { Entity } from "@/src/lib/intelligence";
import { getSignalPack } from "@/src/lib/catalog/registry";
import { formatCatalogValue, resolveCatalogValue } from "@/src/lib/catalog/value";
import type { NormalizedObservation } from "@/src/lib/catalog/types";
import { observationsToEntities } from "@/src/lib/catalog/observations";
import type { NodeGraph, NodeGraphExpansion } from "@/src/lib/node-graph";
import { NodeRelationshipGraph } from "@/src/components/node-relationship-graph";

type NodeGraphSheetProps = {
  entity: Entity;
  observations: NormalizedObservation[];
  onClose: () => void;
};

function mergeGraph(graph: NodeGraph, expansion: NodeGraphExpansion): NodeGraph {
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  for (const node of expansion.nodes) if (!nodes.has(node.id)) nodes.set(node.id, node);
  const links = new Map(graph.links.map((link) => [`${link.source}:${link.target}:${link.label}`, link]));
  for (const link of expansion.links) links.set(`${link.source}:${link.target}:${link.label}`, link);
  return { ...graph, nodes: [...nodes.values()], links: [...links.values()] };
}

type InspectFact = { label: string; value: string };
type MapNodeWikidataState = NodeGraph["sources"]["wikidata"] | "checking";

function formatObserved(observedAt?: string) {
  return observedAt ? observedAt.replace("T", " ").replace(/\.\d{3}Z$/, "Z") : "—";
}

function rootFacts(entity: Entity): InspectFact[] {
  const common = [{ label: "SOURCE", value: entity.source.id.toUpperCase() || "MAP PROVIDER" }, { label: "OBSERVED", value: formatObserved(entity.observedAt) }];
  const configured = getSignalPack(entity.domain)?.presentation.node?.fields?.map((field) => ({ label: field.label, value: formatCatalogValue(resolveCatalogValue(entity, field.value), field.format) })).filter((fact) => fact.value !== "—") ?? [];
  return [...configured, ...common];
}

export function NodeGraphSheet({ entity, observations, onClose }: NodeGraphSheetProps) {
  const [graph, setGraph] = useState<NodeGraph | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanding, setExpanding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<NodeGraph["nodes"][number] | null>(null);
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(() => new Set());
  const [checkedMapNodes, setCheckedMapNodes] = useState<Map<string, MapNodeWikidataState>>(() => new Map());
  const resolvingMapNodes = useRef(new Set<string>());
  const entities = useMemo(() => observationsToEntities(observations), [observations]);
  const entityById = useMemo(() => new Map(entities.map((item) => [item.id, item])), [entities]);

  useEffect(() => {
    const controller = new AbortController();
    setGraph(null);
    setError(null);
    setLoading(true);
    setSelectedNode(null);
    setExpandedNodes(new Set());
    setCheckedMapNodes(new Map());
    const request = { selectedObservationId: entity.id };
    void fetch("/api/node-graph", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(request), signal: controller.signal })
      .then((response) => response.ok ? response.json() as Promise<NodeGraph> : response.json().then((body: { error?: string }) => Promise.reject(new Error(body.error ?? `Graph returned ${response.status}`))))
      .then((nextGraph) => {
        setGraph(nextGraph);
        setSelectedNode(nextGraph.nodes.find((node) => node.id === entity.id) ?? null);
      })
      .catch((cause: unknown) => { if (!(cause instanceof DOMException && cause.name === "AbortError")) setError(cause instanceof Error ? cause.message : "Graph request failed"); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [entity.id]);

  const resolveMapNode = useCallback(async (mapEntity: Entity, reportFailure = false) => {
    if (resolvingMapNodes.current.has(mapEntity.id)) return;
    resolvingMapNodes.current.add(mapEntity.id);
    setCheckedMapNodes((current) => new Map(current).set(mapEntity.id, "checking"));
    try {
      const response = await fetch("/api/node-graph", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ selectedObservationId: mapEntity.id }) });
      if (!response.ok) throw new Error(`Wikidata check returned ${response.status}`);
      const addition = await response.json() as NodeGraph;
      setGraph((current) => current ? mergeGraph(current, addition) : current);
      setCheckedMapNodes((current) => new Map(current).set(mapEntity.id, addition.sources.wikidata));
    } catch (cause) {
      setCheckedMapNodes((current) => new Map(current).set(mapEntity.id, "unavailable"));
      if (reportFailure) setError(cause instanceof Error ? cause.message : "Wikidata check failed");
    } finally {
      resolvingMapNodes.current.delete(mapEntity.id);
    }
  }, []);

  const selectNode = useCallback((node: NodeGraph["nodes"][number]) => {
    setSelectedNode(node);
    setError(null);
    const mapEntity = node.id === entity.id ? null : entityById.get(node.id);
    if (mapEntity && checkedMapNodes.get(mapEntity.id) !== "live" && checkedMapNodes.get(mapEntity.id) !== "no_match") {
      void resolveMapNode(mapEntity, true);
      return;
    }
    const wikidataId = node.wikidataId ?? (node.id.startsWith("wikidata:") ? node.id.slice("wikidata:".length) : "");
    if (!wikidataId || expandedNodes.has(wikidataId) || expanding) return;
    setExpanding(true);
    void fetch("/api/node-graph", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ expandId: wikidataId }) })
      .then((response) => response.ok ? response.json() as Promise<NodeGraphExpansion> : Promise.reject(new Error(`Graph expansion returned ${response.status}`)))
      .then((expansion) => {
        setGraph((current) => current ? mergeGraph(current, expansion) : current);
        setExpandedNodes((current) => new Set(current).add(wikidataId));
      })
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Graph expansion failed"))
      .finally(() => setExpanding(false));
  }, [checkedMapNodes, entity.id, entityById, expandedNodes, expanding, resolveMapNode]);

  const revealOutliers = useCallback((nodes: NodeGraph["nodes"]) => {
    const queue = nodes
      .filter((node) => node.id !== entity.id)
      .map((node) => entityById.get(node.id))
      .filter((item): item is Entity => Boolean(item))
      .filter((item) => !checkedMapNodes.has(item.id))
      .slice(0, 8);
    void (async () => { for (const mapEntity of queue) await resolveMapNode(mapEntity); })();
  }, [checkedMapNodes, entity.id, entityById, resolveMapNode]);

  const wikiState = graph?.sources.wikidata === "live" ? "WIKIDATA LIVE" : graph?.sources.wikidata === "no_match" ? "NO WIKIDATA MATCH" : "WIKIDATA UNAVAILABLE";
  const isRootSelected = selectedNode?.id === entity.id;
  const isCheckableMapNode = Boolean(selectedNode && !isRootSelected && entityById.has(selectedNode.id));
  const mapNodeWikidataState = selectedNode ? checkedMapNodes.get(selectedNode.id) : undefined;
  const selectedRelation = selectedNode && graph?.links.find((link) => link.target === selectedNode.id)?.label;
  const selectedFacts = selectedNode ? isRootSelected ? rootFacts(entity) : [
    { label: "RELATION", value: selectedRelation ?? "EXPLORED ENTITY" },
    { label: "CLASS", value: selectedNode.type.toUpperCase() },
    { label: "SOURCE", value: selectedNode.source === "wikidata" ? "WIKIDATA" : "MAP PROVIDER" },
    ...(selectedNode.wikidataId ? [{ label: "WIKIDATA", value: selectedNode.wikidataId }] : []),
  ] : [];
  return <aside className="node-graph-sheet" aria-label={`${entity.name} relationship graph`}>
    <header className="node-graph-sheet-head">
      <div><span className="eyebrow"><ShareNetwork size={15} weight="duotone" /> RELATIONSHIP / GRAPH</span><strong>{entity.name}</strong><small>TYPED PROVIDER INTEL + WIKIDATA</small></div>
      <button type="button" onClick={onClose} aria-label="Close relationship graph"><X size={18} /></button>
    </header>
    <section className="node-graph-sheet-meta" aria-label="Graph sources">
      <span><i className="local" /> PROVIDER / MAP <b>{graph?.sources.local ?? "—"}</b></span>
      <span><i className="wiki" /> {wikiState}</span>
      {graph?.sources.wikidataId && <a href={`https://www.wikidata.org/wiki/${graph.sources.wikidataId}`} target="_blank" rel="noreferrer">{graph.sources.wikidataId}</a>}
    </section>
    <section className="node-graph-sheet-canvas">
      {loading && <div className="node-graph-loading"><CircleNotch className="spin" size={20} /> Resolving direct relationships…</div>}
      {error && !graph && <div className="node-graph-empty"><b>GRAPH UNAVAILABLE</b><span>{error}</span></div>}
      {graph && <NodeRelationshipGraph nodes={graph.nodes} links={graph.links} rootId={graph.rootId} selectedNodeId={selectedNode?.id ?? graph.rootId} onNodeSelect={selectNode} onOutliersReveal={revealOutliers} />}
    </section>
    {selectedNode && <section className="node-graph-sheet-inspect"><div className="node-graph-sheet-inspect-head"><span>{isRootSelected ? "SELECTED MAP NODE" : selectedNode.source === "wikidata" ? "WIKIDATA ENTITY" : "PROVIDER RELATION"}</span><em>{isRootSelected ? entity.domain.toUpperCase() : selectedNode.source === "wikidata" ? expandedNodes.has(selectedNode.wikidataId ?? "") ? "EXPANDED" : expanding ? "EXPANDING…" : "SELECT TO EXPAND" : isCheckableMapNode ? mapNodeWikidataState === "live" ? "WIKIDATA LINKED" : mapNodeWikidataState === "no_match" ? "NO WIKIDATA MATCH" : mapNodeWikidataState === "unavailable" ? "WIKIDATA UNAVAILABLE" : "CHECKING WIKIDATA…" : selectedNode.type.toUpperCase()}</em></div><strong>{selectedNode.label}</strong>{selectedNode.detail && <small>{selectedNode.detail}</small>}<div className="node-graph-sheet-inspect-grid">{selectedFacts.slice(0, 8).map((fact) => <div key={fact.label}><span>{fact.label}</span><b title={fact.value}>{fact.value}</b></div>)}</div></section>}
    <footer><span><Database size={13} /> {graph ? `${graph.nodes.length} NODES · ${graph.links.length} LINKS` : "BUILDING GRAPH"}</span><span>{graph?.sources.error ? "LOCAL ONLY" : "SOURCE-LINKED"}</span></footer>
  </aside>;
}
