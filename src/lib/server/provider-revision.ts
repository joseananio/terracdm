import { createHash } from "node:crypto";
import type { CanonicalProviderSnapshot } from "../intelligence";

const volatileKeys = new Set(["checkedAt", "segmentAgeSeconds"]);

function materialValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(materialValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([key]) => !volatileKeys.has(key))
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, nested]) => [key, materialValue(nested)]));
}

export function stableMaterialJson(value: unknown) {
  return JSON.stringify(materialValue(value));
}

export function providerSnapshotRevision(snapshot: CanonicalProviderSnapshot) {
  const observations = snapshot.observations
    .map(materialValue)
    .sort((left, right) => {
      const leftId = String((left as { id?: unknown }).id ?? "");
      const rightId = String((right as { id?: unknown }).id ?? "");
      return leftId.localeCompare(rightId);
    });
  const material = materialValue({
    domain: snapshot.domain,
    error: snapshot.error ?? null,
    observations,
    providerId: snapshot.providerId,
    source: snapshot.source,
    status: snapshot.status === "cached" ? "live" : snapshot.status,
  });
  return createHash("sha256").update(JSON.stringify(material)).digest("hex");
}
