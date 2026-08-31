export type DeterministicActionId = "dns" | "rdap" | "ip" | "tls" | "cve" | "crypto" | "sanctions" | "scan";

export type DeterministicAction = {
  id: DeterministicActionId;
  label: string;
  detail: string;
  inputLabel: string;
  placeholder: string;
  defaultValue: string;
  method: "GET" | "POST";
  path: string;
  queryParam?: string;
};

export const deterministicActions: DeterministicAction[] = [
  { id: "dns", label: "DNS", detail: "Cloudflare DoH · A · AAAA · MX", inputLabel: "HOSTNAME", placeholder: "Enter hostname", defaultValue: "", method: "GET", path: "/api/osint/dns", queryParam: "q" },
  { id: "rdap", label: "RDAP", detail: "registration record", inputLabel: "DOMAIN", placeholder: "Enter domain", defaultValue: "", method: "GET", path: "/api/osint/whois", queryParam: "q" },
  { id: "ip", label: "IP INTEL", detail: "ASN · geolocation", inputLabel: "IP ADDRESS", placeholder: "Enter IP address", defaultValue: "", method: "GET", path: "/api/osint/ip", queryParam: "q" },
  { id: "tls", label: "TLS", detail: "certificate inspection", inputLabel: "HOSTNAME", placeholder: "Enter hostname", defaultValue: "", method: "GET", path: "/api/osint/tls", queryParam: "q" },
  { id: "cve", label: "CVE", detail: "NVD 2.0 search", inputLabel: "QUERY", placeholder: "Enter search query", defaultValue: "", method: "GET", path: "/api/osint/cve", queryParam: "q" },
  { id: "crypto", label: "CRYPTO", detail: "public chain trace", inputLabel: "BITCOIN ADDRESS", placeholder: "Enter Bitcoin address", defaultValue: "", method: "GET", path: "/api/osint/crypto", queryParam: "address" },
  { id: "sanctions", label: "SANCTIONS", detail: "official OFAC SDN search", inputLabel: "NAME / IDENTIFIER", placeholder: "Enter name or identifier", defaultValue: "", method: "GET", path: "/api/osint/sanctions", queryParam: "q" },
  { id: "scan", label: "SCAN", detail: "configured active scanner", inputLabel: "TARGET", placeholder: "Enter target", defaultValue: "", method: "POST", path: "/api/osint/scanner" },
];

export function getDeterministicAction(id: DeterministicActionId) {
  return deterministicActions.find((action) => action.id === id) ?? deterministicActions[0];
}
