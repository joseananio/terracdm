import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { extname } from "node:path";
import { compileConfigPack } from "./compile-pack";
import { parseJsonPackConfig } from "./parse-json";
import { parseYamlPackConfig } from "./parse-yaml";
import { assertValidPackConfig } from "./validate-pack";
import type { SignalPack, SignalPackManifest } from "../types";

export type PackConfigFormat = "json" | "yaml";

function parsePackText(text: string, format: PackConfigFormat): unknown {
  return format === "json" ? parseJsonPackConfig(text) : parseYamlPackConfig(text);
}

export function loadPackManifest(text: string, format: PackConfigFormat): SignalPackManifest {
  return assertValidPackConfig(parsePackText(text, format));
}

export function loadPack(text: string, format: PackConfigFormat): SignalPack {
  return compileConfigPack(loadPackManifest(text, format));
}

function formatFromPath(path: string): PackConfigFormat {
  const extension = extname(path).toLowerCase();
  if (extension === ".json") return "json";
  if (extension === ".yaml" || extension === ".yml") return "yaml";
  throw new Error(`Unsupported signal pack configuration format: ${extension || "(missing extension)"}`);
}

export async function loadPackFile(path: string, format?: PackConfigFormat): Promise<SignalPack> {
  const text = await readFile(path, "utf8");
  return loadPack(text, format ?? formatFromPath(path));
}

export async function loadPackManifestFile(path: string, format?: PackConfigFormat): Promise<SignalPackManifest> {
  const text = await readFile(path, "utf8");
  return loadPackManifest(text, format ?? formatFromPath(path));
}

export function loadPackFileSync(path: string, format?: PackConfigFormat): SignalPack {
  const text = readFileSync(path, "utf8");
  return loadPack(text, format ?? formatFromPath(path));
}

export function loadPackManifestFileSync(path: string, format?: PackConfigFormat): SignalPackManifest {
  const text = readFileSync(path, "utf8");
  return loadPackManifest(text, format ?? formatFromPath(path));
}
