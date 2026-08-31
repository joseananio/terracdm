import type { CanonicalProviderSnapshot, Entity, Observation, ProviderSnapshot, Signal } from "../intelligence";
import type { NormalizedObservation, ProviderDefinition, SignalPack } from "./types";

function defaultRiskScore(risk: Observation["risk"]) {
  return risk === "high" ? 80 : risk === "medium" ? 50 : 20;
}

function normalizeObservation(observation: Observation, pack: SignalPack, provider: ProviderDefinition, fetchedAt: string): NormalizedObservation {
  const signalType = observation.signalType ?? `${pack.domain}.${observation.kind}`;
  const subdomainId = observation.subdomainId || signalType;
  if (!pack.subdomains.some((subdomain) => subdomain.id === subdomainId)) {
    throw new Error(`Provider ${provider.id} emitted unknown subdomain ${subdomainId} for pack ${pack.domain}`);
  }
  const source = observation.source ?? {
    id: provider.sourceId ?? provider.id,
    name: provider.label,
  };

  return {
    ...observation,
    domain: pack.domain,
    subdomainId,
    riskScore: observation.riskScore ?? defaultRiskScore(observation.risk),
    providerId: provider.id,
    observedAt: observation.observedAt || fetchedAt,
    source,
    packId: pack.domain,
    signalType,
  };
}

export function observationsToEntities(observations: NormalizedObservation[]): Entity[] {
  return observations.filter((observation): observation is Entity => observation.kind === "entity");
}

export function observationsToSignals(observations: NormalizedObservation[]): Signal[] {
  return observations.filter((observation): observation is Signal => observation.kind === "signal");
}

export function normalizeProviderSnapshot(snapshot: ProviderSnapshot, pack: SignalPack, provider: ProviderDefinition): CanonicalProviderSnapshot {
  const observations = snapshot.observations.map((observation) => normalizeObservation(observation, pack, provider, snapshot.fetchedAt));
  return {
    domain: snapshot.domain,
    providerId: provider.id,
    source: snapshot.source,
    status: snapshot.status,
    fetchedAt: snapshot.fetchedAt,
    error: snapshot.error,
    nextPollSeconds: snapshot.nextPollSeconds,
    packId: pack.domain,
    observations,
  };
}
