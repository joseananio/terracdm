import type { GraphRelationDefinition, SignalPack } from "./types";
import { readCatalogPath } from "./value.ts";
import type { Entity, GeoPoint } from "../intelligence";

export type PackGraphEntity = Entity;

export type PackGraphRelation = { score: number; distance: number; relation: string };

function coordinates(value: Pick<PackGraphEntity, "location"> | GeoPoint) {
  return "location" in value ? value.location.coordinates : value;
}

export function graphDistanceKm(left: Pick<PackGraphEntity, "location"> | GeoPoint, right: Pick<PackGraphEntity, "location"> | GeoPoint) {
  const leftPoint = coordinates(left);
  const rightPoint = coordinates(right);
  const radians = Math.PI / 180;
  const latitude = (rightPoint.lat - leftPoint.lat) * radians;
  const longitude = (rightPoint.lng - leftPoint.lng) * radians;
  const a = Math.sin(latitude / 2) ** 2 + Math.cos(leftPoint.lat * radians) * Math.cos(rightPoint.lat * radians) * Math.sin(longitude / 2) ** 2;
  return 6_371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function packGraphRelation(root: PackGraphEntity, candidate: PackGraphEntity, getPack: (id: string) => SignalPack | undefined): PackGraphRelation | null {
  const distance = graphDistanceKm(root, candidate);
  const sameSource = root.source.id === candidate.source.id;
  const sameType = root.domain === candidate.domain;
  const relations = getPack(root.domain)?.presentation.graph?.relations;
  if (!relations?.length) return null;
  const matches = relations.filter((relation: GraphRelationDefinition) => {
    if (relation.when.type === "distance-km") return distance < relation.when.lessThan;
    if (relation.when.type === "same-source") return sameSource;
    if (relation.when.type === "same-domain") return root.domain === candidate.domain;
    if (relation.when.type === "same-type") return sameType;
    const left = readCatalogPath(root, relation.when.field);
    const right = readCatalogPath(candidate, relation.when.field);
    return left !== undefined && left !== null && left !== "" && left === right;
  }).sort((left, right) => right.score - left.score);
  if (!matches.length) return null;
  const strongest = matches[0];
  return {
    score: matches.reduce((sum, relation) => sum + relation.score, 0),
    distance,
    relation: strongest.appendDistance ? `${strongest.label} · ${Math.round(distance)} KM` : strongest.label,
  };
}
