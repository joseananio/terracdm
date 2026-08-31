import { Domain, Entity, Signal } from "../intelligence";
import { observationsToEntities, observationsToSignals } from "../catalog/observations";
import { getSnapshot } from "./providers";
import { bitcoinLookup, cveLookup, dnsLookup, ethereumLookup, ipLookup, scannerLookup, searchSanctions, tlsLookup, validateQuery, whoisLookup } from "./osint";
import { saveAgentRun, saveWatchlist } from "./store";

export type AgentResult = { traceId: string; intent: string; summary: string; steps: string[]; evidence: string[]; sources: string[]; data: unknown; storage?: string };

function renderSignal(signal: Signal) { return `${signal.name} · ${signal.description} · ${signal.source.name}`; }

export async function runAgentTask(command: string, context?: { entityIds?: string[] }) : Promise<AgentResult> {
  const normalized = command.toLowerCase();
  let intent = "INTELLIGENCE BRIEF / LIVE";
  let data: unknown = null;
  let evidence: string[] = [];
  let sources: string[] = [];
  let summary = "The task completed against the configured intelligence providers.";
  let steps = ["Parse operator intent", "Execute registered provider tools", "Return source-linked evidence"];

  try {
    if (normalized.includes("dns") || normalized.includes("whois") || normalized.includes("domain")) {
      const query = command.match(/(?:dns|whois|domain)\s+(?:for\s+)?([a-z0-9.-]+)$/i)?.[1] ?? command.match(/([a-z0-9-]+\.[a-z]{2,})/i)?.[1];
      const value = validateQuery(query ?? null, "domain");
      data = normalized.includes("whois") ? await whoisLookup(value) : await dnsLookup(value);
      intent = normalized.includes("whois") ? "RECON / RDAP" : "RECON / DNS";
      sources = [normalized.includes("whois") ? "RDAP" : "system DNS resolver"];
      evidence = [JSON.stringify(data).slice(0, 800)];
      summary = `Completed ${intent.toLowerCase()} for ${value}.`;
      steps = ["Validate operator target", "Query public resolver", "Return raw result for review"];
    } else if (normalized.includes("ip ") || normalized.includes("ip intelligence")) {
      const value = validateQuery(command.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/)?.[0] ?? null, "IP");
      data = await ipLookup(value);
      intent = "RECON / IP INTELLIGENCE";
      sources = ["ipwho.is"];
      evidence = [JSON.stringify(data).slice(0, 800)];
      summary = `Completed public IP enrichment for ${value}.`;
      steps = ["Validate target IP", "Resolve geolocation and ASN data", "Return provider response"];
    } else if (normalized.includes("tls") || normalized.includes("ssl") || normalized.includes("certificate")) {
      const value = validateQuery(command.match(/(?:tls|ssl|certificate)\s+(?:for\s+)?([a-z0-9.-]+)(?::\d+)?$/i)?.[1] ?? command.match(/([a-z0-9-]+\.[a-z]{2,})/i)?.[1] ?? null, "hostname");
      data = await tlsLookup(value);
      intent = "RECON / TLS INSPECTION";
      sources = ["Node TLS inspector"];
      evidence = [JSON.stringify(data).slice(0, 800)];
      summary = `Inspected the TLS certificate and negotiated protocol for ${value}.`;
      steps = ["Validate hostname", "Open a server-side TLS connection", "Return certificate chain metadata"];
    } else if (normalized.includes("scan") || normalized.includes("port")) {
      const value = validateQuery(command.match(/(?:scan|port)\s+(?:target|host)?\s*([a-z0-9.:-]+)$/i)?.[1] ?? command.match(/([a-z0-9-]+\.[a-z]{2,}|(?:\d{1,3}\.){3}\d{1,3})/i)?.[1] ?? null, "scan target");
      data = await scannerLookup(value);
      intent = "RECON / ACTIVE SCAN";
      sources = [process.env.SCANNER_URL ?? "scanner backend"];
      evidence = [JSON.stringify(data).slice(0, 800)];
      summary = `Submitted an active scan for ${value} to the configured scanner backend.`;
      steps = ["Validate target", "Submit to configured scanner boundary", "Return scan evidence for operator review"];
    } else if (normalized.includes("sanction") || normalized.includes("sdn")) {
      const query = command.replace(/.*?(?:sanction|sdn)\s*(?:search|lookup|for)?\s*/i, "").trim();
      const value = validateQuery(query || null, "sanctions query");
      data = await searchSanctions(value);
      intent = "RECON / SANCTIONS SEARCH";
      sources = ["OFAC SDN XML"];
      const count = (data as { count?: number }).count ?? 0;
      evidence = [(data as { matched?: Array<{ name?: string; programs?: string[] }> }).matched?.slice(0, 8).map((item) => `${item.name} · ${(item.programs ?? []).join(", ")}`).join("\n") ?? "No matches"];
      summary = `${count} OFAC SDN record${count === 1 ? "" : "s"} matched ${value}.`;
      steps = ["Normalize sanctions query", "Fetch official OFAC SDN export", "Filter and return source-linked matches"];
    } else if (normalized.includes("bitcoin") || normalized.includes("ethereum") || normalized.includes("wallet") || normalized.includes("crypto")) {
      const ethereumAddress = command.match(/0x[a-fA-F0-9]{40}/)?.[0];
      const bitcoinAddress = command.match(/(?:bc1|[13])[a-zA-HJ-NP-Z0-9]{25,90}/)?.[0];
      const value = validateQuery(ethereumAddress ?? bitcoinAddress ?? null, "wallet address");
      data = ethereumAddress ? await ethereumLookup(value) : await bitcoinLookup(value);
      intent = ethereumAddress ? "RECON / ETHEREUM TRACE" : "RECON / BITCOIN TRACE";
      sources = [ethereumAddress ? "Blockscout" : "Blockstream Esplora"];
      evidence = [JSON.stringify(data).slice(0, 800)];
      summary = `Completed a public ${ethereumAddress ? "Ethereum" : "Bitcoin"} address inspection for ${value}.`;
      steps = ["Validate wallet address", "Query public chain explorer", "Return address activity for review"];
    } else if (normalized.includes("cve") || normalized.includes("vulnerability")) {
      const query = command.replace(/.*?(?:cve|vulnerability)\s*(?:for|lookup)?\s*/i, "").trim() || "recent vulnerability";
      data = await cveLookup(query);
      intent = "RECON / VULNERABILITY LOOKUP";
      sources = ["NVD 2.0 API"];
      const vulnerabilities = (data as { data?: { vulnerabilities?: Array<{ cve?: { id?: string } }> } }).data?.vulnerabilities ?? [];
      evidence = vulnerabilities.slice(0, 6).map((item) => item.cve?.id ?? "NVD record");
      summary = `Returned ${vulnerabilities.length} NVD records for ${query}.`;
      steps = ["Normalize vulnerability query", "Query NVD 2.0", "Return CVE identifiers and provider payload"];
    } else {
      const snapshot = await getSnapshot();
      const entities = observationsToEntities(snapshot.observations);
      const signals = observationsToSignals(snapshot.observations);
      data = snapshot;
      const highRisk = signals.filter((signal) => signal.risk === "high").slice(0, 8);
      evidence = (highRisk.length ? highRisk : signals).slice(0, 8).map(renderSignal);
      sources = snapshot.snapshots.map((item) => `${item.source.id}:${item.status}`);
      if (normalized.includes("risk") || normalized.includes("triage") || normalized.includes("threat")) {
        intent = "RISK TRIAGE / LIVE";
        summary = `${highRisk.length} high-risk signals are present in the current provider snapshot; ${signals.length} total incoming signals were evaluated.`;
        steps = ["Fetch current source snapshots", "Rank incoming signals by risk", "Return evidence with source status"];
      } else if (normalized.includes("correlate") || normalized.includes("connect") || normalized.includes("link")) {
        intent = "CORRELATION / CROSS-DOMAIN";
        summary = `Fetched ${entities.length} entities across ${snapshot.snapshots.length} providers. Relationship graph can now be computed from these records.`;
        steps = ["Fetch live domain snapshots", "Normalize entities and timestamps", "Prepare cross-domain graph inputs"];
      } else {
        summary = `${signals.length} incoming signals and ${entities.length} geospatial entities were returned from ${snapshot.snapshots.length} providers.`;
      }
    }
  } catch (error) {
    summary = error instanceof Error ? error.message : "Agent task failed";
    evidence = [];
    sources = [];
  }

  const persisted = await saveAgentRun({ prompt: command, intent, summary, steps, evidence });
  return { traceId: persisted.id, intent, summary, steps, evidence, sources, data, storage: persisted.storage };
}

export { saveWatchlist };
