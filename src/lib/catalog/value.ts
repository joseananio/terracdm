import type { CatalogPath, CatalogPredicate, CatalogScalar, CatalogValue } from "./types";

export function readCatalogPath(input: unknown, path: CatalogPath): unknown {
  if (!path) return input;
  const normalized = path.replace(/^\$\.?/, "").replace(/\[(['"]?)([^\]'"]+)\1\]/g, ".$2");
  return normalized.split(".").filter(Boolean).reduce<unknown>((current, part) => {
    if (current && typeof current === "object" && part in current) return (current as Record<string, unknown>)[part];
    return undefined;
  }, input);
}
function scalar(value: unknown): CatalogScalar {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean" || value === null) return value;
  if (value === undefined) return null;
  return String(value);
}

export function resolveCatalogValue(input: unknown, value: CatalogValue): CatalogScalar {
  if (value && typeof value === "object") {
    if ("path" in value) return scalar(readCatalogPath(input, value.path));
    if ("template" in value) {
      return value.template.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_match, path: string) => String(scalar(readCatalogPath(input, path.trim())) ?? ""));
    }
  }
  return scalar(value);
}

export function matchesCatalogPredicate(input: unknown, predicate: CatalogPredicate | undefined): boolean {
  if (!predicate) return true;
  if ("all" in predicate) return predicate.all.every((item) => matchesCatalogPredicate(input, item));
  if ("any" in predicate) return predicate.any.some((item) => matchesCatalogPredicate(input, item));
  if ("not" in predicate) return !matchesCatalogPredicate(input, predicate.not);
  const value = readCatalogPath(input, predicate.field);
  if ("equals" in predicate) return value === predicate.equals;
  if ("notEquals" in predicate) return value !== predicate.notEquals;
  if ("in" in predicate) return predicate.in.includes(value as CatalogScalar);
  if ("exists" in predicate) return (value !== undefined && value !== null) === predicate.exists;
  if ("gte" in predicate) return Number(value) >= predicate.gte;
  if ("lte" in predicate) return Number(value) <= predicate.lte;
  return false;
}

export function formatCatalogValue(value: unknown, format: "text" | "number" | "date" | "boolean" = "text") {
  if (value === undefined || value === null || value === "") return "—";
  if (format === "number") return Number.isFinite(Number(value)) ? String(value) : "—";
  if (format === "boolean") return value ? "YES" : "NO";
  if (format === "date") {
    const date = new Date(String(value));
    return Number.isNaN(date.getTime()) ? String(value) : date.toISOString().slice(0, 19).replace("T", " ") + "Z";
  }
  return String(value);
}
