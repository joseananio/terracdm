import type { SignalPack, SignalPackManifest } from "./types";

/**
 * Converts the data-only pack manifest into the runtime shape used by the
 * catalog, provider, graph, and agent consumers. Runtime-only domain fields
 * are derived here so manifests do not repeat their owning domain.
 */
export function compileSignalPack(manifest: SignalPackManifest): SignalPack {
  return {
    domain: manifest.domain,
    version: manifest.version,
    label: manifest.label,
    subdomains: manifest.subdomains,
    providers: manifest.providers.map((provider) => ({ ...provider, domain: manifest.domain })),
    signals: manifest.signals,
    presentation: manifest.presentation,
    agents: manifest.agents,
  };
}
