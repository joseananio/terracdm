import { defineCodePackManifest, detail, graph } from "../manifest-helpers";

export const cctvManifest = defineCodePackManifest({
  domain: "cctv",
  label: "CCTV network",
  short: "CAM",
  color: "#c5d46f",
  source: "TfL JamCams",
  sourceId: "cctv-network",
  status: "live",
  defaultEnabled: true,
  subdomains: [{ id: "default", label: "Traffic cameras" }],
  signal: { id: "cctv.observation", label: "Traffic camera", subdomainId: "default" },
  graph: graph({ nodeType: "device", resolver: "pack:cctv", wikidataProperties: ["P17", "P137", "P159", "P749"], facts: [{ label: "CITY", value: { path: "properties.city" } }, { label: "COUNTRY", value: { path: "properties.country" } }] }),
  details: [detail("all", "All cameras"), detail("available", "Available feeds", { field: "properties.available", equals: true })],
});
