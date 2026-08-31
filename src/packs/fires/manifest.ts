import { defineCodePackManifest, detail, graph } from "../manifest-helpers";

export const firesManifest = defineCodePackManifest({
  domain: "fires",
  label: "Fire",
  short: "FIR",
  color: "#ff4b22",
  source: "NASA FIRMS / NASA EONET",
  sourceId: "fires-network",
  status: "live",
  defaultEnabled: true,
  subdomains: [{ id: "thermal-hotspot", label: "Thermal hotspots" }, { id: "wildfire-event", label: "Wildfire events" }],
  providers: [
    { id: "nasa-firms", label: "NASA FIRMS thermal hotspots", sourceId: "nasa-firms", sourceMode: "key_required", type: "code", implementation: "pack:fires-firms", pollSeconds: 120 },
    { id: "nasa-eonet", label: "NASA EONET wildfire events", sourceId: "nasa-eonet", sourceMode: "live", type: "code", implementation: "pack:fires-eonet", pollSeconds: 120 },
  ],
  signals: [
    { id: "fires-firms.hotspot", label: "Thermal hotspot", providerId: "nasa-firms", subdomainId: "thermal-hotspot" },
    { id: "fires-eonet.wildfire", label: "Wildfire event", providerId: "nasa-eonet", subdomainId: "wildfire-event" },
  ],
  graph: graph({ nodeType: "event", resolver: "pack:fires", facts: [{ label: "COUNTRY", value: { path: "properties.country" } }, { label: "RISK SCORE", value: { path: "riskScore" }, format: "number" }] }),
  details: [detail("all", "All fire observations"), detail("thermal-hotspots", "Thermal hotspots", { field: "properties.fireKind", equals: "thermal hotspot" }), detail("wildfire-events", "Wildfire events", { field: "properties.fireKind", equals: "wildfire event" }), detail("high-brightness", "High brightness", { field: "properties.brightness", gte: 350 })],
});
