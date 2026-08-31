import { defineCodePackManifest, detail, graph } from "../manifest-helpers";

export const conflictManifest = defineCodePackManifest({
  domain: "conflict",
  label: "Conflict zones",
  short: "WAR",
  color: "#ff6b6b",
  source: "Theater baseline / ACLED-ready",
  sourceId: "conflict-network",
  status: "cached",
  defaultEnabled: true,
  subdomains: [{ id: "theater", label: "Theaters" }, { id: "event", label: "Events" }],
  signal: { id: "conflict.observation", label: "Conflict observation", subdomainId: "theater" },
  graph: graph({ nodeType: "event", resolver: "pack:conflict", facts: [{ label: "COUNTRY", value: { path: "properties.country" } }, { label: "RISK SCORE", value: { path: "riskScore" }, format: "number" }] }),
  details: [detail("all", "All theaters"), detail("elevated", "Elevated theaters", { field: "riskScore", gte: 70 }), detail("critical", "Critical theaters", { field: "riskScore", gte: 82 })],
});
