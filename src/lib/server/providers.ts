import { CanonicalProviderSnapshot, Domain } from "../intelligence";
import type { ProviderRequest } from "../catalog/types";
import { fetchText } from "./fetch-json";
import { defaultCatalogLayerIds, getCatalog } from "../catalog/registry";
import { providerErrorSnapshot, runProvider } from "../catalog/provider-runtime";
import { ingestObservations } from "./observation-repository";

function textTag(block: string, tag: string) {
  const match = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
  return match?.[1]?.replace(/<!\[CDATA\[|\]\]>/g, "").replace(/<[^>]+>/g, "").trim() ?? "";
}

function parseSanctions(xml: string, query?: string) {
  const terms = query?.toLowerCase().split(/\s+/).filter(Boolean) ?? [];
  return (xml.match(/<sdnEntry>[\s\S]*?<\/sdnEntry>/gi) ?? []).map((block, index) => {
    const first = textTag(block, "firstName");
    const last = textTag(block, "lastName");
    const name = [first, last].filter(Boolean).join(" ") || textTag(block, "uid") || `OFAC SDN ${index + 1}`;
    const programs = [...block.matchAll(/<program[^>]*>([\s\S]*?)<\/program>/gi)].map((match) => match[1].replace(/<[^>]+>/g, "").trim()).filter(Boolean);
    return { id: textTag(block, "uid") || `ofac:${index}`, name, type: textTag(block, "sdnType") || "unknown", programs, remarks: textTag(block, "remarks") };
  }).filter((item) => !terms.length || terms.every((term) => `${item.name} ${item.type} ${item.programs.join(" ")} ${item.remarks}`.toLowerCase().includes(term)));
}

export async function searchSanctions(query: string) {
  const xml = await fetchText("https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/SDN.XML", { headers: { accept: "application/xml,text/xml,*/*" } });
  const matched = parseSanctions(xml, query).slice(0, 100);
  return { query, source: "OFAC SDN XML", sourceUrl: "https://ofac.treasury.gov/sanctions-list-service", fetchedAt: new Date().toISOString(), matched, count: matched.length };
}

export async function getSnapshot(requested?: Domain[], request: ProviderRequest = {}): Promise<{ snapshots: CanonicalProviderSnapshot[]; observations: NonNullable<CanonicalProviderSnapshot["observations"]> }> {
  const requestedDomains = requested ?? defaultCatalogLayerIds();
  const jobs: Promise<CanonicalProviderSnapshot>[] = requestedDomains.flatMap((domain) => {
    const pack = getCatalog().getPack(domain);
    return (pack?.providers ?? []).map((provider) => runProvider(provider, request).catch((error) => providerErrorSnapshot(provider, error)));
  });
  const snapshots = await Promise.all(jobs);
  const observations = snapshots.flatMap((item) => item.observations);
  ingestObservations(observations);
  return { snapshots, observations };
}
