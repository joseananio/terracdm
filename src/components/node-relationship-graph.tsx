"use client";

import { useCallback, useEffect, useId, useRef } from "react";
import * as d3 from "d3";
import { CrosshairSimple, Minus, Plus } from "@phosphor-icons/react";
import { graphNodeColors, type GraphLink, type GraphNode } from "@/src/lib/intelligence";

type NodeRelationshipGraphProps = {
  nodes: GraphNode[];
  links: GraphLink[];
  rootId: string;
  selectedNodeId?: string;
  onNodeSelect?: (node: GraphNode) => void;
  onOutliersReveal?: (nodes: GraphNode[]) => void;
};

const truncate = (value: string, limit: number) => value.length > limit ? `${value.slice(0, limit - 1)}…` : value;

export function NodeRelationshipGraph({ nodes, links, rootId, selectedNodeId, onNodeSelect, onOutliersReveal }: NodeRelationshipGraphProps) {
  const ref = useRef<SVGSVGElement>(null);
  const zoomRef = useRef<{ selection: d3.Selection<SVGSVGElement, unknown, null, undefined>; behavior: d3.ZoomBehavior<SVGSVGElement, unknown> } | null>(null);
  const outlierTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const zoomTransform = useRef(d3.zoomIdentity);
  const onNodeSelectRef = useRef(onNodeSelect);
  const onOutliersRevealRef = useRef(onOutliersReveal);
  const graphId = useId().replace(/:/g, "");
  const changeZoom = useCallback((action: "in" | "out" | "reset") => {
    const controller = zoomRef.current;
    if (!controller) return;
    const target = controller.selection.transition().duration(160);
    if (action === "reset") target.call(controller.behavior.transform, d3.zoomIdentity);
    else target.call(controller.behavior.scaleBy, action === "in" ? 1.35 : 1 / 1.35);
  }, []);

  useEffect(() => { onNodeSelectRef.current = onNodeSelect; }, [onNodeSelect]);
  useEffect(() => { onOutliersRevealRef.current = onOutliersReveal; }, [onOutliersReveal]);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const render = () => {
      const { width, height } = element.getBoundingClientRect();
      if (width < 10 || height < 10) return;
      const svg = d3.select(element);
      svg.selectAll("*").remove();
      svg.attr("viewBox", `0 0 ${width} ${height}`);
      const viewport = svg.append("g").attr("class", "node-graph-viewport");

      type SimNode = GraphNode & d3.SimulationNodeDatum;
      type SimLink = d3.SimulationLinkDatum<SimNode> & GraphLink;
      const graphNodes = nodes.map((node) => ({ ...node })) as SimNode[];
      const graphLinks = links.map((link) => ({ ...link })) as SimLink[];
      const nodeById = new Map(graphNodes.map((node) => [node.id, node]));
      const nodeColor = (node: GraphNode) => graphNodeColors[node.type];
      const localOutliers = graphNodes.filter((node) => node.id !== rootId && node.source === "local") as GraphNode[];
      const zoom = d3.zoom<SVGSVGElement, unknown>()
        .scaleExtent([0.5, 4])
        .on("zoom", (event) => {
          viewport.attr("transform", event.transform);
          zoomTransform.current = event.transform;
          if (event.transform.k > .82 || !localOutliers.length) return;
          if (outlierTimer.current) clearTimeout(outlierTimer.current);
          outlierTimer.current = setTimeout(() => onOutliersRevealRef.current?.(localOutliers), 180);
        });
      svg.call(zoom).on("dblclick.zoom", null);
      svg.call(zoom.transform, zoomTransform.current);
      zoomRef.current = { selection: svg, behavior: zoom };
      const root = graphNodes.find((node) => node.id === rootId);
      if (root) { root.fx = width * 0.48; root.fy = height * 0.5; }

      const defs = svg.append("defs");
      const glow = defs.append("filter").attr("id", `node-graph-glow-${graphId}`).attr("x", "-60%").attr("y", "-60%").attr("width", "220%").attr("height", "220%");
      glow.append("feGaussianBlur").attr("stdDeviation", "3.2").attr("result", "blur");
      const merge = glow.append("feMerge");
      merge.append("feMergeNode").attr("in", "blur");
      merge.append("feMergeNode").attr("in", "SourceGraphic");

      const simulation = d3.forceSimulation<SimNode>(graphNodes)
        .force("link", d3.forceLink<SimNode, SimLink>(graphLinks).id((node) => node.id).distance((link) => link.label.includes("NEARBY") ? 96 : 126).strength(.8))
        .force("charge", d3.forceManyBody().strength(-430))
        .force("center", d3.forceCenter(width * .49, height * .5))
        .force("collision", d3.forceCollide<SimNode>().radius((node) => node.id === rootId ? 62 : 48))
        .force("x", d3.forceX(width * .49).strength(.055))
        .force("y", d3.forceY(height * .5).strength(.055));

      const link = viewport.append("g").attr("class", "node-graph-links")
        .selectAll("line").data(graphLinks).join("line")
        .attr("stroke", (item) => nodeColor(nodeById.get(String(item.target)) ?? graphNodes[0]));

      const label = viewport.append("g").attr("class", "node-graph-link-labels")
        .selectAll("text").data(graphLinks.filter((item) => String(item.target).startsWith("wikidata:"))).join("text")
        .text((item) => item.label);

      const node = viewport.append("g").attr("class", "node-graph-nodes")
        .selectAll<SVGGElement, SimNode>("g").data(graphNodes).join("g")
        .attr("class", (item) => `node-graph-node ${item.id === rootId ? "is-root" : ""} ${item.inSystem ? "is-system" : ""} ${item.source === "wikidata" ? "is-wikidata" : "is-local"}`)
        .classed("is-selected", (item) => item.id === selectedNodeId)
        .attr("tabindex", 0)
        .attr("role", "button")
        .attr("aria-label", (item) => `${item.label}${item.detail ? `, ${item.detail}` : ""}`)
        .on("click", (_event, item) => onNodeSelectRef.current?.(item))
        .on("keydown", (event, item) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onNodeSelectRef.current?.(item); } })
        .call(d3.drag<SVGGElement, SimNode>()
          .on("start", (event, item) => { if (!event.active) simulation.alphaTarget(.22).restart(); item.fx = item.x; item.fy = item.y; })
          .on("drag", (event, item) => { item.fx = event.x; item.fy = event.y; })
          .on("end", (event, item) => { if (!event.active) simulation.alphaTarget(0); if (item.id !== rootId) { item.fx = null; item.fy = null; } }),
        );
      node.filter((item) => Boolean(item.inSystem)).append("circle").attr("class", "node-graph-halo").attr("r", (item) => item.id === rootId ? 25 : 18).attr("fill", nodeColor).attr("opacity", .18);
      const core = node.append("circle").attr("class", "node-graph-core").attr("r", (item) => item.id === rootId ? 13 : 8).attr("fill", "#071014").attr("stroke", nodeColor).attr("stroke-width", (item) => item.id === rootId ? 2.1 : 1.35);
      core.filter((item) => Boolean(item.inSystem)).attr("filter", `url(#node-graph-glow-${graphId})`);
      node.filter((item) => item.source === "wikidata").append("path").attr("d", "M-3,-3 L3,3 M3,-3 L-3,3").attr("stroke", nodeColor).attr("stroke-width", 1.15);
      node.append("text").attr("class", "node-graph-name").attr("dy", (item) => item.id === rootId ? 42 : 31).attr("text-anchor", "middle").text((item) => truncate(item.label, 23));
      node.append("text").attr("class", "node-graph-detail").attr("dy", (item) => item.id === rootId ? 55 : 43).attr("text-anchor", "middle").text((item) => item.id === rootId ? "SELECTED MAP NODE" : item.inSystem ? "SYSTEM ENTITY" : item.source === "wikidata" ? "WIKIDATA" : "LOCAL FACT");
      node.append("title").text((item) => `${item.label}${item.detail ? `\n${item.detail}` : ""}`);

      simulation.on("tick", () => {
        link.attr("x1", (item) => (item.source as SimNode).x ?? 0).attr("y1", (item) => (item.source as SimNode).y ?? 0).attr("x2", (item) => (item.target as SimNode).x ?? 0).attr("y2", (item) => (item.target as SimNode).y ?? 0);
        label.attr("x", (item) => (((item.source as SimNode).x ?? 0) + ((item.target as SimNode).x ?? 0)) / 2).attr("y", (item) => (((item.source as SimNode).y ?? 0) + ((item.target as SimNode).y ?? 0)) / 2 - 5);
        node.attr("transform", (item) => `translate(${item.x ?? 0},${item.y ?? 0})`);
      });
      return () => { simulation.stop(); svg.on(".zoom", null); if (outlierTimer.current) clearTimeout(outlierTimer.current); zoomRef.current = null; };
    };
    let stop = render();
    const observer = new ResizeObserver(() => { stop?.(); stop = render(); });
    observer.observe(element);
    return () => { stop?.(); observer.disconnect(); };
  }, [graphId, links, nodes, rootId, selectedNodeId]);

  return <div className="node-relationship-graph"><svg ref={ref} aria-label="Interactive relationship graph" /><div className="node-graph-zoom" aria-label="Graph zoom controls"><button type="button" onClick={() => changeZoom("in")} aria-label="Zoom graph in"><Plus size={13} weight="bold" /></button><button type="button" onClick={() => changeZoom("out")} aria-label="Zoom graph out"><Minus size={13} weight="bold" /></button><button type="button" onClick={() => changeZoom("reset")} aria-label="Reset graph view"><CrosshairSimple size={13} weight="bold" /></button></div></div>;
}
