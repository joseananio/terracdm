import type { Entity, GraphLink, GraphNode } from "@/src/lib/intelligence";
import type { AgentHelper } from "./catalog/agents";

export type NodeGraphEntity = Entity;

export type NodeGraph = {
  rootId: string;
  nodes: GraphNode[];
  links: GraphLink[];
  sources: {
    local: number;
    wikidata: "live" | "no_match" | "unavailable";
    wikidataId?: string;
    error?: string;
  };
  helpers: AgentHelper[];
  fetchedAt: string;
};

export type NodeGraphExpansion = {
  nodes: GraphNode[];
  links: GraphLink[];
};
