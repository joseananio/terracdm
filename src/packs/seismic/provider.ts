import { riskFromScore, type Entity, type ProviderSnapshot, type Signal } from "../../lib/intelligence";
import { fetchJson, isoTime, locationText } from "../../lib/server/fetch-json";
import type { ProviderImplementation } from "../../lib/catalog/types";

type EarthquakeFeature = {
  id: string;
  properties?: Record<string, unknown>;
  geometry?: { coordinates?: unknown };
};

function pointFromFeature(feature: EarthquakeFeature) {
  const coordinates = feature.geometry?.coordinates;
  if (!Array.isArray(coordinates) || typeof coordinates[0] !== "number" || typeof coordinates[1] !== "number") return null;
  return { lng: coordinates[0], lat: coordinates[1] };
}

export const seismicProviderImplementation: ProviderImplementation = async ({ pack, provider }) => {
  const domain = pack.domain;
  const signalDefinition = pack.signals?.find((signal) => signal.providerId === provider.id && signal.subdomainId === "seismic");
  const subdomainId = signalDefinition?.subdomainId ?? "seismic";
  const feed = await fetchJson<{ features?: EarthquakeFeature[] }>("https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_hour.geojson");
  const entities: Entity[] = [];
  const signals: Signal[] = [];

  for (const feature of feed.features ?? []) {
    const point = pointFromFeature(feature);
    if (!point) continue;
    const properties = feature.properties ?? {};
    const magnitude = Number(properties.mag ?? 0);
    const title = String(properties.title ?? `M${magnitude.toFixed(1)} earthquake`);
    const place = String(properties.place ?? "unknown location");
    const observedAt = isoTime(Number(properties.time ?? Date.now()));
    const sourceUrl = String(properties.url ?? "https://earthquake.usgs.gov/");
    const riskScore = Math.min(100, Math.round(magnitude * 16));
    const entity: Entity = {
      id: `usgs:${feature.id}`,
      kind: "entity",
      domain,
      subdomainId,
      name: title,
      description: `${magnitude.toFixed(1)} magnitude · ${place}`,
      risk: riskFromScore(riskScore),
      riskScore,
      location: { coordinates: point, label: place },
      source: { id: provider.sourceId ?? provider.id, name: provider.label, url: sourceUrl },
      providerId: provider.id,
      url: sourceUrl,
      observedAt,
      properties: { magnitude, tsunami: Boolean(properties.tsunami) },
    };
    entities.push(entity);

    if (magnitude >= 2.5) {
      signals.push({
        id: `usgs-signal:${feature.id}`,
        kind: "signal",
        domain,
        subdomainId,
        name: title,
        description: place,
        risk: riskFromScore(riskScore),
        riskScore,
        location: { coordinates: point, label: locationText(point.lat, point.lng) },
        source: { id: provider.sourceId ?? provider.id, name: provider.label, url: sourceUrl },
        providerId: provider.id,
        observedAt,
        signalType: signalDefinition?.id,
        url: sourceUrl,
        properties: { magnitude, tsunami: Boolean(properties.tsunami) },
      });
    }
  }

  const snapshot: ProviderSnapshot = {
    domain,
    providerId: provider.id,
    source: { id: provider.sourceId ?? provider.id, name: provider.label },
    status: "live",
    observations: [...entities, ...signals],
    fetchedAt: new Date().toISOString(),
    nextPollSeconds: provider.pollSeconds ?? 60,
  };
  return snapshot;
};
