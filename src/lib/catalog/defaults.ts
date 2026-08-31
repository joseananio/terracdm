import type { CatalogLayer } from "./types";

const initiallyDisabledLayerIds = new Set(["aviation", "maritime", "space"]);

export function defaultLayerIds(layers: Pick<CatalogLayer, "id" | "defaultEnabled">[]) {
  return layers
    .filter((layer) => layer.defaultEnabled ?? !initiallyDisabledLayerIds.has(layer.id))
    .map((layer) => layer.id);
}
