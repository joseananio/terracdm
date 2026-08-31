import { defineCodePackManifest, detail, graph } from "../manifest-helpers";

export const aviationManifest = defineCodePackManifest({
  domain: "aviation",
  label: "Aviation",
  short: "AIR",
  color: "#56d7ff",
  source: "OpenSky anonymous / ADS-B fallbacks",
  sourceId: "aviation-network",
  status: "live",
  subdomains: [{ id: "commercial", label: "Commercial" }, { id: "private", label: "Private" }, { id: "private-jets", label: "Private jets" }, { id: "military", label: "Military" }],
  signal: { id: "aviation.observation", label: "Aviation observation", subdomainId: "commercial" },
  graph: graph({ nodeType: "aircraft", resolver: "pack:aviation", wikidataProperties: ["P17", "P749", "P169"], facts: [{ label: "CLASS", value: { path: "properties.aircraftClass" } }, { label: "TYPE", value: { path: "properties.aircraftType" } }, { label: "REGISTRATION", value: { path: "properties.registration" } }, { label: "ICAO24", value: { path: "properties.icao24" } }] }),
  details: [detail("all", "All aircraft"), detail("commercial", "Commercial", { field: "properties.aircraftClass", equals: "commercial" }), detail("private", "Private", { field: "properties.aircraftClass", equals: "private" }), detail("private-jets", "Private jets", { field: "properties.aircraftClass", equals: "private-jets" }), detail("military", "Military", { field: "properties.aircraftClass", equals: "military" }), detail("airborne", "Airborne", { field: "properties.onGround", equals: false }), detail("ground", "Ground positions", { field: "properties.onGround", equals: true }), detail("fast", "High velocity", { field: "properties.velocity", gte: 200 })],
});
