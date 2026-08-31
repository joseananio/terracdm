import type { CatalogRuntime, ProviderDefinition, SignalPack } from "./types";
import { builtInSignalPackManifests } from "../../packs/manifests";
import { userSignalPackManifests } from "./user-packs";
import { compileSignalPack } from "./compiler";
import { defaultLayerIds } from "./defaults";
import { validateSignalPacks } from "./validation";
import { publicAgentRoles, publicSignalPack, type PublicCatalog } from "./public";
import { mergeSignalPackManifests } from "./merge";

export const supportedProviderKinds = ["http-json", "geojson", "rss", "csv", "code"] as const;

function buildRuntime(packs: SignalPack[]): CatalogRuntime {
  const providers = packs.flatMap((pack) => pack.providers);
  const layers = packs.map((pack) => pack.presentation.map);
  const byDomain = new Map(packs.map((pack) => [pack.domain, pack]));
  const providersById = new Map(providers.map((provider) => [provider.id, provider]));
  return {
    packs,
    providers,
    layers,
    sourceIds: providers.map((provider) => provider.sourceId ?? provider.id),
    getPack: (domain) => byDomain.get(domain),
    getProvider: (id) => providersById.get(id),
  };
}

const registeredPacks = mergeSignalPackManifests([...builtInSignalPackManifests, ...userSignalPackManifests]).map(compileSignalPack);
assertValidSignalPacks(registeredPacks);
export const signalPackRuntime = buildRuntime(registeredPacks);

/** Commits one fully assembled server catalog runtime. */
export function replaceCatalog(packs: SignalPack[]) {
  assertValidSignalPacks(packs);
  registeredPacks.splice(0, registeredPacks.length, ...packs);
  Object.assign(signalPackRuntime, buildRuntime(registeredPacks));
  return signalPackRuntime;
}

export function getSignalPack(domain: string) {
  return signalPackRuntime.getPack(domain);
}

export function getProviderDefinition(id: string) {
  return signalPackRuntime.getProvider(id);
}

export function getCatalog() {
  return signalPackRuntime;
}

export function defaultCatalogLayerIds() {
  return defaultLayerIds(signalPackRuntime.layers);
}

export function publicCatalog(): PublicCatalog {
  return {
    version: "1",
    providerKinds: supportedProviderKinds,
    agentRoles: publicAgentRoles(),
    packs: signalPackRuntime.packs.map(publicSignalPack),
    layers: signalPackRuntime.layers,
  };
}

export { validateSignalPacks } from "./validation";

export function assertValidSignalPacks(packs: SignalPack[] = signalPackRuntime.packs) {
  const errors = validateSignalPacks(packs);
  if (errors.length) throw new Error(`Invalid signal pack catalog:\n${errors.join("\n")}`);
  return packs;
}

export type { ProviderDefinition };
export { publicSignalPack } from "./public";
export { compileSignalPack } from "./compiler";
