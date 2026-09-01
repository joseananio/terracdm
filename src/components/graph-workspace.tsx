"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowClockwise, CircleNotch, MagnifyingGlass, ShareNetwork, X } from "@phosphor-icons/react";
import { NodeRelationshipGraph } from "@/src/components/node-relationship-graph";
import type { WorkspaceSearchCorpus } from "@/src/components/map-workspace";
import type { GraphLink, GraphNode } from "@/src/lib/intelligence";
import type { NodeGraph, NodeGraphExpansion } from "@/src/lib/node-graph";
import type { InspectorRef } from "@/src/lib/workspace-shell-state";

type GraphFilter = "all" | "system" | "external";
const GRAPH_NODE_LIMIT = 100;

type Props = {
  corpus: WorkspaceSearchCorpus;
  focusId?: string | null;
  focusToken?: number;
  expandId?: string | null;
  onInspect: (content: InspectorRef) => void;
};

function mergeGraph(graph: NodeGraph, expansion: NodeGraphExpansion): NodeGraph {
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  expansion.nodes.forEach((node) => nodes.set(node.id, { ...nodes.get(node.id), ...node }));
  const links = new Map(graph.links.map((link) => [`${link.source}:${link.target}:${link.label}`, link]));
  expansion.links.forEach((link) => links.set(`${link.source}:${link.target}:${link.label}`, link));
  return { ...graph, nodes: [...nodes.values()], links: [...links.values()] };
}

function graphNodeId(value: string) {
  return value.startsWith("signal:") ? value.slice("signal:".length) : value;
}

function matches(query: string, node: GraphNode) {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return true;
  const text = `${node.label} ${node.detail ?? ""} ${node.type} ${node.source ?? ""}`.toLowerCase();
  return terms.every((term) => text.includes(term));
}

function capLinks(links: GraphLink[], visibleIds: Set<string>, maxDegree = 7) {
  const degree = new Map<string, number>();
  return links.filter((link) => {
    if (!visibleIds.has(link.source) || !visibleIds.has(link.target)) return false;
    const sourceDegree = degree.get(link.source) ?? 0;
    const targetDegree = degree.get(link.target) ?? 0;
    if (sourceDegree >= maxDegree || targetDegree >= maxDegree) return false;
    degree.set(link.source, sourceDegree + 1);
    degree.set(link.target, targetDegree + 1);
    return true;
  });
}

export function GraphWorkspace({ corpus, focusId, focusToken, expandId, onInspect }: Props) {
  const [graph, setGraph] = useState<NodeGraph | null>(null);
  const [selected, setSelected] = useState<GraphNode | null>(null);
  const [filter, setFilter] = useState<GraphFilter>("all");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [expanding, setExpanding] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setGraph(null);
    setSelected(null);
    setExpanded(new Set());
    setLoading(true);
    setError(null);
    const selectedObservationId = focusId ? graphNodeId(focusId) : "";
    const request = selectedObservationId ? { selectedObservationId } : { limit: 180 };
    void fetch("/api/node-graph", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(request), signal: controller.signal })
      .then((response) => response.ok ? response.json() as Promise<NodeGraph> : response.json().then((body: { error?: string }) => Promise.reject(new Error(body.error ?? `Graph returned ${response.status}`))))
      .then((nextGraph) => {
        setGraph(nextGraph);
        const raw = window.localStorage.getItem("terracdm:graph:handoff");
        if (raw) {
          window.localStorage.removeItem("terracdm:graph:handoff");
          try {
            const handoff = JSON.parse(raw) as { itemIds?: string[]; development?: { signalIds?: string[]; entityIds?: string[] } };
            const itemIds = handoff.itemIds ?? [];
            const ids = [...itemIds, ...itemIds.map((id) => `signal:${id}`), ...(handoff.development?.entityIds ?? []), ...(handoff.development?.signalIds ?? []).map((id) => `signal:${id}`)];
            const focus = ids.map((id) => nextGraph.nodes.find((node) => node.id === id)).find(Boolean);
            if (focus) setSelected(focus);
          } catch { /* Ignore malformed graph handoffs. */ }
        }
      })
      .catch((cause: unknown) => { if (!(cause instanceof DOMException && cause.name === "AbortError")) setError(cause instanceof Error ? cause.message : "Graph could not be loaded"); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [focusId, focusToken, reloadToken]);

  useEffect(() => {
    if (!graph || !focusId) return;
    const focus = graph.nodes.find((node) => node.id === focusId || node.id === `signal:${focusId}`);
    if (focus) setSelected(focus);
  }, [focusId, graph]);

  const visibleNodeLimit = GRAPH_NODE_LIMIT + expanded.size * 24;
  const visibleNodes = useMemo(() => (graph?.nodes ?? []).filter((node) => filter === "all" || (filter === "system" ? node.source === "local" : node.source !== "local")).filter((node) => matches(query, node)).slice(0, visibleNodeLimit), [filter, graph?.nodes, query, visibleNodeLimit]);
  const visibleIds = useMemo(() => new Set(visibleNodes.map((node) => node.id)), [visibleNodes]);
  const visibleLinks = useMemo(() => capLinks(graph?.links ?? [], visibleIds), [graph?.links, visibleIds]);
  const expandNode = (node: GraphNode) => {
    const wikidataId = node.wikidataId ?? (node.id.startsWith("wikidata:") ? node.id.slice("wikidata:".length) : "");
    const request = wikidataId ? { expandId: wikidataId } : { selectedObservationId: graphNodeId(node.id) };
    const expansionKey = wikidataId ? wikidataId : `node:${node.id}`;
    if (expanded.has(expansionKey) || expanding) return;
    setSelected(node);
    setError(null);
    setExpanding(true);
    void fetch("/api/node-graph", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(request) })
      .then((response) => response.ok ? response.json() as Promise<NodeGraphExpansion> : response.json().then((body: { error?: string }) => Promise.reject(new Error(body.error ?? `Graph expansion returned ${response.status}`))))
      .then((addition) => { setGraph((current) => current ? mergeGraph(current, addition) : current); setExpanded((current) => new Set(current).add(expansionKey)); })
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Graph expansion failed"))
      .finally(() => setExpanding(false));
  };

  const selectNode = (node: GraphNode) => {
    setSelected(node);
    setError(null);
    const record = selectedRecordFor(node);
    if (record) {
      onInspect({ kind: node.id.startsWith("signal:") ? "signal" : "entity", id: record.id, sourceLens: "graph" });
    } else {
      onInspect({ kind: "node", id: node.id, sourceLens: "graph", title: node.label, body: node.detail ?? "No additional detail available.", nodeType: node.type, nodeSource: node.source });
    }
  };

  useEffect(() => {
    if (!graph || !expandId) return;
    const node = graph.nodes.find((candidate) => candidate.id === expandId || candidate.id === `signal:${expandId}`);
    if (node) expandNode(node);
  }, [expandId, graph]);

  function selectedRecordFor(node: GraphNode) {
    const records = node.id.startsWith("signal:") ? corpus.signals : corpus.entities;
    const id = graphNodeId(node.id);
    return records.find((item) => item.id === id) ?? records.find((item) => item.name === node.label || item.name.startsWith(node.label));
  }

  return <section className="workspace-foundation graph-workspace" aria-labelledby="workspace-graph-title">
    <div className="graph-stage">
      <div className="graph-toolbar"><div className="graph-toolbar-title"><ShareNetwork size={16} /><span id="workspace-graph-title">Relationship graph</span>{graph && <em>{visibleNodes.length}{graph.nodes.length > GRAPH_NODE_LIMIT ? ` / ${graph.nodes.length}` : ""} nodes</em>}</div><label><MagnifyingGlass size={14} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter graph" aria-label="Filter graph" />{query && <button type="button" onClick={() => setQuery("")} aria-label="Clear graph filter"><X size={13} /></button>}</label><nav aria-label="Graph filters">{(["all", "system", "external"] as GraphFilter[]).map((value) => <button type="button" key={value} className={filter === value ? "active" : ""} onClick={() => setFilter(value)}>{value}</button>)}</nav><button className="graph-refresh" type="button" onClick={() => { setGraph(null); setSelected(null); setExpanded(new Set()); setReloadToken((token) => token + 1); }} title="Reload graph" aria-label="Reload graph"><ArrowClockwise size={15} /></button></div>
      {error && <div className="graph-error"><span>{error}</span><button type="button" onClick={() => { setError(null); setReloadToken((token) => token + 1); }}>Retry</button></div>}
      {loading && <div className="graph-state"><CircleNotch className="spin" size={20} /><span>Resolving relationship context…</span></div>}
      {!loading && !error && !visibleNodes.length && <div className="graph-state"><ShareNetwork size={23} /><span>No graph nodes match this filter.</span></div>}
      {!loading && !error && visibleNodes.length > 0 && graph && <NodeRelationshipGraph nodes={visibleNodes} links={visibleLinks} rootId={graph.rootId} selectedNodeId={selected?.id} onNodeSelect={selectNode} onNodeExpand={expandNode} />}
      {!loading && !error && graph && <div className="graph-stats"><ShareNetwork size={12} />{visibleNodes.length} shown · {visibleLinks.length} links</div>}
    </div>
  </section>;
}
