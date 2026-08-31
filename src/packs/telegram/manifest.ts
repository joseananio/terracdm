import { defineCodePackManifest, detail, graph } from "../manifest-helpers";

export const telegramManifest = defineCodePackManifest({
  domain: "telegram",
  label: "Telegram OSINT",
  short: "TG",
  color: "#65b7ff",
  source: "Public channel previews",
  sourceId: "telegram-public",
  status: "live",
  defaultEnabled: true,
  subdomains: [{ id: "default", label: "Public channels" }],
  signal: { id: "telegram.observation", label: "Public channel signal", subdomainId: "default" },
  graph: graph({ nodeType: "organization", resolver: "pack:telegram", facts: [{ label: "SOURCE", value: { path: "source.id" } }] }),
  details: [detail("all", "Public channel signals")],
});
