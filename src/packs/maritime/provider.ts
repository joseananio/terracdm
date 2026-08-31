import { riskFromScore, type Entity, type ProviderSnapshot, type Signal } from "../../lib/intelligence";
import { locationText } from "../../lib/server/fetch-json";
import type { ProviderImplementation } from "../../lib/catalog/types";

type MaritimeKind = "port" | "chokepoint" | "energy" | "naval";
type MaritimeTuple = readonly [string, string, number, number, MaritimeKind];
const maritimeCatalog: MaritimeTuple[] = [
  ["rotterdam", "Port of Rotterdam", 51.95, 4.14, "port"], ["singapore", "Port of Singapore", 1.26, 103.84, "port"], ["shanghai", "Port of Shanghai", 31.23, 121.49, "port"], ["ningbo", "Port of Ningbo-Zhoushan", 29.87, 121.55, "port"], ["shenzhen", "Port of Shenzhen", 22.54, 114.11, "port"], ["guangzhou", "Port of Guangzhou", 22.68, 113.65, "port"], ["xiamen", "Port of Xiamen", 24.48, 118.07, "port"], ["qingdao", "Port of Qingdao", 36.07, 120.31, "port"], ["busan", "Port of Busan", 35.10, 129.04, "port"], ["hong-kong", "Port of Hong Kong", 22.29, 114.16, "port"], ["tokyo", "Port of Tokyo", 35.62, 139.78, "port"], ["yokohama", "Port of Yokohama", 35.45, 139.65, "port"], ["los-angeles", "Port of Los Angeles", 33.74, -118.27, "port"], ["long-beach", "Port of Long Beach", 33.75, -118.22, "port"], ["new-york", "Port of New York", 40.67, -74.04, "port"], ["savannah", "Port of Savannah", 32.08, -81.09, "port"], ["houston", "Port of Houston", 29.73, -95.27, "port"], ["vancouver", "Port of Vancouver", 49.29, -123.11, "port"], ["antwerp", "Port of Antwerp", 51.27, 4.40, "port"], ["hamburg", "Port of Hamburg", 53.54, 9.97, "port"], ["felixstowe", "Port of Felixstowe", 51.96, 1.31, "port"], ["tanger-med", "Tanger Med", 35.88, -5.50, "port"], ["algeciras", "Port of Algeciras", 36.13, -5.44, "port"], ["piraeus", "Port of Piraeus", 37.94, 23.63, "port"], ["istanbul", "Port of Istanbul", 41.02, 28.97, "port"], ["jebel-ali", "Jebel Ali Port", 25.01, 55.06, "port"], ["port-klang", "Port Klang", 3.00, 101.39, "port"], ["salalah", "Port of Salalah", 16.95, 54.00, "port"], ["mumbai", "Port of Mumbai", 18.94, 72.84, "port"], ["visakhapatnam", "Visakhapatnam Port", 17.69, 83.29, "port"], ["colombo", "Port of Colombo", 6.95, 79.84, "port"], ["chittagong", "Port of Chattogram", 22.31, 91.80, "port"], ["laem-chabang", "Laem Chabang Port", 13.08, 100.88, "port"], ["melbourne", "Port of Melbourne", -37.84, 144.93, "port"], ["sydney", "Port Botany", -33.95, 151.20, "port"], ["santos", "Port of Santos", -23.95, -46.33, "port"], ["cape-town", "Port of Cape Town", -33.91, 18.43, "port"], ["durban", "Port of Durban", -29.87, 31.05, "port"], ["mombasa", "Port of Mombasa", -4.04, 39.67, "port"], ["dar-es-salaam", "Port of Dar es Salaam", -6.82, 39.29, "port"], ["ras-tanura", "Ras Tanura", 26.64, 50.16, "energy"], ["fujairah", "Port of Fujairah", 25.13, 56.36, "energy"], ["novorossiysk", "Port of Novorossiysk", 44.72, 37.77, "energy"], ["norfolk", "Norfolk Naval Station", 36.95, -76.33, "naval"], ["san-diego-naval", "San Diego Naval Base", 32.68, -117.13, "naval"], ["yokosuka-naval", "Yokosuka Naval Base", 35.29, 139.67, "naval"], ["visakhapatnam-naval", "Visakhapatnam Naval Base", 17.69, 83.29, "naval"], ["suez", "Suez Canal", 30.46, 32.35, "chokepoint"], ["hormuz", "Strait of Hormuz", 26.57, 56.25, "chokepoint"], ["malacca", "Strait of Malacca", 2.50, 101.80, "chokepoint"], ["bab-el-mandeb", "Bab el-Mandeb", 12.58, 43.33, "chokepoint"], ["gibraltar", "Strait of Gibraltar", 35.98, -5.60, "chokepoint"], ["panama", "Panama Canal", 9.08, -79.68, "chokepoint"], ["bosporus", "Bosphorus", 41.12, 29.08, "chokepoint"], ["baltic-entrance", "Danish Straits", 55.60, 12.70, "chokepoint"], ["dover", "Dover Strait", 51.00, 1.50, "chokepoint"], ["taiwan", "Taiwan Strait", 24.40, 119.80, "chokepoint"], ["lombok", "Lombok Strait", -8.45, 115.75, "chokepoint"], ["mozambique", "Mozambique Channel", -17.50, 42.00, "chokepoint"],
];
const maritimeCatalogSource = `${maritimeCatalog.filter(([, , , , kind]) => kind !== "chokepoint").length} locations / ${maritimeCatalog.filter(([, , , , kind]) => kind === "chokepoint").length} chokepoints`;
const maritimeKindLabel = (kind: MaritimeKind) => kind === "chokepoint" ? "Strategic chokepoint" : kind === "energy" ? "Energy port" : kind === "naval" ? "Naval base" : "Strategic port";
function staticMaritime(domain: string): Entity[] {
  return maritimeCatalog.map(([id, name, lat, lng, kind]) => {
  const riskScore = kind === "chokepoint" ? 58 : kind === "naval" ? 44 : kind === "energy" ? 38 : 25;
    return { id: `${domain}:${id}`, kind: "entity", domain, subdomainId: kind, name: String(name), description: `${maritimeKindLabel(kind)} baseline`, risk: riskFromScore(riskScore), riskScore, location: { coordinates: { lat, lng }, label: String(name) }, source: { id: "static-maritime", name: "Maritime baseline" }, providerId: "static-maritime", observedAt: new Date().toISOString(), properties: { kind, dataStatus: "baseline" } };
  });
}

function baselineSignals(domain: string, locations: Entity[], fetchedAt: string): Signal[] {
  return locations
    .filter((location) => location.properties?.kind === "chokepoint")
    .map((location) => ({
      id: `${location.id}:signal`,
      kind: "signal",
      domain,
      subdomainId: location.subdomainId,
      name: location.name,
      description: location.description,
      risk: location.risk,
      riskScore: location.riskScore,
      location: { ...location.location, label: locationText(location.location.coordinates.lat, location.location.coordinates.lng) },
      source: { id: "static-maritime", name: "Maritime baseline" },
      providerId: "static-maritime",
      observedAt: fetchedAt,
      properties: { baseline: true },
    }));
}

export const maritimeProviderImplementation: ProviderImplementation = async ({ pack, provider }): Promise<ProviderSnapshot> => {
  const fetchedAt = new Date().toISOString();
  const locations = staticMaritime(pack.domain);
  return {
    domain: pack.domain,
    providerId: "static-maritime",
    source: { id: "static-maritime", name: `Static maritime baseline · ${maritimeCatalogSource}` },
    status: "cached",
    fetchedAt,
    observations: [...locations, ...baselineSignals(pack.domain, locations, fetchedAt)],
    nextPollSeconds: provider.pollSeconds ?? 300,
  };
};
