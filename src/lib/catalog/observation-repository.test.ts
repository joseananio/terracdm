import assert from "node:assert/strict";
import test from "node:test";
import { findObservationById, ingestObservations, queryObservations } from "../server/observation-repository.ts";

test("queries ingested observations independently of a browser payload", async () => {
  const suffix = crypto.randomUUID();
  const entityId = `repository-entity-${suffix}`;
  const signalId = `repository-signal-${suffix}`;
  ingestObservations([
    {
      id: entityId,
      kind: "entity",
      domain: "repository-test",
      subdomainId: "stations",
      name: "North station",
      description: "A tracked station",
      risk: "medium",
      riskScore: 50,
      location: { coordinates: { lat: 52, lng: 13 }, label: "Berlin" },
      source: { id: "test-provider", name: "Test provider" },
      providerId: "test-provider",
      observedAt: "2026-08-23T00:00:00.000Z",
    },
    {
      id: signalId,
      kind: "signal",
      domain: "repository-test",
      subdomainId: "alerts",
      name: "North station alert",
      description: "Medium risk station alert",
      risk: "medium",
      riskScore: 50,
      location: { coordinates: { lat: 52.01, lng: 13.01 }, label: "Berlin" },
      source: { id: "test-provider", name: "Test provider" },
      providerId: "test-provider",
      observedAt: "2026-08-23T00:00:01.000Z",
    },
  ]);

  const result = await queryObservations({ kinds: ["signal"], query: "north station", limit: 10 });
  assert.equal(result.observations.length, 1);
  assert.equal(result.observations[0]?.id, signalId);
  assert.equal((await findObservationById(entityId))?.kind, "entity");
});

test("paginates observations with a stable cursor and applies geographic filters", async () => {
  const suffix = crypto.randomUUID();
  const domain = `repository-page-${suffix}`;
  ingestObservations([
    {
      id: `${suffix}-newest`, kind: "signal", domain, subdomainId: "alerts", name: "Newest", description: "",
      risk: "high", riskScore: 90, location: { coordinates: { lat: 52.52, lng: 13.405 }, label: "Berlin" },
      source: { id: "page-test", name: "Page test" }, providerId: "page-test", observedAt: "2026-08-23T00:00:03.000Z",
    },
    {
      id: `${suffix}-middle`, kind: "signal", domain, subdomainId: "alerts", name: "Middle", description: "",
      risk: "medium", riskScore: 50, location: { coordinates: { lat: 52.5, lng: 13.4 }, label: "Berlin" },
      source: { id: "page-test", name: "Page test" }, providerId: "page-test", observedAt: "2026-08-23T00:00:02.000Z",
    },
    {
      id: `${suffix}-oldest`, kind: "signal", domain, subdomainId: "alerts", name: "Oldest", description: "",
      risk: "low", riskScore: 10, location: { coordinates: { lat: 48.137, lng: 11.575 }, label: "Munich" },
      source: { id: "page-test", name: "Page test" }, providerId: "page-test", observedAt: "2026-08-23T00:00:01.000Z",
    },
  ]);

  const first = await queryObservations({ domains: [domain], viewport: { west: 13, south: 52, east: 14, north: 53 }, limit: 1 });
  assert.equal(first.observations[0]?.id, `${suffix}-newest`);
  assert.ok(first.nextCursor);

  const second = await queryObservations({ domains: [domain], viewport: { west: 13, south: 52, east: 14, north: 53 }, cursor: first.nextCursor, limit: 1 });
  assert.equal(second.observations[0]?.id, `${suffix}-middle`);
  assert.equal(second.nextCursor, undefined);

  const nearby = await queryObservations({ domains: [domain], center: { lat: 52.52, lng: 13.405 }, radiusKm: 10, limit: 10 });
  assert.deepEqual(nearby.observations.map((observation) => observation.id), [`${suffix}-newest`, `${suffix}-middle`]);
});
