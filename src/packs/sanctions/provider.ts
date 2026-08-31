import type { ProviderSnapshot } from "../../lib/intelligence";
import { fetchText } from "../../lib/server/fetch-json";
import type { ProviderImplementation } from "../../lib/catalog/types";

export const sanctionsProviderImplementation: ProviderImplementation = async ({ pack, provider }) => {
  await fetchText("https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/SDN.XML", { headers: { accept: "application/xml,text/xml,*/*" } });
  const snapshot: ProviderSnapshot = {
    domain: pack.domain,
    providerId: provider.id,
    source: { id: provider.sourceId ?? provider.id, name: provider.label },
    status: "live",
    fetchedAt: new Date().toISOString(),
    observations: [],
    nextPollSeconds: provider.pollSeconds ?? 300,
  };
  return snapshot;
};
