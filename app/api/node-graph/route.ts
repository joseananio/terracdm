import { NextRequest, NextResponse } from "next/server";
import { getSignalPack } from "@/src/lib/catalog/registry";
import { buildRepositoryContextGraph, buildRepositoryNodeGraph, expandNodeGraph } from "@/src/lib/server/node-graph";
import "@/src/lib/server/catalog-assembly";

export const runtime = "nodejs";

function requestedDomains(value: unknown) {
  if (!Array.isArray(value)) return undefined;
  const domains = value
    .filter((item): item is string => typeof item === "string" && Boolean(getSignalPack(item)))
    .slice(0, 20);
  return domains.length ? domains : undefined;
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null) as {
    selectedObservationId?: unknown;
    expandId?: unknown;
    domains?: unknown;
    limit?: unknown;
  } | null;
  const expandId = typeof body?.expandId === "string" ? body.expandId.trim() : "";
  if (expandId) return NextResponse.json(await expandNodeGraph(expandId), { headers: { "cache-control": "no-store" } });

  const selectedObservationId = typeof body?.selectedObservationId === "string" ? body.selectedObservationId.trim() : "";
  if (selectedObservationId) {
    const result = await buildRepositoryNodeGraph(selectedObservationId);
    if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json(result, { headers: { "cache-control": "no-store" } });
  }

  const limit = Number(body?.limit);
  const graph = await buildRepositoryContextGraph({
    domains: requestedDomains(body?.domains),
    limit: Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 400) : undefined,
  });
  return NextResponse.json(graph, { headers: { "cache-control": "no-store" } });
}
