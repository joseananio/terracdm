import type { GraphLink, GraphNode } from "../intelligence";
import type { NodeGraph, NodeGraphEntity } from "../node-graph";
import type { ProviderImplementation } from "../catalog/types";

export type GraphWikidataResult = {
  status: NodeGraph["sources"]["wikidata"];
  id?: string;
  nodes: GraphNode[];
  links: GraphLink[];
  error?: string;
};

export type GraphFactAdder = (id: string, label: string, detail: string, relation: string, type?: GraphNode["type"]) => void;

export type GraphImplementation = {
  wikidata?: (entity: NodeGraphEntity) => Promise<GraphWikidataResult>;
  facts?: (entity: NodeGraphEntity, add: GraphFactAdder) => void;
  country?: (entity: NodeGraphEntity, registrationCountry?: string) => { relation: string; detail: string } | undefined;
};

export type AgentImplementation = (input: unknown) => Promise<unknown>;

export type CodePackImplementations = {
  providers?: Record<string, ProviderImplementation>;
  graph?: Record<string, GraphImplementation>;
  agents?: Record<string, AgentImplementation>;
};
