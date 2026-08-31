export class ProviderError extends Error {
  constructor(message: string, public readonly statusCode?: number, public readonly code = "provider_error") {
    super(message);
  }
}

export async function fetchJson<T>(url: string, init?: RequestInit, timeoutMs = 12_000): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: { accept: "application/json", ...(init?.headers ?? {}) },
      cache: "no-store",
    });
    if (!response.ok) {
      throw new ProviderError(`${response.status} ${response.statusText}`, response.status, response.status === 401 || response.status === 403 ? "key_required" : "provider_error");
    }
    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    if (error instanceof Error && error.name === "AbortError") throw new ProviderError("provider timeout", 504, "timeout");
    throw new ProviderError(error instanceof Error ? error.message : "provider request failed");
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchText(url: string, init?: RequestInit, timeoutMs = 15_000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal, headers: { accept: "text/plain,text/csv,*/*", ...(init?.headers ?? {}) }, cache: "no-store" });
    if (!response.ok) throw new ProviderError(`${response.status} ${response.statusText}`, response.status, response.status === 401 || response.status === 403 ? "key_required" : "provider_error");
    return await response.text();
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    throw new ProviderError(error instanceof Error ? error.message : "provider request failed");
  } finally { clearTimeout(timeout); }
}

export function isoTime(value?: string | number) {
  const date = value ? new Date(value) : new Date();
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

export function locationText(lat: number, lng: number) {
  return `${Math.abs(lat).toFixed(2)}°${lat >= 0 ? "N" : "S"} ${Math.abs(lng).toFixed(2)}°${lng >= 0 ? "E" : "W"}`;
}

export function severityFor(value: number): "low" | "medium" | "high" {
  if (value >= 70) return "high";
  if (value >= 40) return "medium";
  return "low";
}
