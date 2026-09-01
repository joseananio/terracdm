import assert from "node:assert/strict";
import test from "node:test";
import type { CanonicalProviderSnapshot } from "../intelligence";
import { providerSnapshotRevision } from "./provider-revision";

function snapshot(overrides: Partial<CanonicalProviderSnapshot> = {}): CanonicalProviderSnapshot {
  return {
    domain: "aviation",
    providerId: "test-provider",
    source: { id: "test-source", name: "Test source" },
    status: "live",
    fetchedAt: "2026-09-01T00:00:00.000Z",
    observations: [],
    packId: "aviation",
    ...overrides,
  };
}

test("provider revisions ignore fetch time and cache delivery status", () => {
  const live = snapshot();
  const cached = snapshot({ status: "cached", fetchedAt: "2026-09-01T00:01:00.000Z" });
  assert.equal(providerSnapshotRevision(live), providerSnapshotRevision(cached));
});

test("provider revisions ignore observation order", () => {
  const first = { id: "a", kind: "signal" as const, domain: "aviation", subdomainId: "alerts", name: "A", description: "", risk: "low" as const, riskScore: 20, source: { id: "test-source", name: "Test source" }, providerId: "test-provider", observedAt: "2026-09-01T00:00:00.000Z" };
  const second = { ...first, id: "b", name: "B" };
  assert.equal(
    providerSnapshotRevision(snapshot({ observations: [first, second] })),
    providerSnapshotRevision(snapshot({ observations: [second, first] })),
  );
});

test("provider revisions change with material observation data", () => {
  const base = { id: "a", kind: "signal" as const, domain: "aviation", subdomainId: "alerts", name: "A", description: "", risk: "low" as const, riskScore: 20, source: { id: "test-source", name: "Test source" }, providerId: "test-provider", observedAt: "2026-09-01T00:00:00.000Z" };
  assert.notEqual(
    providerSnapshotRevision(snapshot({ observations: [base] })),
    providerSnapshotRevision(snapshot({ observations: [{ ...base, risk: "high", riskScore: 80 }] })),
  );
});

test("provider revisions ignore volatile media health sampling fields", () => {
  const media = { kind: "hls" as const, url: "https://example.test/live.m3u8", health: { status: "healthy" as const, manifestStatus: 200, cors: "allowed" as const, geo: "clear" as const, segmentFreshness: "fresh" as const, segmentAgeSeconds: 2, checkedAt: "2026-09-01T00:00:00.000Z" } };
  const observation = { id: "camera", kind: "entity" as const, domain: "aviation", subdomainId: "cameras", name: "Camera", description: "", risk: "low" as const, riskScore: 20, location: { coordinates: { lat: 1, lng: 2 } }, source: { id: "test-source", name: "Test source" }, providerId: "test-provider", observedAt: "2026-09-01T00:00:00.000Z", media };
  const resampled = { ...observation, media: { ...media, health: { ...media.health, segmentAgeSeconds: 8, checkedAt: "2026-09-01T00:01:00.000Z" } } };
  assert.equal(
    providerSnapshotRevision(snapshot({ observations: [observation] })),
    providerSnapshotRevision(snapshot({ observations: [resampled] })),
  );
});
