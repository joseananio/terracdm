import { riskFromScore, type Entity, type MediaSource, type ProviderSnapshot, type Signal } from "../../lib/intelligence";
import { fetchJson, fetchText, isoTime } from "../../lib/server/fetch-json";
import { getHlsHealth } from "../../lib/server/media-health";
import type { ProviderImplementation } from "../../lib/catalog/types";

function safeUrl(value: string, fallback?: string) {
  try { return value ? new URL(value, fallback).toString() : fallback; } catch { return fallback; }
}

function stripHtml(value: string) {
  return value.replace(/<br\s*\/?>(\s*)/gi, " ").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').trim();
}

function textTag(block: string, tag: string) {
  const match = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
  return match?.[1]?.replace(/<!\[CDATA\[|\]\]>/g, "").replace(/<[^>]+>/g, "").trim() ?? "";
}

function tagUrl(block: string, tag: string) {
  const match = block.match(new RegExp(`<${tag}\\b[^>]*\\burl\\s*=\\s*["']([^"']+)["'][^>]*>`, "i"));
  return safeUrl(match?.[1] ?? "");
}

function youtubeMedia(channelId: string, liveUrl: string): MediaSource {
  return { kind: "youtube", channelId, url: `https://www.youtube.com/embed/live_stream?channel=${channelId}&autoplay=1&mute=1&rel=1`, liveUrl };
}

const broadcasters: Array<readonly [string, number, number, string]> = [
  ["BBC News", 51.52, -0.12, "https://www.bbc.com/news"], ["CNN", 38.91, -77.04, "https://www.cnn.com/"], ["Al Jazeera English", 25.28, 51.53, "https://www.aljazeera.com/live"], ["France 24", 48.86, 2.35, "https://www.france24.com/en/live"], ["DW English", 52.52, 13.40, "https://www.dw.com/en/live-tv/s-100825"], ["NHK World", 35.68, 139.76, "https://www3.nhk.or.jp/nhkworld/en/live/"], ["Euronews", 48.86, 2.35, "https://www.euronews.com/live"], ["Sky News", 51.51, -0.11, "https://news.sky.com/watch-live"], ["CBS News", 38.90, -77.04, "https://www.cbsnews.com/live/"], ["NBC News NOW", 40.76, -73.98, "https://www.nbcnews.com/now"], ["Bloomberg TV", 40.76, -73.99, "https://www.bloomberg.com/live"], ["C-SPAN", 38.90, -77.04, "https://www.c-span.org/"], ["CBC News", 43.64, -79.39, "https://www.cbc.ca/player/news/live"], ["WION", 28.61, 77.23, "https://www.wionews.com/live-tv"], ["TRT World", 41.01, 28.98, "https://www.trtworld.com/live"], ["CNA", 1.29, 103.85, "https://www.channelnewsasia.com/watch"], ["ABC News Live", 40.75, -73.99, "https://abcnews.go.com/Live"], ["CGTN", 39.91, 116.39, "https://news.cgtn.com/livestream"], ["RT News", 55.76, 37.62, "https://rumble.com/c/RTNewsEN"], ["The Times of India", 19.08, 72.88, "https://timesofindia.indiatimes.com/live-tv"],
];

const youtubeLiveChannels: Record<string, string> = {
  CNN: "UCupvZG-5ko_eiXAupbDfxWw", "Al Jazeera English": "UCNye-wNBqNL5ZzHSJj3l8Bg", "DW English": "UCknLrEdhRCp1aegoMqRaCZg", "France 24": "UCQfwfsi5VrQ8yKZ-UWmAEFg", "NHK World": "UCSPEjw8F2nQDtmUKPFNF7_A", "Sky News": "UCoMdktPbSTixAyNGwb-UYkQ", "TRT World": "UC7fWeaHhqgM4Ry-RMpM2YYw", CNA: "UC83jt4dlz1Gjl58fzQrrKZg", WION: "UC_gUM8rL-Lrg6O3adPW9K1g",
};

const officialHlsSources: Record<string, string> = { "France 24": "https://live.france24.com/hls/live/2037218-b/F24_EN_HI_HLS/master_5000.m3u8" };
const rssFallbacks = [["BBC World RSS", "https://feeds.bbci.co.uk/news/world/rss.xml"], ["Al Jazeera RSS", "https://www.aljazeera.com/xml/rss/all.xml"], ["GDACS RSS", "https://www.gdacs.org/xml/rss.xml"], ["TechRadar RSS", "https://www.techradar.com/feeds.xml"]] as const;

function parseRssItems(xml: string, source: string) {
  const channelImage = xml.match(/<channel\b[^>]*>[\s\S]*?<image\b[^>]*>([\s\S]*?)<\/image>/i);
  const channelImageUrl = safeUrl(channelImage ? textTag(channelImage[1], "url") : "");
  return (xml.match(/<item>[\s\S]*?<\/item>/gi) ?? []).map((item) => ({ title: stripHtml(textTag(item, "title")), detail: stripHtml(textTag(item, "description")).slice(0, 180), published: textTag(item, "pubDate"), source, url: textTag(item, "link"), imageUrl: tagUrl(item, "media:content") ?? tagUrl(item, "enclosure") ?? tagUrl(item, "media:thumbnail") ?? channelImageUrl })).filter((item) => item.title);
}

function formatGdeltTime(value?: string) {
  return value && value.length >= 14 ? `${value.slice(8, 10)}:${value.slice(10, 12)}:${value.slice(12, 14)}` : new Date().toISOString().slice(11, 19);
}

function gdeltObservedAt(value?: string) {
  if (!value || value.length < 14) return new Date().toISOString();
  return isoTime(`${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T${value.slice(8, 10)}:${value.slice(10, 12)}:${value.slice(12, 14)}Z`);
}

export const newsProviderImplementation: ProviderImplementation = async ({ pack, provider }) => {
  const reportSubdomain = pack.signals?.find((signal) => signal.providerId === provider.id)?.subdomainId ?? pack.subdomains[0]?.id;
  const broadcasterSubdomain = pack.subdomains.find((subdomain) => subdomain.id !== reportSubdomain)?.id ?? reportSubdomain;
  let signals: Signal[] = [];
  let source = "GDELT";
  let error: string | undefined;
  try {
    const data = await fetchJson<{ articles?: Array<{ url?: string; title?: string; seendate?: string; domain?: string; sourcecountry?: string }> }>("https://api.gdeltproject.org/api/v2/doc/doc?query=conflict%20OR%20earthquake%20OR%20cyber&mode=artlist&format=json&maxrecords=30&sort=HybridRel");
    signals = (data.articles ?? []).slice(0, 20).map((article, index) => ({ id: `gdelt:${article.url ?? index}`, kind: "signal" as const, domain: pack.domain, subdomainId: reportSubdomain, name: String(article.title ?? "Global report"), description: `${article.domain ?? "unknown source"} · ${article.sourcecountry ?? "—"}`, risk: "low" as const, riskScore: 20, location: { label: article.sourcecountry ?? "global" }, source: { id: "gdelt", name: "GDELT", url: article.url }, providerId: provider.id, observedAt: gdeltObservedAt(article.seendate), url: article.url }));
  } catch (cause) {
    error = cause instanceof Error ? cause.message : "GDELT request failed";
    const fallbackResults = await Promise.allSettled(rssFallbacks.map(async ([rssSource, rssUrl]) => ({ rssSource, items: parseRssItems(await fetchText(rssUrl, { headers: { accept: "application/rss+xml,application/xml,text/xml,*/*" } }), rssSource) })));
    const fallbackItems = fallbackResults.flatMap((result) => result.status === "fulfilled" ? result.value.items : []);
    signals = fallbackItems.slice(0, 30).map((item, index) => ({ id: `rss:${item.source.toLowerCase().replace(/[^a-z0-9]+/g, "-")}:${index}:${item.url || item.title}`, kind: "signal" as const, domain: pack.domain, subdomainId: reportSubdomain, name: item.title, description: item.detail, risk: "low" as const, riskScore: 20, location: { label: item.source.replace(/ RSS$/, "") }, source: { id: item.source.toLowerCase().replace(/[^a-z0-9]+/g, "-"), name: item.source, url: item.url }, providerId: provider.id, observedAt: isoTime(item.published), url: item.url, imageUrl: item.imageUrl }));
    source = fallbackItems.length ? "BBC / Al Jazeera / GDACS / TechRadar RSS" : source;
    if (!fallbackItems.length) error = `${error}; RSS fallback: unavailable`;
  }

  const entities: Entity[] = await Promise.all(broadcasters.map(async ([name, lat, lng, url]) => {
    const channel = youtubeLiveChannels[name];
    const youtubeFallback = channel ? youtubeMedia(channel, url) : undefined;
    const hlsUrl = officialHlsSources[name];
    const health = hlsUrl ? await getHlsHealth(hlsUrl) : undefined;
    const hlsCandidate = hlsUrl && health ? { kind: "hls" as const, url: hlsUrl, liveUrl: url, health, fallback: youtubeFallback } : undefined;
    const hlsMedia = hlsCandidate && hlsCandidate.health.status === "healthy" && hlsCandidate.health.segmentFreshness === "fresh" ? hlsCandidate : undefined;
    const officialMedia = { kind: "external" as const, url, reason: "Official broadcaster page" };
    const sourceMedia = hlsMedia ?? youtubeFallback ?? officialMedia;
    const mediaSources = [hlsCandidate, youtubeFallback, officialMedia].filter((item): item is MediaSource => Boolean(item));
    const mediaDescriptor = hlsMedia ? `Official HLS · ${health?.status}` : youtubeFallback ? "Official live broadcast · YouTube fallback" : "Official live broadcast endpoint";
    return { id: `broadcast:${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`, kind: "entity" as const, domain: pack.domain, subdomainId: broadcasterSubdomain, name, description: mediaDescriptor, risk: riskFromScore(8), riskScore: 8, location: { coordinates: { lat, lng }, label: name }, source: { id: "broadcast-registry", name: "Broadcaster registry", url }, providerId: provider.id, observedAt: new Date().toISOString(), url, media: sourceMedia, mediaSources, properties: { liveUrl: url, embedUrl: youtubeFallback?.url ?? null, mediaKind: sourceMedia.kind, mediaHealth: health?.status ?? "not-tested", mediaManifestStatus: health?.manifestStatus ?? null, mediaCors: health?.cors ?? "unknown", mediaGeo: health?.geo ?? "unknown", mediaSegmentFreshness: health?.segmentFreshness ?? "unknown", mediaCheckedAt: health?.checkedAt ?? null, mediaError: health?.error ?? null, mediaFallback: hlsMedia?.fallback?.kind ?? null } };
  }));

  const snapshot: ProviderSnapshot = { domain: pack.domain, providerId: provider.id, source: { id: signals.length && source.toLowerCase().includes("gdelt") ? "gdelt" : "rss-fallback", name: "GDELT / BBC RSS / Al Jazeera RSS / GDACS RSS / TechRadar RSS / broadcaster registry" }, status: signals.length ? "live" : "degraded", fetchedAt: new Date().toISOString(), observations: [...entities, ...signals], error: signals.length ? undefined : error, nextPollSeconds: provider.pollSeconds ?? 60 };
  return snapshot;
};
