import { NextResponse } from "next/server";
import { getSnapshot } from "@/src/lib/server/providers";
import { requestOverview } from "@/src/lib/server/overview-orchestrator";

export const runtime = "nodejs";

function cronAuthorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(request: Request) {
  if (!cronAuthorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const snapshot = await getSnapshot();
    const result = await requestOverview({
      trigger: "cron",
      context: {
        fetchedAt: new Date().toISOString(),
        viewport: { west: -180, south: -60, east: 180, north: 80 },
        observations: snapshot.observations,
        sourceStatuses: snapshot.snapshots.map((item) => ({ sourceId: item.source.id, status: item.status, error: item.error })),
      },
    });
    return NextResponse.json(result, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Cron overview failed" }, { status: 503 });
  }
}
