import { agentRoleDefinitions } from "./agents.ts";
import type { AgentPackDefinition, AgentRoleDefinition, AgentToolDefinition, CatalogLayer, ProviderDefinition, ProviderKind, SignalPack } from "./types.ts";

export type PublicProviderDefinition = Omit<ProviderDefinition, "auth">;
export type PublicAgentToolDefinition = Omit<AgentToolDefinition, "handler">;
export type PublicAgentPackDefinition = Omit<AgentPackDefinition, "tools"> & { tools?: PublicAgentToolDefinition[] };
export type PublicSignalPack = Omit<SignalPack, "providers" | "agents"> & {
  providers: PublicProviderDefinition[];
  agents?: PublicAgentPackDefinition;
};
export type PublicCatalog = {
  version: "1";
  providerKinds: readonly ProviderKind[];
  agentRoles: AgentRoleDefinition[];
  packs: PublicSignalPack[];
  layers: CatalogLayer[];
};

export function publicSignalPack(pack: SignalPack): PublicSignalPack {
  const agents = pack.agents ? {
    ...pack.agents,
    tools: (pack.agents.tools ?? []).map(({ handler: _handler, ...tool }) => tool),
  } : undefined;
  return {
    ...pack,
    providers: pack.providers.map(({ auth: _auth, ...provider }) => provider),
    ...(agents ? { agents } : {}),
  };
}

export function publicAgentRoles(): AgentRoleDefinition[] {
  return agentRoleDefinitions;
}
