export function parseJsonPackConfig(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new Error(`Invalid JSON pack configuration: ${error instanceof Error ? error.message : "parse failed"}`);
  }
}
