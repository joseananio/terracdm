import { defineCodePackManifest, detail, graph } from "../manifest-helpers";

export const cyberManifest = defineCodePackManifest({
  domain: "cyber",
  label: "Cyber threats",
  short: "CVE",
  color: "#ff8bd6",
  source: "NVD 2.0 API",
  sourceId: "cyber-network",
  status: "live",
  defaultEnabled: true,
  subdomains: [{ id: "default", label: "Threat indicators" }],
  signal: { id: "cyber.observation", label: "Threat indicator", subdomainId: "default" },
  graph: graph({ nodeType: "organization", resolver: "pack:cyber", facts: [{ label: "SOURCE", value: { path: "source.id" } }] }),
  details: [detail("all", "All incoming CVEs"), detail("critical", "Critical CVEs", { field: "riskScore", gte: 80 })],
});
