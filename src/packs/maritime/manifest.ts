import { defineCodePackManifest, detail, graph } from "../manifest-helpers";

export const maritimeManifest = defineCodePackManifest({
  domain: "maritime",
  label: "Maritime",
  short: "SEA",
  color: "#65e0b5",
  source: "Static maritime baseline",
  sourceId: "maritime-network",
  status: "cached",
  subdomains: [{ id: "port", label: "Ports" }, { id: "energy", label: "Energy ports" }, { id: "naval", label: "Naval bases" }, { id: "chokepoint", label: "Chokepoints" }],
  signal: { id: "maritime.observation", label: "Maritime observation", subdomainId: "port" },
  graph: graph({ nodeType: "location", resolver: "pack:maritime", wikidataProperties: ["P17", "P131", "P31"], facts: [{ label: "KIND", value: { path: "properties.kind" } }, { label: "RISK SCORE", value: { path: "riskScore" }, format: "number" }] }),
  details: [detail("all", "All maritime"), detail("ports", "Strategic ports", { field: "properties.kind", equals: "port" }), detail("energy", "Energy ports", { field: "properties.kind", equals: "energy" }), detail("naval", "Naval bases", { field: "properties.kind", equals: "naval" }), detail("chokepoints", "Chokepoints", { field: "properties.kind", equals: "chokepoint" }), detail("elevated", "Elevated risk", { field: "riskScore", gte: 50 })],
});
