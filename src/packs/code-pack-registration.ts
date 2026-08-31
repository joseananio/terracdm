import type { ProviderImplementation, SignalPackManifest } from "../lib/catalog/types";
import type { CodePackRegistration } from "../lib/server/pack-registry";
import type { GraphImplementation } from "../lib/server/pack-implementation-types";

/**
 * Builds trusted code-pack wiring from the manifest's provider and graph IDs.
 * Pack registrations only map local provider IDs to functions; implementation
 * IDs remain owned by the manifest instead of being repeated in server code.
 */
export function codePackRegistration(
  manifest: SignalPackManifest,
  providers: Record<string, ProviderImplementation>,
  graphImplementation?: GraphImplementation,
): CodePackRegistration {
  const providerImplementations = Object.fromEntries(manifest.providers
    .filter((provider) => provider.type === "code")
    .map((provider) => {
      const implementation = providers[provider.id];
      if (!implementation) throw new Error(`Pack ${manifest.domain} is missing provider wiring for ${provider.id}`);
      return [provider.implementation, implementation];
    }));
  const resolver = manifest.presentation.graph?.resolver;
  return {
    manifest,
    implementations: {
      providers: providerImplementations,
      ...(resolver && graphImplementation ? { graph: { [resolver]: graphImplementation } } : {}),
    },
  };
}
