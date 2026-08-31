import { observationsToEntities, observationsToSignals } from "../catalog/observations";
import type { NormalizedObservation } from "../catalog/types";
import { deterministicActions } from "../deterministic-actions";
import { agentHelpers, type AgentHelper, type AgentRole } from "../catalog/agents";
import { getCatalog } from "../catalog/registry";

export type AgentContextInput = {
  fetchedAt?: string;
  viewport?: { west: number; south: number; east: number; north: number };
  selectedEntityIds?: string[];
  observations?: NormalizedObservation[];
  sourceStatuses?: Array<{ sourceId: string; status: string; error?: string }>;
};

export type AgentHelperBundle = {
  role: AgentRole;
  helpers: AgentHelper[];
  context: {
    map: {
      fetchedAt?: string;
      viewport?: AgentContextInput["viewport"];
      selectedEntityIds: string[];
      entityCount: number;
      signalCount: number;
    };
    sourceHealth: Array<{ sourceId: string; status: string; error?: string }>;
    riskHighlights: string[];
    observations: Array<{ id: string; kind: string; packId: string; providerId: string; domain: string; signalType?: string; subdomainId: string; observedAt: string }>;
    catalog: Array<{
      packId: string;
      label: string;
      domain: string;
      signals: string[];
      capabilities: Array<{ id: string; label: string; permission: string; source?: string; toolIds?: string[] }>;
      tools: Array<{ id: string; label: string; source: string; handler?: string; permission: string }>;
    }>;
    deterministicActions?: Array<{ id: string; label: string; detail: string; method: string; path: string }>;
  };
};

function riskHighlights(context: AgentContextInput) {
  const signals = context.observations ? observationsToSignals(context.observations) : [];
  const highRisk = signals.filter((signal) => signal.risk === "high").slice(0, 4).map((signal) => `HIGH · ${signal.name}`);
  const degraded = (context.sourceStatuses ?? [])
    .filter((source) => ["degraded", "error", "unavailable", "key_required"].includes(source.status))
    .slice(0, 3)
    .map((source) => `SOURCE · ${source.sourceId}: ${source.status.replaceAll("_", " ")}`);
  return [...highRisk, ...degraded].slice(0, 6);
}

export function buildAgentHelperBundle(role: AgentRole, context: AgentContextInput = {}): AgentHelperBundle {
  const entities = context.observations ? observationsToEntities(context.observations) : [];
  const signals = context.observations ? observationsToSignals(context.observations) : [];
  return {
    role,
    helpers: agentHelpers[role],
    context: {
      map: {
        fetchedAt: context.fetchedAt,
        viewport: context.viewport,
        selectedEntityIds: context.selectedEntityIds?.slice(0, 20) ?? [],
        entityCount: entities.length,
        signalCount: signals.length,
      },
      sourceHealth: context.sourceStatuses?.slice(0, 30) ?? [],
      riskHighlights: riskHighlights(context),
      observations: (context.observations ?? []).slice(0, 120).map(({ id, kind, packId, providerId, domain, signalType, subdomainId, observedAt }) => ({ id, kind, packId: packId ?? "", providerId, domain, signalType, subdomainId, observedAt })),
      catalog: getCatalog().packs.map((pack) => ({
        packId: pack.domain,
        label: pack.label,
        domain: pack.domain,
        signals: (pack.signals ?? []).map((signal) => signal.id),
        capabilities: (pack.agents?.capabilities ?? []).map((capability) => ({ id: capability.id, label: capability.label, permission: capability.permission, source: capability.source, toolIds: capability.toolIds })),
        tools: (pack.agents?.tools ?? []).map((tool) => ({ id: tool.id, label: tool.label, source: tool.source, handler: tool.handler, permission: tool.permission })),
      })),
      ...(role === "analyst" ? {
        deterministicActions: deterministicActions.map(({ id, label, detail, method, path }) => ({ id, label, detail, method, path })),
      } : {}),
    },
  };
}
