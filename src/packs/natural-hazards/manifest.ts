import { defineCodePackManifest, detail, graph } from "../manifest-helpers";

export const naturalHazardsManifest = defineCodePackManifest({
  domain: "natural-hazards",
  label: "Natural hazards",
  short: "HAZ",
  color: "#d9a441",
  source: "USGS / NWS / MeteoAlarm / GDACS / EONET",
  sourceId: "natural-hazards-network",
  status: "live",
  defaultEnabled: true,
  subdomains: [{ id: "seismic", label: "Earthquakes" }, { id: "severe-storm", label: "Severe storms" }, { id: "weather-alert", label: "Weather alerts" }],
  providers: [
    { id: "usgs", label: "USGS Earthquakes", sourceId: "usgs", sourceMode: "live", type: "code", implementation: "pack:natural-hazards.seismic", pollSeconds: 60 },
    { id: "weather-stack", label: "NWS / MeteoAlarm / GDACS / EONET", sourceId: "weather-stack", sourceMode: "live", type: "code", implementation: "pack:natural-hazards.weather", pollSeconds: 60 },
  ],
  signals: [
    { id: "natural-hazards.seismic", label: "Earthquake observation", providerId: "usgs", subdomainId: "seismic" },
    { id: "natural-hazards.severe-storm", label: "Severe weather observation", providerId: "weather-stack", subdomainId: "severe-storm" },
    { id: "natural-hazards.weather-alert", label: "Weather alert", providerId: "weather-stack", subdomainId: "weather-alert" },
  ],
  graph: graph({ nodeType: "event", resolver: "pack:natural-hazards", facts: [{ label: "COUNTRY", value: { path: "properties.country" } }, { label: "RISK SCORE", value: { path: "riskScore" }, format: "number" }] }),
  details: [detail("all", "All natural hazards"), detail("earthquakes", "Earthquakes", { field: "subdomainId", equals: "seismic" }), detail("major-earthquakes", "M4.0+ earthquakes", { all: [{ field: "subdomainId", equals: "seismic" }, { field: "properties.magnitude", gte: 4 }] }), detail("tsunami", "Tsunami flagged", { all: [{ field: "subdomainId", equals: "seismic" }, { field: "properties.tsunami", equals: true }] }), detail("severe-storms", "Severe storms", { field: "subdomainId", equals: "severe-storm" }), detail("weather-alerts", "Weather alerts", { field: "subdomainId", equals: "weather-alert" }), detail("elevated-weather", "Elevated weather", { all: [{ field: "subdomainId", in: ["severe-storm", "weather-alert"] }, { field: "riskScore", gte: 50 }] })],
});
