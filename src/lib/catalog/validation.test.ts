import assert from "node:assert/strict";
import test from "node:test";
import { normalizeProviderSnapshot, observationsToEntities, observationsToSignals } from "./observations.ts";
import type { ProviderSnapshot } from "../intelligence.ts";
import type { SignalPack, SignalPackManifest } from "./types.ts";
import { defaultLayerIds } from "./defaults.ts";
import { packGraphRelation } from "./graph.ts";
import { validateSignalPacks } from "./validation.ts";
import { publicAgentRoles, publicSignalPack } from "./public.ts";
import { builtInSignalPackManifests } from "../../packs/manifests.ts";
import { compileSignalPack } from "./compiler.ts";

function customPack(overrides: Partial<SignalPackManifest> = {}): SignalPack {
  return compileSignalPack({
    domain: "air-quality",
    version: "1.0.0",
    label: "Air quality",
    subdomains: [{ id: "default", label: "Air-quality stations" }],
    providers: [{
      id: "city-air-quality",
      label: "City air-quality feed",
      type: "http-json",
      endpoint: "https://example.test/air-quality.json",
      mapping: { entity: { id: { path: "id" }, name: { path: "name" }, location: { lat: { path: "lat" }, lng: { path: "lng" } } } },
    }],
    signals: [{ id: "air-quality.observation", label: "Air-quality observation", providerId: "city-air-quality", subdomainId: "default" }],
    presentation: {
      map: { id: "air-quality", label: "Air quality", short: "AQI", color: "#8de85b", source: "City air-quality feed", status: "live", defaultEnabled: true, details: [{ id: "all", label: "All stations" }] },
      graph: { nodeType: "event", relations: [{ id: "nearby", label: "NEARBY", score: 1, when: { type: "distance-km", lessThan: 10 } }] },
    },
    agents: {
      capabilities: [{ id: "air-quality.search", label: "Search air quality", permission: "read", toolIds: ["air-quality.search"] }],
      tools: [{ id: "air-quality.search", label: "Search air quality", source: "custom", permission: "read" }],
    },
    ...overrides,
  });
}

test("accepts a code-backed custom pack with an arbitrary map id", () => {
  assert.deepEqual(validateSignalPacks([customPack()]), []);
});

test("models Fire as one domain with provider-backed subdomains", () => {
  const fireManifest = builtInSignalPackManifests.find((pack) => pack.domain === "fires");
  const fire = fireManifest && compileSignalPack(fireManifest);
  assert.ok(fire);
  assert.deepEqual(fire.subdomains.map((subdomain) => subdomain.id), ["thermal-hotspot", "wildfire-event"]);
  assert.deepEqual(fire.providers.map((provider) => [provider.id, provider.domain]), [["nasa-firms", "fires"], ["nasa-eonet", "fires"]]);
  assert.deepEqual(fire.signals?.map((signal) => [signal.id, signal.subdomainId]), [
    ["fires-firms.hotspot", "thermal-hotspot"],
    ["fires-eonet.wildfire", "wildfire-event"],
  ]);
  assert.deepEqual(validateSignalPacks([fire]), []);
});

test("all built-in packs satisfy the canonical pack contract", () => {
  const packs = builtInSignalPackManifests.map(compileSignalPack);
  assert.deepEqual(validateSignalPacks(packs), []);
  assert.ok(builtInSignalPackManifests.every((pack) => pack.presentation.map.id === pack.domain && pack.subdomains.length > 0));
  assert.ok(builtInSignalPackManifests.flatMap((pack) => pack.providers).every((provider) => provider.type === "code" ? Boolean(provider.implementation) : Boolean(provider.endpoint)));
});

test("exposes the pack catalog without server credentials or tool handlers", () => {
  const pack = customPack({
    providers: [{ ...customPack().providers[0], auth: { env: "AIR_QUALITY_KEY", header: "x-api-key" } }],
    agents: { tools: [{ id: "air-quality.search", label: "Search air quality", source: "custom", permission: "read", handler: "searchAirQuality" }] },
  });
  const exposed = publicSignalPack(pack);
  assert.equal("auth" in exposed.providers[0], false);
  assert.equal("handler" in exposed.agents!.tools![0], false);
  assert.deepEqual(publicAgentRoles().map((role) => role.id), ["analyst", "overview", "entity-intel"]);
});

test("includes explicitly enabled custom layers in background defaults", () => {
  assert.deepEqual(defaultLayerIds([
    { id: "aviation" },
    { id: "maritime" },
    { id: "air-quality", defaultEnabled: true },
    { id: "natural-hazards" },
  ]), ["air-quality", "natural-hazards"]);
});

test("normalizes provider output into canonical observations and projections", () => {
  const pack = customPack();
  const provider = pack.providers[0];
  const snapshot: ProviderSnapshot = {
    domain: "air-quality",
    providerId: provider.id,
    source: { id: provider.sourceId ?? provider.id, name: provider.label },
    status: "live",
    fetchedAt: "2026-08-15T12:00:00.000Z",
    observations: [
      { id: "station-1", kind: "entity", domain: "air-quality", subdomainId: "default", name: "Station 1", description: "AQI 20", risk: "low", riskScore: 20, location: { coordinates: { lat: 52, lng: 13 }, label: "Station 1" }, source: { id: provider.id, name: provider.label }, providerId: provider.id, observedAt: "2026-08-15T12:00:00.000Z" },
      { id: "alert-1", kind: "signal", domain: "air-quality", subdomainId: "default", name: "Good air", description: "Normal", risk: "low", riskScore: 20, location: { label: "Station 1" }, source: { id: provider.id, name: provider.label }, providerId: provider.id, observedAt: "2026-08-15T12:00:00.000Z" },
    ],
  };
  const canonical = normalizeProviderSnapshot(snapshot, pack, provider);
  assert.deepEqual(canonical.observations.map((observation) => observation.kind), ["entity", "signal"]);
  assert.ok(canonical.observations.every((observation) => observation.packId === "air-quality" && observation.providerId === provider.id));
  assert.equal("entities" in canonical, false);
  assert.equal("signals" in canonical, false);
  assert.equal(observationsToEntities(canonical.observations).length, 1);
  assert.equal(observationsToSignals(canonical.observations).length, 1);
});

test("rejects provider output that uses an undeclared subdomain", () => {
  const pack = customPack();
  const provider = pack.providers[0];
  assert.throws(() => normalizeProviderSnapshot({
    domain: pack.domain,
    providerId: provider.id,
    source: { id: provider.id, name: provider.label },
    status: "live",
    fetchedAt: "2026-08-15T12:00:00.000Z",
    observations: [{ id: "bad-subdomain", kind: "signal", domain: pack.domain, subdomainId: "missing", name: "Bad", description: "", risk: "low", riskScore: 20, source: { id: provider.id, name: provider.label }, providerId: provider.id, observedAt: "2026-08-15T12:00:00.000Z" }],
  }, pack, provider), /unknown subdomain/);
});

test("applies custom pack graph rules without a built-in domain fallback", () => {
  const pack = customPack();
  const getPack = (domain: string) => domain === pack.domain ? pack : undefined;
  const nearby = packGraphRelation(
    { id: "station-1", kind: "entity", domain: pack.domain, subdomainId: "default", name: "Station 1", description: "", risk: "low", riskScore: 20, location: { coordinates: { lat: 52, lng: 13 } }, source: { id: "test", name: "Test" }, providerId: "test", observedAt: new Date().toISOString() },
    { id: "station-2", kind: "entity", domain: pack.domain, subdomainId: "default", name: "Station 2", description: "", risk: "low", riskScore: 20, location: { coordinates: { lat: 52.02, lng: 13.01 } }, source: { id: "test", name: "Test" }, providerId: "test", observedAt: new Date().toISOString() },
    getPack,
  );
  assert.equal(nearby?.relation, "NEARBY");
  assert.equal(packGraphRelation(
    { id: "station-1", kind: "entity", domain: pack.domain, subdomainId: "default", name: "Station 1", description: "", risk: "low", riskScore: 20, location: { coordinates: { lat: 52, lng: 13 } }, source: { id: "test", name: "Test" }, providerId: "test", observedAt: new Date().toISOString() },
    { id: "station-2", kind: "entity", domain: pack.domain, subdomainId: "default", name: "Station 2", description: "", risk: "low", riskScore: 20, location: { coordinates: { lat: 53, lng: 13 } }, source: { id: "test", name: "Test" }, providerId: "test", observedAt: new Date().toISOString() },
    getPack,
  ), null);
  assert.equal(packGraphRelation(
    { id: "station-1", kind: "entity", domain: "unregistered", subdomainId: "default", name: "Station 1", description: "", risk: "low", riskScore: 20, location: { coordinates: { lat: 52, lng: 13 } }, source: { id: "test", name: "Test" }, providerId: "test", observedAt: new Date().toISOString() },
    { id: "station-2", kind: "entity", domain: "unregistered", subdomainId: "default", name: "Station 2", description: "", risk: "low", riskScore: 20, location: { coordinates: { lat: 52.01, lng: 13.01 } }, source: { id: "test", name: "Test" }, providerId: "test", observedAt: new Date().toISOString() },
    getPack,
  ), null);
});

test("reports provider, signal, and agent contract violations", () => {
  const invalid = customPack({
    presentation: { map: { id: "wrong-map", label: "Air quality", short: "AQI", color: "#8de85b", source: "Test", status: "live", details: [] } },
    providers: [{ id: "city-air-quality", label: "City air-quality feed", type: "http-json" }],
    signals: [{ id: "air-quality.observation", label: "Observation", providerId: "missing-provider", subdomainId: "default" }, { id: "air-quality.observation", label: "Duplicate", providerId: "city-air-quality", subdomainId: "default" }, { id: "air-quality.unknown", label: "Unknown subdomain", providerId: "city-air-quality", subdomainId: "missing" }],
    agents: { capabilities: [{ id: "air-quality.search", label: "Search", permission: "read", toolIds: ["missing-tool"] }] },
  });
  const errors = validateSignalPacks([invalid]);
  assert.ok(errors.some((error) => error.includes("map id must match")));
  assert.ok(errors.some((error) => error.includes("missing an endpoint")));
  assert.ok(errors.some((error) => error.includes("unknown provider")));
  assert.ok(errors.some((error) => error.includes("unknown subdomain")));
  assert.ok(errors.some((error) => error.includes("duplicate signal id")));
  assert.ok(errors.some((error) => error.includes("unknown tool")));
});
