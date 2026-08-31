import { compileSignalPack } from "../compiler";
import { validateSignalPacks } from "../validation";
import type { SignalPackManifest } from "../types";

const providerKinds = new Set(["http-json", "geojson", "rss", "csv"]);
const sourceModes = new Set(["live", "cached", "key_required", "unavailable"]);
const permissions = new Set(["read", "confirm", "write"]);
const toolSources = new Set(["builtin", "provider", "custom"]);
const allowedRootKeys = new Set(["domain", "version", "label", "subdomains", "providers", "signals", "presentation", "agents"]);
const allowedProviderKeys = new Set(["id", "label", "sourceId", "sourceMode", "note", "type", "endpoint", "auth", "pollSeconds", "cache", "coverage", "mapping", "domain", "implementation"]);
const allowedPresentationKeys = new Set(["map", "node", "menu", "graph"]);
const allowedMapKeys = new Set(["id", "label", "short", "color", "source", "status", "defaultEnabled", "details"]);

type PlainRecord = Record<string, unknown>;

function isPlainRecord(value: unknown): value is PlainRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function rejectUnknownKeys(record: PlainRecord, allowed: Set<string>, path: string, errors: string[]) {
  for (const key of Object.keys(record)) if (!allowed.has(key)) errors.push(`${path}.${key} is not supported`);
}

function requiredString(record: PlainRecord, key: string, path: string, errors: string[]) {
  if (!isString(record[key]) || !record[key].trim()) errors.push(`${path}.${key} must be a non-empty string`);
}

function arrayAt(record: PlainRecord, key: string, path: string, errors: string[]) {
  if (!Array.isArray(record[key])) errors.push(`${path}.${key} must be an array`);
  return Array.isArray(record[key]) ? record[key] : [];
}

function assertPlainData(value: unknown, path: string, seen: WeakSet<object>, errors: string[]) {
  if (value === null || isString(value) || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) errors.push(`${path} must contain only finite numbers`);
    return;
  }
  if (typeof value !== "object") {
    errors.push(`${path} contains unsupported executable data`);
    return;
  }
  if (seen.has(value)) {
    errors.push(`${path} contains a cyclic reference`);
    return;
  }
  seen.add(value);
  if (Array.isArray(value)) value.forEach((item, index) => assertPlainData(item, `${path}[${index}]`, seen, errors));
  else if (isPlainRecord(value)) Object.entries(value).forEach(([key, item]) => assertPlainData(item, `${path}.${key}`, seen, errors));
  else errors.push(`${path} must contain only plain objects and arrays`);
  seen.delete(value);
}

function validateSubdomains(record: PlainRecord, errors: string[]) {
  const subdomains = arrayAt(record, "subdomains", "pack", errors);
  subdomains.forEach((value, index) => {
    const path = `pack.subdomains[${index}]`;
    if (!isPlainRecord(value)) { errors.push(`${path} must be an object`); return; }
    rejectUnknownKeys(value, new Set(["id", "label"]), path, errors);
    requiredString(value, "id", path, errors);
    requiredString(value, "label", path, errors);
  });
}

function validateProviders(record: PlainRecord, errors: string[]) {
  const providers = arrayAt(record, "providers", "pack", errors);
  providers.forEach((value, index) => {
    const path = `pack.providers[${index}]`;
    if (!isPlainRecord(value)) { errors.push(`${path} must be an object`); return; }
    rejectUnknownKeys(value, allowedProviderKeys, path, errors);
    requiredString(value, "id", path, errors);
    requiredString(value, "label", path, errors);
    if ("domain" in value) errors.push(`${path}.domain is runtime-derived; use the pack domain instead`);
    if ("implementation" in value) errors.push(`${path}.implementation is not supported in config-only packs`);
    if (!isString(value.type) || !providerKinds.has(value.type)) errors.push(`${path}.type must be one of http-json, geojson, rss, or csv`);
    if (value.sourceMode !== undefined && (!isString(value.sourceMode) || !sourceModes.has(value.sourceMode))) errors.push(`${path}.sourceMode is invalid`);
    if (value.auth !== undefined) {
      if (!isPlainRecord(value.auth)) errors.push(`${path}.auth must be an object`);
      else requiredString(value.auth, "env", `${path}.auth`, errors);
    }
  });
}

function validateSignals(record: PlainRecord, errors: string[]) {
  if (record.signals === undefined) return;
  const signals = arrayAt(record, "signals", "pack", errors);
  signals.forEach((value, index) => {
    const path = `pack.signals[${index}]`;
    if (!isPlainRecord(value)) { errors.push(`${path} must be an object`); return; }
    rejectUnknownKeys(value, new Set(["id", "label", "providerId", "subdomainId", "when"]), path, errors);
    requiredString(value, "id", path, errors);
    requiredString(value, "label", path, errors);
    requiredString(value, "providerId", path, errors);
    requiredString(value, "subdomainId", path, errors);
  });
}

function validatePresentation(record: PlainRecord, errors: string[]) {
  if (!isPlainRecord(record.presentation)) { errors.push("pack.presentation must be an object"); return; }
  const presentation = record.presentation;
  rejectUnknownKeys(presentation, allowedPresentationKeys, "pack.presentation", errors);
  if (!isPlainRecord(presentation.map)) { errors.push("pack.presentation.map must be an object"); }
  else {
    rejectUnknownKeys(presentation.map, allowedMapKeys, "pack.presentation.map", errors);
    for (const key of ["id", "label", "short", "color", "source"]) requiredString(presentation.map, key, "pack.presentation.map", errors);
    if (!isString(presentation.map.status) || !sourceModes.has(presentation.map.status)) errors.push("pack.presentation.map.status is invalid");
    const details = Array.isArray(presentation.map.details) ? presentation.map.details : [];
    if (!Array.isArray(presentation.map.details)) errors.push("pack.presentation.map.details must be an array");
    details.forEach((value, index) => {
      const path = `pack.presentation.map.details[${index}]`;
      if (!isPlainRecord(value)) { errors.push(`${path} must be an object`); return; }
      rejectUnknownKeys(value, new Set(["id", "label", "when"]), path, errors);
      requiredString(value, "id", path, errors);
      requiredString(value, "label", path, errors);
    });
  }
  if (presentation.graph !== undefined) {
    if (!isPlainRecord(presentation.graph)) errors.push("pack.presentation.graph must be an object");
    else if ("resolver" in presentation.graph) errors.push("pack.presentation.graph.resolver is not supported in config-only packs");
  }
}

function validateAgents(record: PlainRecord, errors: string[]) {
  if (record.agents === undefined) return;
  if (!isPlainRecord(record.agents)) { errors.push("pack.agents must be an object"); return; }
  const tools = record.agents.tools;
  if (tools === undefined) return;
  if (!Array.isArray(tools)) { errors.push("pack.agents.tools must be an array"); return; }
  tools.forEach((value, index) => {
    const path = `pack.agents.tools[${index}]`;
    if (!isPlainRecord(value)) { errors.push(`${path} must be an object`); return; }
    if ("handler" in value) errors.push(`${path}.handler is not supported in config-only packs`);
    requiredString(value, "id", path, errors);
    requiredString(value, "label", path, errors);
    if (!isString(value.source) || !toolSources.has(value.source)) errors.push(`${path}.source is invalid`);
    if (!isString(value.permission) || !permissions.has(value.permission)) errors.push(`${path}.permission is invalid`);
  });
}

export function validatePackConfig(input: unknown): string[] {
  const errors: string[] = [];
  assertPlainData(input, "pack", new WeakSet<object>(), errors);
  if (!isPlainRecord(input)) return [...errors, "pack must be a plain object"];
  rejectUnknownKeys(input, allowedRootKeys, "pack", errors);
  for (const key of ["domain", "version", "label"]) requiredString(input, key, "pack", errors);
  validateSubdomains(input, errors);
  validateProviders(input, errors);
  validateSignals(input, errors);
  validatePresentation(input, errors);
  validateAgents(input, errors);
  if (!errors.length) {
    const pack = compileSignalPack(input as unknown as SignalPackManifest);
    errors.push(...validateSignalPacks([pack]));
  }
  return [...new Set(errors)];
}

export function assertValidPackConfig(input: unknown): SignalPackManifest {
  const errors = validatePackConfig(input);
  if (errors.length) throw new Error(`Invalid config-only signal pack:\n${errors.join("\n")}`);
  return input as SignalPackManifest;
}
