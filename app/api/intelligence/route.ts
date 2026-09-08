import { NextRequest, NextResponse } from "next/server";
import { defaultLayerIds, Domain, layers } from "@/src/lib/intelligence";
import { getSnapshot } from "@/src/lib/server/providers";
import { persistIntelligence } from "@/src/lib/server/store";
import { requestOverview } from "@/src/lib/server/overview-orchestrator";
import { synchronizeWithCraven } from "@/src/lib/server/craven-backend";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const rawLayers = request.nextUrl.searchParams.get("layers");
  const allowed = new Set(layers.map((layer) => layer.id));
  const requested = (rawLayers ? rawLayers.split(",") : defaultLayerIds).filter((layer): layer is Domain => allowed.has(layer));
  const result = await getSnapshot(requested);
  try { await persistIntelligence(result.snapshots); }
  catch (error) { console.error("Failed to persist intelligence response", error); return NextResponse.json({ error: "Intelligence storage is unavailable" }, { status: 503 }); }
  const semanticBackend = await synchronizeWithCraven(result.observations).catch((error) => {
    console.warn("Craven synchronization unavailable", error);
    return { mode: "standalone" as const, synced: 0, failed: result.observations.length, corrections: 0, reason: "Craven synchronization is unavailable." };
  });
  const overview = await requestOverview({ trigger: "incoming-data", context: { fetchedAt: new Date().toISOString(),
    viewport: { west: -180, south: -60, east: 180, north: 80 }, observations: result.observations,
    sourceStatuses: result.snapshots.map((item) => ({ sourceId: item.source.id, status: item.status, error: item.error })) } });
  return NextResponse.json({ fetchedAt: new Date().toISOString(), viewport: { west: -180, south: -60, east: 180, north: 80 },
    ...result, semanticBackend, overview }, { headers: { "cache-control": "no-store" } });
}
