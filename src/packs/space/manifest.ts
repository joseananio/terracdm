import { defineCodePackManifest, detail, graph } from "../manifest-helpers";

export const spaceManifest = defineCodePackManifest({
  domain: "space",
  label: "Space",
  short: "ORB",
  color: "#d4a7ff",
  source: "NOAA SWPC / CelesTrak",
  sourceId: "space-network",
  status: "live",
  subdomains: [{ id: "starlink-comms", label: "Starlink / comms" }, { id: "military-intel", label: "Military / intel" }, { id: "gps-navigation", label: "GPS / navigation" }, { id: "earth-observation", label: "Earth observation" }, { id: "stations-telescopes", label: "Stations / telescopes" }, { id: "space-weather", label: "Space weather" }, { id: "other", label: "Other satellites" }],
  signal: { id: "space.observation", label: "Space weather observation", subdomainId: "space-weather" },
  graph: graph({ nodeType: "satellite", resolver: "pack:space", wikidataProperties: ["P137", "P17", "P361"], facts: [{ label: "MISSION", value: { path: "properties.spaceClass" } }, { label: "NORAD", value: { path: "properties.noradId" } }] }),
  details: [detail("all", "All satellites", { field: "id", exists: true }), detail("starlink-comms", "Starlink / comms", { field: "properties.spaceClass", equals: "starlink-comms" }), detail("military-intel", "Military / intel", { field: "properties.spaceClass", equals: "military-intel" }), detail("gps-navigation", "GPS / navigation", { field: "properties.spaceClass", equals: "gps-navigation" }), detail("earth-observation", "Earth observation", { field: "properties.spaceClass", equals: "earth-observation" }), detail("stations-telescopes", "Stations / telescopes", { field: "properties.spaceClass", equals: "stations-telescopes" }), detail("space-weather", "Space weather", { field: "id", exists: true })],
});
