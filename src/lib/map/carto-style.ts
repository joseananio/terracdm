import type { StyleSpecification } from "maplibre-gl";

export function createCartoDarkRasterStyle(apiKey: string): StyleSpecification {
  const key = apiKey.trim();
  if (!key) throw new Error("A CARTO API key is required");

  return {
    version: 8,
    sources: {
      carto: {
        type: "raster",
        tiles: [`https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png?key=${encodeURIComponent(key)}`],
        tileSize: 256,
        maxzoom: 20,
        attribution: "© CARTO, © OpenStreetMap contributors",
      },
    },
    layers: [{ id: "carto-dark", type: "raster", source: "carto" }],
  };
}
