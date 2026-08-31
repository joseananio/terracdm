import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { getCatalog } from "./registry.ts";
import { loadPack, loadPackManifest } from "./config/load-pack.ts";
import { registerPack } from "../server/pack-registry.ts";
import { assembleCatalog } from "../server/catalog-assembly.ts";
import { runProvider } from "./provider-runtime.ts";

const fixtureText = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

test("YAML and JSON fixtures compile into identical canonical packs", () => {
  const yamlPack = loadPack(fixtureText("verification-pack.yaml"), "yaml");
  const jsonPack = loadPack(fixtureText("verification-pack.json"), "json");
  assert.deepEqual(jsonPack, yamlPack);
  assert.deepEqual(yamlPack.providers.map((provider) => provider.domain), ["verification", "verification", "verification", "verification"]);
  assert.deepEqual(yamlPack.signals?.map((signal) => signal.subdomainId), ["http-json", "geojson", "rss", "csv"]);
});

test("HTTP JSON, GeoJSON, RSS, and CSV fixtures map to canonical observations", async () => {
  const manifest = loadPackManifest(fixtureText("verification-pack.yaml"), "yaml");
  registerPack({ manifest });
  assembleCatalog();
  const pack = getCatalog().getPack("verification");
  assert.ok(pack);

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.endsWith("/http.json")) return new Response(fixtureText("http.json"), { headers: { "content-type": "application/json" } });
    if (url.endsWith("/geo.json")) return new Response(fixtureText("geojson.json"), { headers: { "content-type": "application/geo+json" } });
    if (url.endsWith("/feed.xml")) return new Response(fixtureText("feed.xml"), { headers: { "content-type": "application/rss+xml" } });
    if (url.endsWith("/data.csv")) return new Response(fixtureText("data.csv"), { headers: { "content-type": "text/csv" } });
    throw new Error(`Unexpected fixture URL: ${url}`);
  };

  try {
    const snapshots = await Promise.all(pack.providers.map((provider) => runProvider(provider)));
    const [http, geojson, rss, csv] = snapshots;

    assert.equal(http.observations[0].id, "http-1");
    assert.equal(http.observations[0].subdomainId, "http-json");
    assert.deepEqual(http.observations[0].location?.coordinates, { lat: 52.52, lng: 13.405 });
    assert.equal(http.observations[0].risk, "high");

    assert.equal(geojson.observations[0].id, "geo-1");
    assert.equal(geojson.observations[0].subdomainId, "geojson");
    assert.deepEqual(geojson.observations[0].location?.coordinates, { lat: 48.8566, lng: 2.3522 });

    assert.equal(rss.observations[0].kind, "signal");
    assert.equal(rss.observations[0].id, "rss-1");
    assert.equal(rss.observations[0].subdomainId, "rss");
    assert.equal(rss.observations[0].location?.label, "London");
    assert.equal(rss.observations[0].properties?.format, "rss");

    assert.equal(csv.observations[0].id, "csv-1");
    assert.equal(csv.observations[0].subdomainId, "csv");
    assert.deepEqual(csv.observations[0].location?.coordinates, { lat: 40.4168, lng: -3.7038 });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
