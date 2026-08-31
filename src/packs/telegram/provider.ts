import { type ProviderSnapshot, type Signal } from "../../lib/intelligence";
import { fetchText, isoTime } from "../../lib/server/fetch-json";
import type { ProviderImplementation } from "../../lib/catalog/types";

function stripHtml(value: string) {
  return value.replace(/<br\s*\/?>(\s*)/gi, " ").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').trim();
}

function safeUrl(value: string, fallback?: string) {
  try { return value ? new URL(value, fallback).toString() : fallback; } catch { return fallback; }
}

export const telegramProviderImplementation: ProviderImplementation = async ({ pack, provider }) => {
  const subdomainId = pack.signals?.find((signal) => signal.providerId === provider.id)?.subdomainId ?? pack.subdomains[0]?.id;
  const channels = (process.env.TELEGRAM_CHANNELS?.split(",").map((item) => item.trim()).filter(Boolean) ?? ["sentdefender", "osintdefender", "OSINTtechnical", "warmonitors", "UAWeapons"]).slice(0, 12);
  const signalBatches = await Promise.all(channels.map(async (channel) => {
    const channelSignals: Signal[] = [];
    try {
      const html = await fetchText(`https://t.me/s/${encodeURIComponent(channel)}`, { headers: { accept: "text/html", "user-agent": "TerraCDM/0.1" } });
      const messages = html.match(/<div class="tgme_widget_message_text[^"]*">[\s\S]*?<\/div>/gi) ?? [];
      const dates = [...html.matchAll(/<time datetime="([^"]+)"/gi)].map((match) => match[1]);
      const links = [...html.matchAll(/class="tgme_widget_message_date"[^>]*href="([^"]+)"/gi)].map((match) => match[1]);
      messages.slice(-10).forEach((message, index) => {
        const detail = stripHtml(message.replace(/^[\s\S]*?>/, "").replace(/<\/div>[\s\S]*$/, ""));
        if (!detail) return;
        const observedAt = isoTime(dates[dates.length - messages.length + index]);
        channelSignals.push({
          id: `telegram:${channel}:${links[links.length - messages.length + index] ?? index}`,
          kind: "signal",
          domain: pack.domain,
          subdomainId,
          name: `@${channel}`,
          description: detail.slice(0, 240),
          risk: /urgent|strike|attack|missile|killed|explosion/i.test(detail) ? "high" : "low",
          riskScore: /urgent|strike|attack|missile|killed|explosion/i.test(detail) ? 80 : 20,
          location: { label: "Public Telegram channel" },
          source: { id: provider.sourceId ?? provider.id, name: provider.label },
          providerId: provider.id,
          observedAt,
          url: safeUrl(links[links.length - messages.length + index], `https://t.me/s/${channel}`),
          properties: { channel },
        });
      });
    } catch {
      // Individual channels may be private or rate-limited.
    }
    return channelSignals;
  }));
  const signals = signalBatches.flat();
  const snapshot: ProviderSnapshot = {
    domain: pack.domain,
    providerId: provider.id,
    source: { id: provider.sourceId ?? provider.id, name: provider.label },
    status: signals.length ? "live" : "degraded",
    fetchedAt: new Date().toISOString(),
    observations: signals,
    error: signals.length ? undefined : "No configured public channel preview returned records",
    nextPollSeconds: provider.pollSeconds ?? 60,
  };
  return snapshot;
};
