import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { parseYamlPackConfig } from "../catalog/config/parse-yaml";
import { loadPackManifestFileSync } from "../catalog/config/load-pack";
import type { CatalogSourceMode, ProviderAuth, ProviderCachePolicy, ProviderCoverage, SignalPack } from "../catalog/types";
import type { SignalPackManifest } from "../catalog/types";

export type InstanceProviderOverride = {
  enabled?: boolean;
  endpoint?: string;
  sourceMode?: CatalogSourceMode;
  note?: string;
  auth?: ProviderAuth;
  pollSeconds?: number;
  cache?: ProviderCachePolicy;
  coverage?: ProviderCoverage;
};

export type InstancePackEntry = {
  enabled?: boolean;
  source?: string;
  providers?: Record<string, InstanceProviderOverride>;
};

export type InstanceConfig = {
  version: 1;
  packs: {
    defaults: "enabled" | "disabled";
    entries: Record<string, InstancePackEntry>;
  };
};

export type LoadedInstanceConfig = {
  config: InstanceConfig;
  path: string;
};

const DEFAULT_INSTANCE_CONFIG = "terracdm.yaml";
const sourceModes = new Set<CatalogSourceMode>(["live", "cached", "key_required", "unavailable"]);
const coverages = new Set<ProviderCoverage>(["global", "viewport"]);
const rootKeys = new Set(["version", "packs"]);
const packKeys = new Set(["defaults", "entries"]);
const entryKeys = new Set(["enabled", "source", "providers"]);
const providerKeys = new Set(["enabled", "endpoint", "sourceMode", "note", "auth", "pollSeconds", "cache", "coverage"]);
const authKeys = new Set(["env", "header", "query"]);
const cacheKeys = new Set(["maxAgeSeconds", "staleIfErrorSeconds"]);

type PlainRecord = Record<string, unknown>;

function isPlainRecord(value: unknown): value is PlainRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && Boolean(value.trim());
}

function rejectUnknownKeys(record: PlainRecord, allowed: Set<string>, path: string, errors: string[]) {
  for (const key of Object.keys(record)) if (!allowed.has(key)) errors.push(`${path}.${key} is not supported`);
}

function finiteNumber(value: unknown, path: string, errors: string[], minimum = 0) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum) errors.push(`${path} must be a finite number >= ${minimum}`);
}

function validateAuth(value: unknown, path: string, errors: string[]) {
  if (!isPlainRecord(value)) {
    errors.push(`${path} must be an object`);
    return;
  }
  rejectUnknownKeys(value, authKeys, path, errors);
  if (!isNonEmptyString(value.env)) errors.push(`${path}.env must be a non-empty environment variable name`);
  for (const key of ["header", "query"]) if (value[key] !== undefined && !isNonEmptyString(value[key])) errors.push(`${path}.${key} must be a non-empty string`);
}

function validateCache(value: unknown, path: string, errors: string[]) {
  if (!isPlainRecord(value)) {
    errors.push(`${path} must be an object`);
    return;
  }
  rejectUnknownKeys(value, cacheKeys, path, errors);
  finiteNumber(value.maxAgeSeconds, `${path}.maxAgeSeconds`, errors, 1);
  if (value.staleIfErrorSeconds !== undefined) finiteNumber(value.staleIfErrorSeconds, `${path}.staleIfErrorSeconds`, errors);
}

function validateProviderOverride(value: unknown, path: string, errors: string[]) {
  if (!isPlainRecord(value)) {
    errors.push(`${path} must be an object`);
    return;
  }
  rejectUnknownKeys(value, providerKeys, path, errors);
  if (value.enabled !== undefined && typeof value.enabled !== "boolean") errors.push(`${path}.enabled must be a boolean`);
  if (value.endpoint !== undefined) {
    if (!isNonEmptyString(value.endpoint)) errors.push(`${path}.endpoint must be a non-empty URL`);
    else {
      try { new URL(value.endpoint); } catch { errors.push(`${path}.endpoint must be a valid URL`); }
    }
  }
  if (value.sourceMode !== undefined && (!isNonEmptyString(value.sourceMode) || !sourceModes.has(value.sourceMode as CatalogSourceMode))) errors.push(`${path}.sourceMode is invalid`);
  if (value.note !== undefined && typeof value.note !== "string") errors.push(`${path}.note must be a string`);
  if (value.auth !== undefined) validateAuth(value.auth, `${path}.auth`, errors);
  if (value.pollSeconds !== undefined) finiteNumber(value.pollSeconds, `${path}.pollSeconds`, errors, 1);
  if (value.cache !== undefined) validateCache(value.cache, `${path}.cache`, errors);
  if (value.coverage !== undefined && (!isNonEmptyString(value.coverage) || !coverages.has(value.coverage as ProviderCoverage))) errors.push(`${path}.coverage is invalid`);
}

function validateEntry(value: unknown, path: string, errors: string[]) {
  if (!isPlainRecord(value)) {
    errors.push(`${path} must be an object`);
    return;
  }
  rejectUnknownKeys(value, entryKeys, path, errors);
  if (value.enabled !== undefined && typeof value.enabled !== "boolean") errors.push(`${path}.enabled must be a boolean`);
  if (value.source !== undefined && !isNonEmptyString(value.source)) errors.push(`${path}.source must be a non-empty path`);
  if (value.providers !== undefined) {
    if (!isPlainRecord(value.providers)) errors.push(`${path}.providers must be an object keyed by provider id`);
    else for (const [providerId, override] of Object.entries(value.providers)) validateProviderOverride(override, `${path}.providers.${providerId}`, errors);
  }
}

export function validateInstanceConfig(input: unknown): string[] {
  const errors: string[] = [];
  if (!isPlainRecord(input)) return ["instance config must be a plain object"];
  rejectUnknownKeys(input, rootKeys, "config", errors);
  if (input.version !== 1) errors.push("config.version must be 1");
  if (!isPlainRecord(input.packs)) {
    errors.push("config.packs must be an object");
    return errors;
  }
  rejectUnknownKeys(input.packs, packKeys, "config.packs", errors);
  if (input.packs.defaults !== undefined && input.packs.defaults !== "enabled" && input.packs.defaults !== "disabled") errors.push("config.packs.defaults must be enabled or disabled");
  if (input.packs.entries !== undefined && !isPlainRecord(input.packs.entries)) {
    errors.push("config.packs.entries must be an object keyed by pack domain");
  } else if (isPlainRecord(input.packs.entries)) {
    for (const [domain, entry] of Object.entries(input.packs.entries)) {
      if (!isNonEmptyString(domain)) errors.push("config.packs.entries contains an empty pack domain");
      validateEntry(entry, `config.packs.entries.${domain}`, errors);
    }
  }
  return [...new Set(errors)];
}

export function assertValidInstanceConfig(input: unknown): InstanceConfig {
  const errors = validateInstanceConfig(input);
  if (errors.length) throw new Error(`Invalid terracdm instance configuration:\n${errors.join("\n")}`);
  const value = input as { version: 1; packs?: { defaults?: "enabled" | "disabled"; entries?: Record<string, InstancePackEntry> } };
  return {
    version: 1,
    packs: {
      defaults: value.packs?.defaults ?? "enabled",
      entries: value.packs?.entries ?? {},
    },
  };
}

export function instanceConfigPath() {
  const configured = process.env.TERRACDM_CONFIG?.trim();
  return resolve(/* turbopackIgnore: true */ process.cwd(), configured || DEFAULT_INSTANCE_CONFIG);
}

export function loadInstanceConfigFile(path: string): LoadedInstanceConfig {
  // Instance config paths are deliberately runtime-configurable through
  // TERRACDM_CONFIG. Prevent Turbopack from treating that dynamic path as a
  // request to trace the entire repository into every provider route bundle.
  const resolvedPath = isAbsolute(path) ? path : resolve(/* turbopackIgnore: true */ process.cwd(), path);
  let text: string;
  try {
    text = readFileSync(resolvedPath, "utf8");
  } catch (error) {
    throw new Error(`Unable to read TerraCDM instance configuration at ${resolvedPath}: ${error instanceof Error ? error.message : "read failed"}`);
  }
  let parsed: unknown;
  try {
    parsed = parseYamlPackConfig(text);
  } catch (error) {
    throw new Error(`Invalid TerraCDM instance configuration at ${resolvedPath}: ${error instanceof Error ? error.message : "parse failed"}`);
  }
  return { config: assertValidInstanceConfig(parsed), path: resolvedPath };
}

export function applyInstanceProviderOverrides(pack: SignalPack, overrides: Record<string, InstanceProviderOverride> | undefined) {
  if (!overrides) return pack;
  const providerIds = new Set(pack.providers.map((provider) => provider.id));
  const unknown = Object.keys(overrides).filter((providerId) => !providerIds.has(providerId));
  if (unknown.length) throw new Error(`Instance config pack ${pack.domain} references unknown providers: ${unknown.join(", ")}`);
  return {
    ...pack,
    providers: pack.providers.map((provider) => ({ ...provider, ...(overrides[provider.id] ?? {}) })),
  };
}

export function selectInstancePackDomains(packDomains: Iterable<string>, config: InstanceConfig) {
  const domains = new Set<string>();
  const defaultEnabled = config.packs.defaults === "enabled";
  for (const domain of packDomains) {
    const entry = config.packs.entries[domain];
    if (entry?.enabled ?? defaultEnabled) domains.add(domain);
  }
  return domains;
}

export function loadConfigPackManifests(config: InstanceConfig, configDirectory: string) {
  const manifests: SignalPackManifest[] = [];
  for (const [domain, entry] of Object.entries(config.packs.entries)) {
    if (!entry.source) continue;
    const sourcePath = resolve(configDirectory, entry.source);
    const manifest = loadPackManifestFileSync(sourcePath);
    if (manifest.domain !== domain) throw new Error(`Instance config source ${sourcePath} declares domain ${manifest.domain}, expected ${domain}`);
    manifests.push(manifest);
  }
  return manifests;
}

export function assertKnownInstancePackEntries(config: InstanceConfig, knownDomainsInput: Iterable<string>) {
  const knownDomains = new Set(knownDomainsInput);
  const unknown = Object.entries(config.packs.entries)
    .filter(([domain, entry]) => !knownDomains.has(domain) && !entry.source)
    .map(([domain]) => domain);
  if (unknown.length) throw new Error(`Instance config references unknown packs without a source: ${unknown.join(", ")}`);
}

/**
 * Reads the optional instance file without applying it. Assembly owns the
 * ordering: config files are loaded after code-pack registrations and before
 * the final catalog runtime is built.
 */
export function loadOptionalInstanceConfig(path = instanceConfigPath()): LoadedInstanceConfig | undefined {
  if (!existsSync(path)) {
    if (process.env.TERRACDM_CONFIG?.trim()) throw new Error(`TerraCDM instance configuration was requested but not found: ${path}`);
    return undefined;
  }
  return loadInstanceConfigFile(path);
}
