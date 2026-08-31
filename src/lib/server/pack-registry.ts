import { isDeepStrictEqual } from "node:util";
import type { ProviderImplementation, SignalPack, SignalPackManifest } from "../catalog/types";
import { compileSignalPack } from "../catalog/compiler";
import type { CodePackImplementations } from "./pack-implementation-types";

export type CodePackRegistration = {
  manifest: SignalPackManifest;
  implementations?: CodePackImplementations;
};

const registrations: CodePackRegistration[] = [];
const providerImplementations = new Map<string, ProviderImplementation>();
const graphImplementations = new Map<string, NonNullable<CodePackImplementations["graph"]>[string]>();
const agentImplementations = new Map<string, NonNullable<CodePackImplementations["agents"]>[string]>();

function addImplementations<T>(target: Map<string, T>, values: Record<string, T> | undefined, kind: string) {
  for (const [id, implementation] of Object.entries(values ?? {})) {
    const existing = target.get(id);
    if (existing && existing !== implementation) throw new Error(`${kind} implementation already registered: ${id}`);
    target.set(id, implementation);
  }
}

function requiredProviderImplementations(manifest: SignalPackManifest) {
  return manifest.providers
    .filter((provider) => provider.type === "code")
    .map((provider) => provider.implementation);
}

function requiredAgentImplementations(manifest: SignalPackManifest) {
  return (manifest.agents?.tools ?? [])
    .filter((tool) => tool.source === "custom" && tool.handler)
    .map((tool) => tool.handler as string);
}

/**
 * Queues one complete trusted code pack for the assembly pipeline. The
 * manifest is returned in compiled runtime form for inspection, but it is not
 * made visible through the catalog until assembleCatalog() commits the final
 * assembled runtime.
 */
export function registerPack(input: CodePackRegistration): SignalPack {
  const implementations = input.implementations ?? {};
  const missingProviders = requiredProviderImplementations(input.manifest).filter((id) => !implementations.providers?.[id]);
  const missingAgents = requiredAgentImplementations(input.manifest).filter((id) => !implementations.agents?.[id]);
  if (missingProviders.length) throw new Error(`Pack ${input.manifest.domain} is missing provider implementations: ${missingProviders.join(", ")}`);
  if (missingAgents.length) throw new Error(`Pack ${input.manifest.domain} is missing agent implementations: ${missingAgents.join(", ")}`);
  const existingIndex = registrations.findIndex((registration) => isDeepStrictEqual(registration.manifest, input.manifest));
  if (existingIndex >= 0) {
    // Server hot reloads recreate implementation functions while preserving
    // the registration module. Replace the old implementation in place so a
    // reload cannot turn one pack into duplicate catalog contributions.
    registrations[existingIndex] = input;
    return compileSignalPack(input.manifest);
  }
  registrations.push(input);
  return compileSignalPack(input.manifest);
}

export function registeredCodePacks(): CodePackRegistration[] {
  return [...registrations];
}

/** Rebuilds implementation lookups from the code packs accepted by assembly. */
export function loadCodePackImplementations(codePacks: CodePackRegistration[]) {
  const nextProviders = new Map<string, ProviderImplementation>();
  const nextGraphs = new Map<string, NonNullable<CodePackImplementations["graph"]>[string]>();
  const nextAgents = new Map<string, NonNullable<CodePackImplementations["agents"]>[string]>();

  for (const codePack of codePacks) {
    const implementations = codePack.implementations ?? {};
    const missingProviders = requiredProviderImplementations(codePack.manifest).filter((id) => !implementations.providers?.[id] && !nextProviders.has(id));
    const missingAgents = requiredAgentImplementations(codePack.manifest).filter((id) => !implementations.agents?.[id] && !nextAgents.has(id));
    if (missingProviders.length) throw new Error(`Pack ${codePack.manifest.domain} is missing provider implementations: ${missingProviders.join(", ")}`);
    if (missingAgents.length) throw new Error(`Pack ${codePack.manifest.domain} is missing agent implementations: ${missingAgents.join(", ")}`);
    addImplementations(nextProviders, implementations.providers, "Provider");
    addImplementations(nextGraphs, implementations.graph, "Graph");
    addImplementations(nextAgents, implementations.agents, "Agent");
  }

  providerImplementations.clear();
  graphImplementations.clear();
  agentImplementations.clear();
  for (const [id, implementation] of nextProviders) providerImplementations.set(id, implementation);
  for (const [id, implementation] of nextGraphs) graphImplementations.set(id, implementation);
  for (const [id, implementation] of nextAgents) agentImplementations.set(id, implementation);
}

export function getProviderImplementation(id: string) {
  return providerImplementations.get(id);
}

export function hasProviderImplementation(id: string) {
  return providerImplementations.has(id);
}

export function getGraphImplementation(id: string | undefined) {
  return id ? graphImplementations.get(id) : undefined;
}

export function getAgentImplementation(id: string | undefined) {
  return id ? agentImplementations.get(id) : undefined;
}
