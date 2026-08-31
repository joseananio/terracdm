import { NextRequest, NextResponse } from "next/server";
import { defaultLayerIds, Domain, layers } from "@/src/lib/intelligence";
import { getSnapshot } from "@/src/lib/server/providers";
import { persistIntelligence } from "@/src/lib/server/store";
import { requestOverview } from "@/src/lib/server/overview-orchestrator";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const rawLayers = request.nextUrl.searchParams.get("layers");
  const allowed = new Set(layers.map((layer) => layer.id));
  const defaultLayers = defaultLayerIds;
  const requested = (rawLayers ? rawLayers.split(",") : defaultLayers).filter((layer): layer is Domain => allowed.has(layer));
  const result = await getSnapshot(requested);
  await persistIntelligence(result.snapshots);
  const overview = await requestOverview({
    trigger: "incoming-data",
    context: {
      fetchedAt: new Date().toISOString(),
      viewport: { west: -180, south: -60, east: 180, north: 80 },
      observations: result.observations,
      sourceStatuses: result.snapshots.map((item) => ({ sourceId: item.source.id, status: item.status, error: item.error })),
    },
  });
  return NextResponse.json({ fetchedAt: new Date().toISOString(), viewport: { west: -180, south: -60, east: 180, north: 80 }, ...result, overview }, { headers: { "cache-control": "no-store" } });
}
