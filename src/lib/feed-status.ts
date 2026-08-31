import type { IntelligenceSnapshot } from "@/src/lib/intelligence";

export type FeedStatus = "SYNCING" | "LIVE" | "PARTIAL" | "CACHED" | "DEGRADED";

type FeedStatusOptions = {
  loading?: boolean;
  error?: string | null;
};

export function getFeedStatus(snapshot: IntelligenceSnapshot, { loading = false, error = null }: FeedStatusOptions = {}): FeedStatus {
  if (loading && !snapshot.fetchedAt) return "SYNCING";
  if (error) return "DEGRADED";
  if (!snapshot.snapshots.length) return "SYNCING";

  const liveCount = snapshot.snapshots.filter((item) => item.status === "live").length;
  if (liveCount === snapshot.snapshots.length) return "LIVE";
  if (liveCount > 0) return "PARTIAL";
  return snapshot.snapshots.some((item) => item.status === "cached") ? "CACHED" : "DEGRADED";
}
