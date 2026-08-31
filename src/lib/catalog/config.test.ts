import assert from "node:assert/strict";
import test from "node:test";
import { loadPack, loadPackManifest } from "./config/load-pack.ts";
import { validatePackConfig } from "./config/validate-pack.ts";
import { registerPack } from "../server/pack-registry.ts";

const jsonPack = {
  domain: "air-quality",
  version: "1.0.0",
  label: "Air quality",
  subdomains: [{ id: "station", label: "Stations" }],
  providers: [{
    id: "city-air-quality",
    label: "City air-quality feed",
    type: "http-json",
    endpoint: "https://example.test/air-quality.json",
    mapping: { entity: { id: { path: "id" }, name: { path: "name" }, location: { lat: { path: "lat" }, lng: { path: "lng" } } } },
  }],
  signals: [{ id: "air-quality.alert", label: "Air-quality alert", providerId: "city-air-quality", subdomainId: "station" }],
  presentation: { map: { id: "air-quality", label: "Air quality", short: "AQI", color: "#8de85b", source: "City feed", status: "live", details: [{ id: "all", label: "All stations" }] } },
};

test("loads JSON config into the canonical runtime pack", () => {
  const pack = loadPack(JSON.stringify(jsonPack), "json");
  assert.equal(pack.domain, "air-quality");
  assert.equal(pack.providers[0].domain, "air-quality");
  assert.equal("domain" in jsonPack.providers[0], false);
});

test("keeps the validated manifest available for catalog registration", () => {
  const manifest = loadPackManifest(JSON.stringify(jsonPack), "json");
  assert.equal(manifest.domain, "air-quality");
  assert.equal("domain" in manifest.providers[0], false);
});

test("uses registerPack for declarative manifests without implementations", () => {
  const domain = "config-only-registration-test";
  const manifest = loadPackManifest(JSON.stringify({
    ...jsonPack,
    domain,
    signals: [{ ...jsonPack.signals[0], id: `${domain}.alert` }],
    presentation: { ...jsonPack.presentation, map: { ...jsonPack.presentation.map, id: domain } },
  }), "json");
  const pack = registerPack({ manifest });
  assert.equal(pack.domain, domain);
});

test("loads YAML config into the canonical runtime pack", () => {
  const pack = loadPack(`
domain: air-quality
version: 1.0.0
label: Air quality
subdomains:
  - id: station
    label: Stations
providers:
  - id: city-air-quality
    label: City air-quality feed
    type: http-json
    endpoint: https://example.test/air-quality.json
    mapping:
      entity:
        id: { path: id }
        name: { path: name }
        location:
          lat: { path: lat }
          lng: { path: lng }
signals:
  - id: air-quality.alert
    label: Air-quality alert
    providerId: city-air-quality
    subdomainId: station
presentation:
  map:
    id: air-quality
    label: Air quality
    short: AQI
    color: '#8de85b'
    source: City feed
    status: live
    details:
      - id: all
        label: All stations
`, "yaml");
  assert.equal(pack.domain, "air-quality");
  assert.equal(pack.signals?.[0].subdomainId, "station");
});

test("rejects code-backed providers in config-only packs", () => {
  const errors = validatePackConfig({ ...jsonPack, providers: [{ id: "custom", label: "Custom", type: "code", implementation: "pack:custom" }] });
  assert.ok(errors.some((error) => error.includes("implementation is not supported")));
});

test("rejects executable graph and agent references in config-only packs", () => {
  const errors = validatePackConfig({
    ...jsonPack,
    presentation: { ...jsonPack.presentation, graph: { resolver: "pack:custom" } },
    agents: { tools: [{ id: "custom.search", label: "Custom search", source: "custom", permission: "read", handler: "customSearch" }] },
  });
  assert.ok(errors.some((error) => error.includes("graph.resolver")));
  assert.ok(errors.some((error) => error.includes("tools[0].handler")));
});

test("rejects semantic manifest errors before compilation", () => {
  const errors = validatePackConfig({ ...jsonPack, signals: [{ ...jsonPack.signals[0], subdomainId: "missing" }] });
  assert.ok(errors.some((error) => error.includes("unknown subdomain")));
});
