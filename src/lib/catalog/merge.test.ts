import assert from "node:assert/strict";
import test from "node:test";
import type { SignalPackManifest } from "./types.ts";
import { mergeSignalPackManifest, mergeSignalPackManifests } from "./merge.ts";
import { builtInSignalPackManifests } from "../../packs/manifests.ts";
import { compileSignalPack } from "./compiler.ts";
import { validateSignalPacks } from "./validation.ts";

function contribution(overrides: Partial<SignalPackManifest> = {}): SignalPackManifest {
  return {
    domain: "weather",
    version: "1.0.0",
    label: "Weather",
    subdomains: [{ id: "severe-storm", label: "Severe storms" }],
    providers: [{ id: "weather-feed", label: "Weather feed", type: "http-json", endpoint: "https://example.test/weather.json" }],
    signals: [{ id: "weather.alert", label: "Weather alert", providerId: "weather-feed", subdomainId: "severe-storm" }],
    presentation: {
      map: { id: "weather", label: "Weather", short: "WX", color: "#9aa7ff", source: "Weather feed", status: "live", details: [{ id: "all", label: "All weather" }] },
      graph: { nodeType: "event", relations: [{ id: "same-source", label: "SAME SOURCE", score: 2, when: { type: "same-source" } }] },
    },
    ...overrides,
  };
}

test("merges same-domain contributions across catalog surfaces", () => {
  const extension = contribution({
    subdomains: [{ id: "weather-alert", label: "Weather alerts" }],
    providers: [{ id: "weather-alerts", label: "Weather alerts", type: "rss", endpoint: "https://example.test/weather.xml" }],
    signals: [{ id: "weather.warning", label: "Weather warning", providerId: "weather-alerts", subdomainId: "weather-alert" }],
    presentation: {
      map: { id: "weather", label: "Weather", short: "WX", color: "#9aa7ff", source: "Weather feed", status: "live", details: [{ id: "severe", label: "Severe weather" }] },
      node: { subgroup: { path: "properties.category" }, fields: [{ label: "Category", value: { path: "properties.category" } }] },
      menu: [{ id: "open-source", label: "Open source", kind: "open-url", url: { path: "url" } }],
      graph: {
        nodeType: "event",
        facts: [{ label: "Category", value: { path: "properties.category" } }],
        wikidataProperties: ["P31"],
        relations: [{ id: "nearby", label: "NEARBY", score: 1, when: { type: "distance-km", lessThan: 25 } }],
      },
    },
    agents: {
      context: [{ include: "weather alerts", limit: 20 }],
      tools: [{ id: "weather.search", label: "Search weather", source: "provider", permission: "read" }],
      capabilities: [{ id: "weather.search", label: "Search weather", permission: "read", toolIds: ["weather.search"] }],
    },
  });

  const merged = mergeSignalPackManifest([contribution(), extension]);
  assert.deepEqual(merged.subdomains.map((item) => item.id), ["severe-storm", "weather-alert"]);
  assert.deepEqual(merged.providers.map((item) => item.id), ["weather-feed", "weather-alerts"]);
  assert.deepEqual(merged.signals?.map((item) => item.id), ["weather.alert", "weather.warning"]);
  assert.deepEqual(merged.presentation.map.details.map((item) => item.id), ["all", "severe"]);
  assert.equal(merged.presentation.menu?.[0].id, "open-source");
  assert.deepEqual(merged.presentation.graph?.relations?.map((item) => item.id), ["same-source", "nearby"]);
  assert.deepEqual(merged.presentation.graph?.wikidataProperties, ["P31"]);
  assert.equal(merged.agents?.tools?.[0].id, "weather.search");
  assert.equal(merged.presentation.node?.fields?.[0].label, "Category");
});

test("deduplicates identical contributions and preserves first-seen domain order", () => {
  const weather = contribution();
  const aviation = { ...contribution(), domain: "aviation", label: "Aviation", presentation: { ...contribution().presentation, map: { ...contribution().presentation.map, id: "aviation", label: "Aviation" } } };
  const merged = mergeSignalPackManifests([weather, aviation, weather]);
  assert.deepEqual(merged.map((pack) => pack.domain), ["weather", "aviation"]);
  assert.equal(merged[0].providers.length, 1);
  assert.equal(merged[0].subdomains.length, 1);
});

test("rejects conflicting same-domain definitions instead of overriding them", () => {
  assert.throws(() => mergeSignalPackManifest([contribution(), contribution({ label: "Different weather" })]), /conflicting label/);
  assert.throws(() => mergeSignalPackManifest([contribution(), contribution({ subdomains: [{ id: "severe-storm", label: "Storms" }] })]), /conflicting subdomains\.severe-storm/);
  assert.throws(() => mergeSignalPackManifest([contribution(), contribution({ providers: [{ id: "weather-feed", label: "Different feed", type: "http-json", endpoint: "https:\/\/example.test\/other.json" }] })]), /conflicting providers\.weather-feed/);
});

test("the live natural-hazards pack owns seismic and weather subdomains", () => {
  const domain = "natural-hazards";
  const manifest = builtInSignalPackManifests.find((pack) => pack.domain === domain);
  assert.ok(manifest);
  const compiled = compileSignalPack(manifest);
  assert.deepEqual(validateSignalPacks([compiled]), []);
  assert.equal(compiled.domain, domain);
  assert.deepEqual(compiled.subdomains.map((subdomain) => subdomain.id), ["seismic", "severe-storm", "weather-alert"]);
  assert.deepEqual(compiled.providers.map((provider) => provider.id), ["usgs", "weather-stack"]);
  assert.deepEqual(compiled.signals?.map((signal) => signal.id), ["natural-hazards.seismic", "natural-hazards.severe-storm", "natural-hazards.weather-alert"]);
  assert.equal(compiled.presentation.map.id, domain);
  assert.equal(compiled.presentation.graph?.resolver, "pack:natural-hazards");
});
