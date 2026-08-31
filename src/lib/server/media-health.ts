import { MediaHealth } from "../intelligence";

const healthCache = new Map<string, { expiresAt: number; value: MediaHealth }>();
const healthTtlMs = 60_000;
const requestTimeoutMs = 7_000;

function corsStatus(response: Response): MediaHealth["cors"] {
  const allowOrigin = response.headers.get("access-control-allow-origin");
  return allowOrigin === "*" || Boolean(allowOrigin) ? "allowed" : "unknown";
}

function geoStatus(status: number, body: string): MediaHealth["geo"] {
  if ([401, 403, 451].includes(status) || /geo.?block|region|country|territory|rights restricted/i.test(body)) return "blocked";
  return "clear";
}

function resolveUri(value: string, base: string) {
  try { return new URL(value.trim(), base).toString(); } catch { return null; }
}

function firstVariant(manifest: string, base: string) {
  const lines = manifest.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const index = lines.findIndex((line) => line.startsWith("#EXT-X-STREAM-INF"));
  return index >= 0 ? resolveUri(lines[index + 1] ?? "", base) : null;
}

function segmentAge(manifest: string) {
  const dates = [
    ...[...manifest.matchAll(/#EXT-X-PROGRAM-DATE-TIME:(.+)/g)].map((match) => Date.parse(match[1].trim())),
    ...[...manifest.matchAll(/^\s*(\d{8}T\d{6})(?:[/._-]|$)/gm)].map((match) => {
      const timestamp = match[1].match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})$/);
      return timestamp ? Date.UTC(Number(timestamp[1]), Number(timestamp[2]) - 1, Number(timestamp[3]), Number(timestamp[4]), Number(timestamp[5]), Number(timestamp[6])) : Number.NaN;
    }),
  ].filter(Number.isFinite);
  if (!dates.length) return null;
  return Math.round(Math.max(0, (Date.now() - Math.max(...dates)) / 1000));
}

async function fetchManifest(url: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), requestTimeoutMs);
  try {
    const response = await fetch(url, { redirect: "follow", cache: "no-store", signal: controller.signal, headers: { accept: "application/vnd.apple.mpegurl,application/x-mpegURL,text/plain,*/*", "user-agent": "TerraCDM/0.1 (situation-room)" } });
    return { response, body: (await response.text()).slice(0, 1_000_000) };
  } finally { clearTimeout(timer); }
}

export async function getHlsHealth(url: string): Promise<MediaHealth> {
  const cached = healthCache.get(url);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const checkedAt = new Date().toISOString();
  const unavailable = (error: string, manifestStatus: number | null = null): MediaHealth => ({ status: "unavailable", manifestStatus, cors: "unknown", geo: "unknown", segmentFreshness: "unknown", checkedAt, error });
  try {
    const root = await fetchManifest(url);
    const cors = corsStatus(root.response);
    const geo = geoStatus(root.response.status, root.body);
    if (!root.response.ok) {
      const value: MediaHealth = { status: geo === "blocked" ? "blocked" : "unavailable", manifestStatus: root.response.status, cors, geo, segmentFreshness: "unknown", checkedAt, error: `Manifest returned ${root.response.status}` };
      healthCache.set(url, { expiresAt: Date.now() + healthTtlMs, value });
      return value;
    }
    if (!root.body.includes("#EXTM3U")) {
      const value = unavailable("Manifest did not contain #EXTM3U", root.response.status);
      healthCache.set(url, { expiresAt: Date.now() + healthTtlMs, value });
      return value;
    }
    const lines = root.body.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const variantIndex = lines.findIndex((line) => line.startsWith("#EXT-X-STREAM-INF"));
    const variant = variantIndex >= 0 ? resolveUri(lines[variantIndex + 1] ?? "", url) : null;
    const mediaPlaylist = variant ? await fetchManifest(variant) : root;
    const mediaCors = corsStatus(mediaPlaylist.response);
    const mediaGeo = geoStatus(mediaPlaylist.response.status, mediaPlaylist.body);
    const age = segmentAge(mediaPlaylist.body);
    const ended = /#EXT-X-ENDLIST/.test(mediaPlaylist.body);
    const freshness: MediaHealth["segmentFreshness"] = age === null ? ended ? "stale" : "unknown" : age <= 90 ? "fresh" : "stale";
    const blocked = geo === "blocked" || mediaGeo === "blocked";
    const corsState = cors === "allowed" && mediaCors === "allowed" ? "allowed" : cors === "blocked" || mediaCors === "blocked" ? "blocked" : "unknown";
    const status: MediaHealth["status"] = blocked || corsState === "blocked" ? "blocked" : freshness === "fresh" ? "healthy" : freshness === "stale" ? "degraded" : "unavailable";
    const error = freshness === "stale" ? "Manifest is reachable but the latest program segment is stale" : freshness === "unknown" ? "Manifest is reachable but live segment freshness could not be verified" : undefined;
    const value: MediaHealth = { status, manifestStatus: root.response.status, cors: corsState, geo: blocked ? "blocked" : "clear", segmentFreshness: freshness, segmentAgeSeconds: age, checkedAt, error };
    healthCache.set(url, { expiresAt: Date.now() + healthTtlMs, value });
    return value;
  } catch (cause) {
    const value = unavailable(cause instanceof Error ? cause.message : "HLS manifest unavailable");
    healthCache.set(url, { expiresAt: Date.now() + healthTtlMs, value });
    return value;
  }
}
