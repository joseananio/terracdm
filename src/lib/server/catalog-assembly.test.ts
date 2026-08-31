import assert from "node:assert/strict";
import test from "node:test";
import { getCatalog } from "../catalog/registry.ts";
import { getGraphImplementation, getProviderImplementation } from "./pack-registry.ts";
import { registerPack } from "./pack-registry.ts";
import { assembleCatalog, catalogAssembly } from "./catalog-assembly.ts";
import type { ProviderSnapshot } from "../intelligence.ts";
import type { SignalPackManifest } from "../catalog/types.ts";

function codeContribution(domain: string, providerId: string, implementation: string, subdomainId: string): SignalPackManifest {
  return {
    domain,
    version: "1.0.0",
    label: "Assembly test",
    subdomains: [{ id: subdomainId, label: subdomainId }],
    providers: [{ id: providerId, label: providerId, type: "code", implementation }],
    signals: [{ id: `${domain}.${subdomainId}`, label: subdomainId, providerId, subdomainId }],
    presentation: { map: { id: domain, label: "Assembly test", short: "TEST", color: "#ffffff", source: "Assembly test", status: "live", details: [] } },
  };
}

const emptySnapshot = (domain: string, providerId: string): ProviderSnapshot => ({
  domain,
  providerId,
  source: { id: providerId, name: providerId },
  status: "live",
  fetchedAt: "2026-08-23T00:00:00.000Z",
  observations: [],
});

test("builds one runtime from code packs and exposes their implementations", () => {
  const assembly = assembleCatalog();
  const domains = new Set(assembly.activePacks.map((pack) => pack.domain));

  assert.ok(domains.has("aviation"));
  assert.ok(domains.has("natural-hazards"));
  assert.ok(getProviderImplementation("pack:aviation"));
  assert.ok(getProviderImplementation("pack:natural-hazards.seismic"));
  assert.ok(getProviderImplementation("pack:natural-hazards.weather"));
  assert.ok(getGraphImplementation("pack:aviation"));
  assert.ok(getGraphImplementation("pack:natural-hazards"));
  assert.equal(getProviderImplementation("pack:seismic"), undefined);
  assert.equal(getProviderImplementation("pack:weather"), undefined);
  assert.equal(getGraphImplementation("pack:seismic"), undefined);
  assert.equal(getGraphImplementation("pack:weather"), undefined);
  assert.equal(getCatalog().packs.length, assembly.activePacks.length);
  assert.ok(catalogAssembly.manifests.length >= assembly.activePacks.length);
});

test("merges multiple registered code contributions for one domain", () => {
  const domain = "same-domain-code-assembly-test";
  const first = codeContribution(domain, "assembly-first", "test:assembly-first", "first");
  const second = codeContribution(domain, "assembly-second", "test:assembly-second", "second");
  registerPack({ manifest: first, implementations: { providers: { "test:assembly-first": async () => emptySnapshot(domain, "assembly-first") } } });
  registerPack({ manifest: second, implementations: { providers: { "test:assembly-second": async () => emptySnapshot(domain, "assembly-second") } } });

  const assembly = assembleCatalog();
  const merged = assembly.activePacks.find((pack) => pack.domain === domain);
  assert.ok(merged);
  assert.deepEqual(merged.subdomains.map((item) => item.id), ["first", "second"]);
  assert.deepEqual(merged.providers.map((item) => item.id), ["assembly-first", "assembly-second"]);
  assert.ok(getProviderImplementation("test:assembly-first"));
  assert.ok(getProviderImplementation("test:assembly-second"));
});

test("replaces a reloaded code pack instead of duplicating its providers", () => {
  const domain = "hot-reload-code-pack-test";
  const manifest = codeContribution(domain, "reload-provider", "test:reload-provider", "default");
  const firstImplementation = async () => emptySnapshot(domain, "reload-provider");
  const secondImplementation = async () => emptySnapshot(domain, "reload-provider");

  registerPack({ manifest, implementations: { providers: { "test:reload-provider": firstImplementation } } });
  registerPack({ manifest, implementations: { providers: { "test:reload-provider": secondImplementation } } });

  const assembly = assembleCatalog();
  assert.equal(assembly.packs.filter((pack) => pack.domain === domain).length, 1);
  assert.equal(assembly.packs.find((pack) => pack.domain === domain)?.providers.length, 1);
  assert.equal(getProviderImplementation("test:reload-provider"), secondImplementation);
});
