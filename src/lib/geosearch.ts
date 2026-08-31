export type GeosearchKind = "country" | "region" | "city" | "address" | "poi";

export type GeosearchResult = {
  id: string;
  label: string;
  detail: string;
  kind: GeosearchKind;
  coordinates: [number, number];
  bounds?: [number, number, number, number];
  source: "photon" | "nominatim";
};

export const geosearchKindLabel: Record<GeosearchKind, string> = {
  country: "COUNTRY",
  region: "REGION",
  city: "CITY",
  address: "ADDRESS",
  poi: "POINT OF INTEREST",
};

export const geosearchZoom: Record<GeosearchKind, number> = {
  country: 4.2,
  region: 6.4,
  city: 11,
  address: 15.5,
  poi: 16.5,
};
