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
