import { defineCodePackManifest, detail, graph } from "../manifest-helpers";

export const sanctionsManifest = defineCodePackManifest({
  domain: "sanctions",
  label: "Sanctions",
  short: "SDN",
  color: "#e6e2d3",
  source: "OFAC SDN XML",
  sourceId: "ofac-sdn",
  status: "live",
  defaultEnabled: true,
  subdomains: [{ id: "default", label: "Sanctions records" }],
  signal: { id: "sanctions.observation", label: "Sanctions record", subdomainId: "default" },
  graph: graph({ nodeType: "organization", resolver: "pack:sanctions", facts: [{ label: "SOURCE", value: { path: "source.id" } }] }),
  details: [detail("all", "Sanctions records")],
});
