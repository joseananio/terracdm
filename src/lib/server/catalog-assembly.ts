import { dirname } from "node:path";
import { compileSignalPack } from "../catalog/compiler";
import { assertValidSignalPacks, replaceCatalog } from "../catalog/registry";
import { userSignalPackManifests } from "../catalog/user-packs";
import type { SignalPack, SignalPackManifest } from "../catalog/types";
import {
  applyInstanceProviderOverrides,
  assertKnownInstancePackEntries,
  loadConfigPackManifests,
  loadOptionalInstanceConfig,
  selectInstancePackDomains,
} from "./instance-config";
import { builtInCodePackRegistrations } from "../../packs/code-registrations";
import { registerContributorCodePacks } from "./contributor-code-packs";
import { loadCodePackImplementations, registerPack, registeredCodePacks } from "./pack-registry";
import { mergeSignalPackManifests } from "../catalog/merge";

function compileAndValidate(manifests: SignalPackManifest[]) {
  const packs = manifests.map(compileSignalPack);
  assertValidSignalPacks(packs);
  return packs;
}

export type CatalogAssembly = {
  manifests: SignalPackManifest[];
  packs: SignalPack[];
  activePacks: SignalPack[];
  configPath?: string;
};

/**
 * The only server catalog startup path:
 * built-in code -> contributor code -> config manifests -> validation ->
 * instance selection/overrides -> runtime commit.
 */
export function assembleCatalog(): CatalogAssembly {
  for (const registration of builtInCodePackRegistrations) registerPack(registration);
  registerContributorCodePacks();

  const codePacks = registeredCodePacks();
  const codeManifests = codePacks.map((registration) => registration.manifest);
  const contributorManifests = userSignalPackManifests;
  const loadedConfig = loadOptionalInstanceConfig();
  const configManifests = loadedConfig
    ? loadConfigPackManifests(loadedConfig.config, dirname(loadedConfig.path))
    : [];
  const manifests = mergeSignalPackManifests([...codeManifests, ...contributorManifests, ...configManifests]);
  const packs = compileAndValidate(manifests);
  loadCodePackImplementations(codePacks);

  if (!loadedConfig) {
    replaceCatalog(packs);
    return { manifests, packs, activePacks: packs };
  }

  assertKnownInstancePackEntries(loadedConfig.config, manifests.map((manifest) => manifest.domain));
  const overriddenPacks = packs.map((pack) => applyInstanceProviderOverrides(pack, loadedConfig.config.packs.entries[pack.domain]?.providers));
  const activeDomains = selectInstancePackDomains(overriddenPacks.map((pack) => pack.domain), loadedConfig.config);
  const activePacks = overriddenPacks.filter((pack) => activeDomains.has(pack.domain));
  replaceCatalog(activePacks);
  return { manifests, packs: overriddenPacks, activePacks, configPath: loadedConfig.path };
}

export const catalogAssembly = assembleCatalog();
