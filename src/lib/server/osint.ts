import tls from "node:tls";
import { fetchJson, ProviderError } from "./fetch-json";
import { searchSanctions } from "./providers";

export async function dnsLookup(hostname: string) {
  const recordTypes = ["A", "AAAA", "MX", "NS", "TXT", "CNAME", "CAA"] as const;
  const responses = await Promise.allSettled(recordTypes.map(async (type) => {
    const url = new URL("https://cloudflare-dns.com/dns-query");
    url.searchParams.set("name", hostname);
    url.searchParams.set("type", type);
    return fetchJson<{ Status: number; AD?: boolean; Answer?: Array<{ name: string; type: number; TTL: number; data: string }> }>(url.toString(), { headers: { accept: "application/dns-json" } });
  }));
  const records = Object.fromEntries(recordTypes.map((type, index) => [type, responses[index]?.status === "fulfilled" ? responses[index].value : null]));
  return {
    hostname,
    source: "Cloudflare 1.1.1.1 DNS over HTTPS",
    endpoint: "https://cloudflare-dns.com/dns-query",
    records,
  };
}

export async function whoisLookup(query: string) {
  const clean = query.replace(/^https?:\/\//, "").split("/")[0];
  const data = await fetchJson<Record<string, unknown>>(`https://rdap.org/domain/${encodeURIComponent(clean)}`);
  return { query: clean, source: "RDAP", data };
}

export async function ipLookup(ip: string) {
  const data = await fetchJson<Record<string, unknown>>(`https://ipwho.is/${encodeURIComponent(ip)}`);
  return { ip, source: "ipwho.is", data };
}

export async function cveLookup(query: string) {
  const data = await fetchJson<Record<string, unknown>>(`https://services.nvd.nist.gov/rest/json/cves/2.0?keywordSearch=${encodeURIComponent(query)}&resultsPerPage=20`);
  return { query, source: "NVD 2.0", data };
}

export async function bitcoinLookup(address: string) {
  const data = await fetchJson<Record<string, unknown>>(`https://blockstream.info/api/address/${encodeURIComponent(address)}`);
  return { address, source: "Blockstream Esplora", data };
}

export async function ethereumLookup(address: string) {
  const data = await fetchJson<Record<string, unknown>>(`https://eth.blockscout.com/api/v2/addresses/${encodeURIComponent(address)}`);
  return { address, source: "Blockscout", data };
}

export async function tlsLookup(hostname: string, port = 443) {
  return await new Promise<{ hostname: string; port: number; source: string; authorized: boolean; protocol?: string; certificate: Record<string, unknown> }>((resolve, reject) => {
    const socket = tls.connect({ host: hostname, port, servername: hostname, rejectUnauthorized: false, timeout: 10_000 }, () => {
      const certificate = socket.getPeerCertificate(true) as tls.PeerCertificate;
      resolve({ hostname, port, source: "Node TLS inspector", authorized: socket.authorized, protocol: socket.getProtocol() ?? undefined, certificate: { subject: certificate.subject, issuer: certificate.issuer, validFrom: certificate.valid_from, validTo: certificate.valid_to, fingerprint256: certificate.fingerprint256, serialNumber: certificate.serialNumber, subjectaltname: certificate.subjectaltname } });
      socket.end();
    });
    socket.once("error", (error) => reject(new ProviderError(error.message, 502, "tls_error")));
    socket.once("timeout", () => { socket.destroy(); reject(new ProviderError("TLS inspector timeout", 504, "timeout")); });
  });
}

export async function scannerLookup(target: string) {
  const scannerUrl = process.env.SCANNER_URL;
  if (!scannerUrl) throw new ProviderError("Scanner backend is not configured. Set SCANNER_URL and SCANNER_KEY to enable active scanning.", 501, "key_required");
  const url = `${scannerUrl.replace(/\/$/, "")}/scan`;
  const data = await fetchJson<unknown>(url, { method: "POST", headers: { "content-type": "application/json", ...(process.env.SCANNER_KEY ? { authorization: `Bearer ${process.env.SCANNER_KEY}` } : {}) }, body: JSON.stringify({ target }) });
  return { target, source: scannerUrl, data };
}

export { searchSanctions };

export function validateQuery(value: string | null, label: string) {
  if (!value?.trim()) throw new ProviderError(`${label} is required`, 400, "invalid_input");
  return value.trim();
}
