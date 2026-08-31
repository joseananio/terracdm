import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { SignalPack } from "../catalog/types.ts";
import {
  applyInstanceProviderOverrides,
  assertValidInstanceConfig,
  loadConfigPackManifests,
  loadInstanceConfigFile,
  selectInstancePackDomains,
  validateInstanceConfig,
} from "./instance-config.ts";

const pack: SignalPack = {
  domain: "aviation",
  version: "1.0.0",
  label: "Aviation",
  subdomains: [{ id: "commercial", label: "Commercial" }],
  providers: [{
    id: "aviation-network",
    label: "Aviation network",
    sourceId: "aviation-network",
    sourceMode: "live",
    domain: "aviation",
    type: "code",
    implementation: "pack:aviation",
    pollSeconds: 60,
    cache: { maxAgeSeconds: 60 },
  }],
  signals: [{ id: "aviation.observation", label: "Aviation observation", providerId: "aviation-network", subdomainId: "commercial" }],
  presentation: { map: { id: "aviation", label: "Aviation", short: "AIR", color: "#56d7ff", source: "Aviation network", status: "live", details: [] } },
};

test("validates the instance selection and provider override shape", () => {
  const input = {
    version: 1,
    packs: {
      defaults: "disabled",
      entries: {
        aviation: {
          enabled: true,
          providers: {
            "aviation-network": {
              enabled: false,
              sourceMode: "unavailable",
              pollSeconds: 120,
              cache: { maxAgeSeconds: 120, staleIfErrorSeconds: 600 },
            },
          },
        },
      },
    },
  };
  assert.deepEqual(validateInstanceConfig(input), []);
  assert.deepEqual([...selectInstancePackDomains(["aviation", "weather"], assertValidInstanceConfig(input))], ["aviation"]);
});

test("loads an instance YAML file without exposing environment values", () => {
  const directory = mkdtempSync(join(tmpdir(), "terracdm-instance-"));
  const path = join(directory, "terracdm.yaml");
  try {
    writeFileSync(path, `
version: 1
packs:
  defaults: disabled
  entries:
    aviation:
      enabled: true
      providers:
        aviation-network:
          auth:
            env: OPENSKY_CLIENT_ID
          pollSeconds: 90
`, "utf8");
    const loaded = loadInstanceConfigFile(path);
    assert.equal(loaded.path, path);
    assert.equal(loaded.config.packs.entries.aviation.providers?.["aviation-network"].auth?.env, "OPENSKY_CLIENT_ID");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("allows an instance source pack to contribute to an existing domain", () => {
  const directory = mkdtempSync(join(tmpdir(), "terracdm-domain-extension-"));
  const sourcePath = join(directory, "aviation-extension.json");
  try {
    writeFileSync(sourcePath, JSON.stringify({
      domain: "aviation",
      version: "1.0.0",
      label: "Aviation",
      subdomains: [{ id: "commercial", label: "Commercial" }, { id: "regional", label: "Regional" }],
      providers: [{ id: "regional-feed", label: "Regional feed", type: "http-json", endpoint: "https://example.test/regional.json", mapping: { entity: { id: { path: "id" }, name: { path: "name" }, location: { lat: { path: "lat" }, lng: { path: "lng" } } } } }],
      signals: [{ id: "aviation.regional", label: "Regional aircraft", providerId: "regional-feed", subdomainId: "regional" }],
      presentation: { map: { id: "aviation", label: "Aviation", short: "AIR", color: "#56d7ff", source: "Aviation network", status: "live", details: [] } },
    }), "utf8");
    const config = assertValidInstanceConfig({ version: 1, packs: { defaults: "enabled", entries: { aviation: { source: "aviation-extension.json" } } } });
    const manifests = loadConfigPackManifests(config, directory);
    assert.equal(manifests.length, 1);
    assert.equal(manifests[0].domain, "aviation");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("applies provider runtime overrides without changing its implementation", () => {
  const overridden = applyInstanceProviderOverrides(pack, {
    "aviation-network": { enabled: false, pollSeconds: 180, sourceMode: "unavailable" },
  });
  assert.equal(overridden.providers[0].enabled, false);
  assert.equal(overridden.providers[0].pollSeconds, 180);
  assert.equal(overridden.providers[0].sourceMode, "unavailable");
  assert.equal(overridden.providers[0].implementation, "pack:aviation");
});

test("rejects unknown instance keys and invalid provider overrides", () => {
  const errors = validateInstanceConfig({
    version: 1,
    packs: {
      defaults: "enabled",
      entries: {
        aviation: {
          providers: {
            "aviation-network": { endpoint: "not a url", pollSeconds: 0 },
          },
          secrets: { key: "must not be here" },
        },
      },
    },
  });
  assert.ok(errors.some((error) => error.includes("secrets is not supported")));
  assert.ok(errors.some((error) => error.includes("endpoint must be a valid URL")));
  assert.ok(errors.some((error) => error.includes("pollSeconds must be a finite number >= 1")));
});
