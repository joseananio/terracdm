import { NextRequest, NextResponse } from "next/server";
import { getCatalog } from "@/src/lib/catalog/registry";
import { providerErrorSnapshot, runProvider } from "@/src/lib/catalog/provider-runtime";
import "@/src/lib/server/catalog-assembly";
import { persistIntelligence } from "@/src/lib/server/store";

export const runtime = "nodejs";

function numberParam(request: NextRequest, name: string) {
  const value = Number(request.nextUrl.searchParams.get(name));
  return Number.isFinite(value) ? value : undefined;
}

export async function GET(request: NextRequest) {
  const providerId = decodeURIComponent(request.nextUrl.pathname.split("/").at(-1) ?? "");
  const provider = getCatalog().getProvider(providerId);
  if (!provider) return NextResponse.json({ error: "Provider not found" }, { status: 404 });
  const west = numberParam(request, "west");
  const south = numberParam(request, "south");
  const east = numberParam(request, "east");
  const north = numberParam(request, "north");
  const zoom = numberParam(request, "zoom");
  const viewport = west !== undefined && south !== undefined && east !== undefined && north !== undefined
    ? { west, south, east, north }
    : undefined;
  const snapshot = await runProvider(provider, { viewport, zoom })
    .catch((error) => ({ ...providerErrorSnapshot(provider, error), status: "degraded" as const }));
  try {
    await persistIntelligence([snapshot]);
  } catch (error) {
    console.error(`Failed to persist provider response for ${providerId}`, error);
    return NextResponse.json({ error: "Intelligence storage is unavailable" }, { status: 503 });
  }
  return NextResponse.json(snapshot, { headers: { "cache-control": "no-store" } });
}
