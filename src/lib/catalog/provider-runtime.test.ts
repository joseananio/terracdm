import assert from "node:assert/strict";
import test from "node:test";
import type { ProviderSnapshot } from "../intelligence.ts";
import { getAgentImplementation, getGraphImplementation, registerPack } from "../server/pack-registry.ts";
import { assembleCatalog } from "../server/catalog-assembly.ts";
import { runProvider } from "./provider-runtime.ts";
import type { ProviderImplementation, ProviderManifest, SignalPackManifest } from "./types.ts";

function testPack(id: string, provider: ProviderManifest): SignalPackManifest {
  return {
    domain: id,
    version: "1.0.0",
    label: "Provider runtime test",
    subdomains: [{ id: "default", label: "Default" }],
    providers: [provider],
    signals: [{ id: `${id}.observation`, label: "Test observation", providerId: provider.id, subdomainId: "default" }],
    presentation: { map: { id, label: "Provider runtime test", short: "TEST", color: "#ffffff", source: "Test", status: "live", details: [] } },
  };
}

function snapshot(domain: string, providerId: string): ProviderSnapshot {
  return {
    domain,
    providerId,
    source: { id: providerId, name: "Test" },
    status: "live",
    fetchedAt: "2026-08-23T00:00:00.000Z",
    observations: [
      { id: "inside", kind: "entity", domain, subdomainId: "default", name: "Inside", description: "", risk: "low", riskScore: 20, location: { coordinates: { lat: 1, lng: 1 } }, source: { id: providerId, name: "Test" }, providerId, observedAt: "2026-08-23T00:00:00.000Z" },
      { id: "outside", kind: "entity", domain, subdomainId: "default", name: "Outside", description: "", risk: "low", riskScore: 20, location: { coordinates: { lat: 40, lng: 40 } }, source: { id: providerId, name: "Test" }, providerId, observedAt: "2026-08-23T00:00:00.000Z" },
      { id: "unlocated", kind: "signal", domain, subdomainId: "default", name: "Unlocated", description: "", risk: "low", riskScore: 20, source: { id: providerId, name: "Test" }, providerId, observedAt: "2026-08-23T00:00:00.000Z" },
    ],
  };
}

test("caches global providers once and filters their observations for the requested viewport", async () => {
  const domain = "provider-runtime-global-test";
  const providerManifest: ProviderManifest = { id: "provider-runtime-global", label: "Global test", type: "code", implementation: "test:global", cache: { maxAgeSeconds: 60 }, coverage: "global" };
  let calls = 0;
  const implementation: ProviderImplementation = async () => {
    calls += 1;
    return snapshot(domain, providerManifest.id);
  };
  const provider = registerPack({ manifest: testPack(domain, providerManifest), implementations: { providers: { [providerManifest.implementation]: implementation } } }).providers[0];
  assembleCatalog();

  const request = { viewport: { west: 0, south: 0, east: 10, north: 10 }, zoom: 5 };
  const first = await runProvider(provider, request);
  const second = await runProvider(provider, request);
  const elsewhere = await runProvider(provider, { viewport: { west: 30, south: 30, east: 50, north: 50 }, zoom: 5 });

  assert.equal(calls, 1);
  assert.equal(first.status, "live");
  assert.equal(second.status, "cached");
  assert.deepEqual(first.observations.map((observation) => observation.id), ["inside", "unlocated"]);
  assert.deepEqual(elsewhere.observations.map((observation) => observation.id), ["outside", "unlocated"]);
});

test("keeps viewport-scoped provider cache entries separate and gives implementations the viewport request", async () => {
  const domain = "provider-runtime-viewport-test";
  const providerManifest: ProviderManifest = { id: "provider-runtime-viewport", label: "Viewport test", type: "code", implementation: "test:viewport", cache: { maxAgeSeconds: 60 }, coverage: "viewport" };
  const requests: Array<{ west: number; south: number; east: number; north: number } | undefined> = [];
  const implementation: ProviderImplementation = async (context) => {
    requests.push(context.request.viewport);
    return snapshot(domain, providerManifest.id);
  };
  const provider = registerPack({ manifest: testPack(domain, providerManifest), implementations: { providers: { [providerManifest.implementation]: implementation } } }).providers[0];
  assembleCatalog();

  await runProvider(provider, { viewport: { west: 0, south: 0, east: 10, north: 10 }, zoom: 6 });
  await runProvider(provider, { viewport: { west: 30, south: 30, east: 40, north: 40 }, zoom: 6 });

  assert.equal(requests.length, 2);
  assert.deepEqual(requests[0], { west: 0, south: 0, east: 10, north: 10 });
  assert.deepEqual(requests[1], { west: 30, south: 30, east: 40, north: 40 });
});

test("registerPack binds provider, graph, and agent implementations atomically", async () => {
  const domain = "provider-runtime-implementation-test";
  const providerManifest: ProviderManifest = { id: "provider-runtime-implementation", label: "Implementation test", type: "code", implementation: "test:implementation", cache: { maxAgeSeconds: 60 }, coverage: "global" };
  const graph = {};
  const agent = async () => ({ ok: true });
  const provider: ProviderImplementation = async () => snapshot(domain, providerManifest.id);
  const pack = registerPack({
    manifest: testPack(domain, providerManifest),
    implementations: {
      providers: { [providerManifest.implementation]: provider },
      graph: { "test:graph": graph },
      agents: { "test:agent": agent },
    },
  });
  assembleCatalog();

  assert.equal(pack.domain, domain);
  assert.equal(getGraphImplementation("test:graph"), graph);
  assert.equal(getAgentImplementation("test:agent"), agent);
  assert.throws(() => registerPack({
    manifest: { ...testPack("provider-runtime-missing-implementation", { ...providerManifest, id: "missing-provider", implementation: "test:missing" }) },
  }), /missing provider implementations/);
});
