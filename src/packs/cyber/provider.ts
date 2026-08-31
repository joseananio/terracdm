import { riskFromScore, type ProviderSnapshot, type Signal, type SourceStatus } from "../../lib/intelligence";
import { fetchJson, isoTime, ProviderError } from "../../lib/server/fetch-json";
import type { ProviderImplementation } from "../../lib/catalog/types";

type NvdVulnerability = { cve?: { id?: string; descriptions?: Array<{ value?: string }>; published?: string; metrics?: Record<string, unknown> } };
type CisaKev = { cveID?: string; vulnerabilityName?: string; vendorProject?: string; product?: string; shortDescription?: string; dateAdded?: string; dueDate?: string; knownRansomwareCampaignUse?: string };
type FeodoEntry = { ip_address?: string; dst_port?: number | string; malware?: string; status?: string; first_seen?: string; last_online?: string; country?: string };
type UrlhausRecord = { url_id?: string | number; url?: string; url_status?: string; date_added?: string; dateadded?: string; threat?: string; tags?: string[] };
type ThreatFoxRecord = { id?: string | number; ioc?: string; ioc_type?: string; threat_type?: string; malware_printable?: string; malware?: string; confidence_level?: number; first_seen?: string; reference?: string | null };
type ThreatFoxResponse = { query_status?: string; data?: ThreatFoxRecord[] };
type CyberFeed = { source: string; sourceId: string; signals: Signal[] };
type CyberOutputContext = { domain: string; subdomainId: string };

function cvssScore(metrics: Record<string, unknown> | undefined) {
  const groups = ["cvssMetricV40", "cvssMetricV31", "cvssMetricV30", "cvssMetricV2"];
  for (const group of groups) {
    const value = metrics?.[group];
    if (!Array.isArray(value)) continue;
    const score = Number((value[0] as { cvssData?: { baseScore?: number } })?.cvssData?.baseScore);
    if (Number.isFinite(score)) return score;
  }
  return 0;
}

function cyberSignal(context: CyberOutputContext, input: { id: string; observedAt: string; name: string; description: string; riskScore: number; location: string; sourceId: string; source: string; url?: string; properties?: Signal["properties"] }): Signal {
  return { id: input.id, kind: "signal", domain: context.domain, subdomainId: context.subdomainId, name: input.name, description: input.description, risk: riskFromScore(input.riskScore), riskScore: input.riskScore, location: { label: input.location }, source: { id: input.sourceId, name: input.source, url: input.url }, providerId: input.sourceId, observedAt: input.observedAt, url: input.url, properties: input.properties };
}

async function getNvdCyber(context: CyberOutputContext): Promise<CyberFeed> {
  const start = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const headers = process.env.NVD_API_KEY ? { apiKey: process.env.NVD_API_KEY } : undefined;
  const data = await fetchJson<{ vulnerabilities?: NvdVulnerability[] }>(`https://services.nvd.nist.gov/rest/json/cves/2.0?lastModStartDate=${encodeURIComponent(start)}&lastModEndDate=${encodeURIComponent(new Date().toISOString())}&resultsPerPage=30`, { headers });
  const signals = (data.vulnerabilities ?? []).slice(0, 30).flatMap((item) => {
    const id = item.cve?.id;
    if (!id) return [];
    const score = cvssScore(item.cve?.metrics);
    return [cyberSignal(context, { id: `nvd:${id}`, observedAt: isoTime(item.cve?.published), name: id, description: String(item.cve?.descriptions?.[0]?.value ?? "NVD vulnerability record").slice(0, 180), riskScore: score * 10, location: "Global", source: "NVD", sourceId: "nvd", url: `https://nvd.nist.gov/vuln/detail/${id}`, properties: { cvss: score } })];
  });
  return { source: "NVD", sourceId: "nvd", signals };
}

async function getCisaKevCyber(context: CyberOutputContext): Promise<CyberFeed> {
  const data = await fetchJson<{ vulnerabilities?: CisaKev[] }>("https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json");
  const signals = (data.vulnerabilities ?? []).slice().sort((left, right) => String(right.dateAdded ?? "").localeCompare(String(left.dateAdded ?? ""))).slice(0, 30).flatMap((item) => {
    const id = item.cveID;
    if (!id) return [];
    const ransomware = item.knownRansomwareCampaignUse === "Known";
    return [cyberSignal(context, { id: `cisa-kev:${id}`, observedAt: isoTime(item.dateAdded), name: id, description: `${item.vendorProject ?? "Unknown vendor"} ${item.product ?? ""} · ${item.vulnerabilityName ?? item.shortDescription ?? "Known exploited vulnerability"}`.trim().slice(0, 180), riskScore: 85, location: "Global", source: "CISA KEV", sourceId: "cisa-kev", url: `https://www.cisa.gov/known-exploited-vulnerabilities-catalog?search_api_fulltext=${encodeURIComponent(id)}`, properties: { knownExploited: true, ransomwareKnown: ransomware, dueDate: item.dueDate ?? null } })];
  });
  return { source: "CISA KEV", sourceId: "cisa-kev", signals };
}

async function getFeodoCyber(context: CyberOutputContext): Promise<CyberFeed> {
  const data = await fetchJson<FeodoEntry[]>("https://feodotracker.abuse.ch/downloads/ipblocklist.json");
  const signals = data.slice(0, 30).flatMap((item, index) => {
    const ip = item.ip_address?.trim();
    if (!ip) return [];
    const port = String(item.dst_port ?? "").trim();
    const malware = item.malware?.trim() || "Unknown malware";
    return [cyberSignal(context, { id: `feodo:${ip}:${port || index}`, observedAt: isoTime(item.last_online ?? item.first_seen), name: `${malware} C2`, description: `Botnet command-and-control infrastructure · ${ip}${port ? `:${port}` : ""}`, location: item.country ? `Country ${item.country}` : "Network infrastructure", riskScore: item.status?.toLowerCase() === "online" ? 80 : 50, source: "Feodo Tracker", sourceId: "feodo", url: "https://feodotracker.abuse.ch/blocklist/", properties: { indicator: ip, port: port || null, malware, status: item.status ?? null, country: item.country ?? null } })];
  });
  return { source: "Feodo Tracker", sourceId: "feodo", signals };
}

function requireAbuseChKey() {
  const key = process.env.ABUSE_CH_AUTH_KEY?.trim();
  if (!key) throw new ProviderError("configure ABUSE_CH_AUTH_KEY", 401, "key_required");
  return key;
}

async function getUrlhausCyber(context: CyberOutputContext): Promise<CyberFeed> {
  const key = requireAbuseChKey();
  const data = await fetchJson<UrlhausRecord[] | { urls?: UrlhausRecord[] }>(`https://urlhaus-api.abuse.ch/v2/files/exports/${encodeURIComponent(key)}/recent.json`);
  const records = Array.isArray(data) ? data : data.urls ?? [];
  const signals = records.slice(0, 30).flatMap((item, index) => {
    const indicator = item.url?.trim();
    if (!indicator) return [];
    const id = String(item.url_id ?? index);
    return [cyberSignal(context, { id: `urlhaus:${id}`, observedAt: isoTime(item.date_added ?? item.dateadded), name: "Malware delivery URL", description: `${item.threat ?? "Malware distribution"} · ${indicator}`.slice(0, 180), location: "Network infrastructure", riskScore: item.url_status?.toLowerCase() === "online" ? 80 : 50, source: "URLhaus", sourceId: "urlhaus", url: "https://urlhaus.abuse.ch/", properties: { indicator, status: item.url_status ?? null, threat: item.threat ?? null, tags: item.tags?.slice(0, 5).join(", ") ?? null } })];
  });
  return { source: "URLhaus", sourceId: "urlhaus", signals };
}

async function getThreatFoxCyber(context: CyberOutputContext): Promise<CyberFeed> {
  const key = requireAbuseChKey();
  const data = await fetchJson<ThreatFoxResponse>("https://threatfox-api.abuse.ch/api/v1/", { method: "POST", headers: { "Auth-Key": key, "content-type": "application/json" }, body: JSON.stringify({ query: "get_iocs", days: 1 }) });
  if (data.query_status !== "ok") throw new ProviderError(`ThreatFox ${data.query_status ?? "request failed"}`);
  const signals = (data.data ?? []).slice(0, 30).flatMap((item, index) => {
    const indicator = item.ioc?.trim();
    if (!indicator) return [];
    const id = String(item.id ?? index);
    const malware = item.malware_printable ?? item.malware ?? "Unknown malware";
    return [cyberSignal(context, { id: `threatfox:${id}`, observedAt: isoTime(item.first_seen), name: `${malware} IOC`, description: `${item.threat_type ?? "threat indicator"} · ${indicator}`.slice(0, 180), location: "Network infrastructure", riskScore: Number(item.confidence_level ?? 0) >= 75 ? 80 : 50, source: "ThreatFox", sourceId: "threatfox", url: item.reference ?? "https://threatfox.abuse.ch/", properties: { indicator, iocType: item.ioc_type ?? null, threatType: item.threat_type ?? null, confidence: Number(item.confidence_level ?? 0) } })];
  });
  return { source: "ThreatFox", sourceId: "threatfox", signals };
}

const CYBER_CACHE_TTL_MS = 2 * 60 * 1_000;
let cyberCache: { snapshot: ProviderSnapshot; expiresAt: number } | null = null;
let cyberFetchPromise: Promise<ProviderSnapshot> | null = null;

async function loadCyber(context: CyberOutputContext, provider: { sourceId?: string; id: string; label: string }): Promise<ProviderSnapshot> {
  const feeds = [getNvdCyber, getCisaKevCyber, getFeodoCyber, getUrlhausCyber, getThreatFoxCyber];
  const results = await Promise.allSettled(feeds.map((load) => load(context)));
  const successful = results.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
  const errors = results.flatMap((result, index) => result.status === "rejected" ? [`${["NVD", "CISA KEV", "Feodo Tracker", "URLhaus", "ThreatFox"][index]}: ${result.reason instanceof Error ? result.reason.message : "request failed"}`] : []);
  const signals = successful.flatMap((feed) => feed.signals);
  const status: SourceStatus = signals.length ? "live" : "degraded";
  return { domain: context.domain, providerId: provider.id, source: { id: provider.sourceId ?? provider.id, name: provider.label }, status, fetchedAt: new Date().toISOString(), observations: signals, error: errors.length ? errors.join("; ") : undefined, nextPollSeconds: 120 };
}

export const cyberProviderImplementation: ProviderImplementation = async ({ pack, provider }) => {
  const context = { domain: pack.domain, subdomainId: pack.signals?.find((signal) => signal.providerId === provider.id)?.subdomainId ?? pack.subdomains[0]?.id ?? "" };
  if (cyberCache && cyberCache.expiresAt > Date.now()) return { ...cyberCache.snapshot, status: "cached" };
  if (!cyberFetchPromise) {
    cyberFetchPromise = loadCyber(context, provider).then((result) => {
      if (result.observations.length > 0) cyberCache = { snapshot: result, expiresAt: Date.now() + CYBER_CACHE_TTL_MS };
      if (!result.observations.length && cyberCache) return { ...cyberCache.snapshot, status: "degraded" as const, error: ["Cyber sources unavailable; serving the last successful snapshot", result.error].filter(Boolean).join("; ") };
      return result;
    }).finally(() => { cyberFetchPromise = null; });
  }
  return cyberFetchPromise;
};
