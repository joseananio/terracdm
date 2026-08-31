import { defineCodePackManifest, detail, graph } from "../manifest-helpers";

export const newsManifest = defineCodePackManifest({
  domain: "news",
  label: "Live broadcast",
  short: "NEWS",
  color: "#71f0e6",
  source: "GDELT / BBC / TechRadar RSS",
  sourceId: "news-network",
  status: "live",
  defaultEnabled: true,
  subdomains: [{ id: "global-report", label: "Global reports" }, { id: "live-broadcaster", label: "Live broadcasters" }],
  signal: { id: "news.observation", label: "Global report", subdomainId: "global-report" },
  graph: graph({ nodeType: "organization", resolver: "pack:news", facts: [{ label: "SOURCE", value: { path: "source.id" } }] }),
  details: [detail("all", "Live news feeds")],
});
