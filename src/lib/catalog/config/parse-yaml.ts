import { parse } from "yaml";

export function parseYamlPackConfig(text: string): unknown {
  try {
    return parse(text, { uniqueKeys: true }) as unknown;
  } catch (error) {
    throw new Error(`Invalid YAML pack configuration: ${error instanceof Error ? error.message : "parse failed"}`);
  }
}
