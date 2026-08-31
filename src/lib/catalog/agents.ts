import type { AgentHelperDefinition, AgentRoleDefinition } from "./types";

const roleDefinitions = [
  {
    id: "analyst",
    label: "Analyst",
    description: "Investigate loaded signals, source health, and approved reconnaissance actions.",
    helpers: [
      { id: "map_context", label: "MAP CONTEXT", description: "Current viewport, entities, signals, selection, and fetch time", phase: "context" },
      { id: "source_health", label: "SOURCE HEALTH", description: "Live, degraded, unavailable, and key-required source states", phase: "context" },
      { id: "signal_search", label: "SIGNAL SEARCH", description: "Search the full loaded signal set beyond the compact default context", phase: "action-ready" },
      { id: "deterministic_actions", label: "ACTION CATALOG", description: "DNS, RDAP, IP, TLS, CVE, crypto, sanctions, and scan actions", phase: "action-ready" },
    ],
  },
  {
    id: "overview",
    label: "Overview",
    description: "Summarize the current situation and source health.",
    helpers: [
      { id: "map_context", label: "MAP CONTEXT", description: "Current viewport, entities, signals, selection, and fetch time", phase: "context" },
      { id: "source_health", label: "SOURCE HEALTH", description: "Live, degraded, unavailable, and key-required source states", phase: "context" },
      { id: "risk_highlights", label: "RISK HIGHLIGHTS", description: "High-risk signals and degraded source callouts", phase: "context" },
      { id: "signal_search", label: "SIGNAL SEARCH", description: "Search the full loaded signal set beyond the compact default context", phase: "action-ready" },
    ],
  },
  {
    id: "entity-intel",
    label: "Entity intelligence",
    description: "Investigate a selected entity and its local relationship graph.",
    helpers: [
      { id: "selected_entity", label: "SELECTED ENTITY", description: "Typed facts and the selected map node as graph root", phase: "context" },
      { id: "local_relationships", label: "LOCAL RELATIONSHIPS", description: "Nearby, same-source, same-domain, and same-country links", phase: "context" },
      { id: "wikidata_lookup", label: "WIKIDATA LOOKUP", description: "Typed entity and provider relationship lookup", phase: "action-ready" },
      { id: "wikidata_expansion", label: "WIKIDATA EXPANSION", description: "On-demand expansion of a selected Wikidata node", phase: "action-ready" },
    ],
  },
] satisfies AgentRoleDefinition[];

export const agentRoleDefinitions = roleDefinitions;
export type AgentRole = (typeof roleDefinitions)[number]["id"];
export type AgentHelper = AgentHelperDefinition;

export const agentHelpers = Object.fromEntries(
  roleDefinitions.map((role) => [role.id, role.helpers]),
) as Record<AgentRole, AgentHelper[]>;

export function helperIds(role: AgentRole) {
  return agentHelpers[role].map((helper) => helper.id);
}
