import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

type TileLayer = "street" | "street-reference" | "satellite" | "ecdis";
type TileParams = { layer: string; z: string; x: string; y: string };
type CachedTile = { body: ArrayBuffer; contentType: string; expiresAt: number };

const upstreams: Record<TileLayer, string> = {
  street: "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile",
  "street-reference": "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile",
  satellite: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile",
  ecdis: "https://gis.charttools.noaa.gov/arcgis/rest/services/MCS/ENCOnline/MapServer/exts/MaritimeChartService/WMSServer",
};
const cache = new Map<string, CachedTile>();
const maxEntries = 256;
const ttlMs = 24 * 60 * 60 * 1000;

function tileNumber(value: string, maximum: number) {
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 && parsed <= maximum ? parsed : null;
}

function response(body: ArrayBuffer, contentType: string, cacheStatus: "HIT" | "MISS") {
  return new NextResponse(body, {
    headers: {
      "content-type": contentType,
      "cache-control": "public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800",
      "x-terracdm-tile-cache": cacheStatus,
    },
  });
}

export async function GET(request: NextRequest, { params }: { params: Promise<TileParams> }) {
  const { layer: rawLayer, z: rawZoom, x: rawX, y: rawY } = await params;
  const layer = rawLayer as TileLayer;
  if (!(layer in upstreams)) return NextResponse.json({ error: "Unknown tile layer" }, { status: 404 });

  const zoom = tileNumber(rawZoom, 19);
  const maxCoordinate = zoom === null ? -1 : (2 ** zoom) - 1;
  const x = tileNumber(rawX, maxCoordinate);
  const y = tileNumber(rawY, maxCoordinate);
  if (zoom === null || x === null || y === null) return NextResponse.json({ error: "Invalid tile coordinates" }, { status: 400 });

  const key = `${upstreams[layer]}/${zoom}/${x}/${y}`;
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    cache.delete(key);
    cache.set(key, cached);
    return response(cached.body, cached.contentType, "HIT");
  }
  if (cached) cache.delete(key);

  const upstream = layer === "ecdis"
    ? `${upstreams.ecdis}?service=WMS&request=GetMap&version=1.3.0&layers=1%2C2%2C3%2C4%2C5%2C6%2C7%2C8%2C9%2C10%2C11&styles=&format=image%2Fpng&transparent=true&crs=EPSG%3A3857&width=256&height=256&bbox=${tileBounds(x, y, zoom).join(",")}`
    : `${upstreams[layer]}/${zoom}/${y}/${x}`;
  try {
    const upstreamResponse = await fetch(upstream, {
      headers: { accept: "image/avif,image/webp,image/png,image/jpeg,*/*", "user-agent": "TerraCDM/0.1 (situation-room)" },
      next: { revalidate: 86400 },
    });
    if (!upstreamResponse.ok) return NextResponse.json({ error: `Tile source returned ${upstreamResponse.status}` }, { status: 502 });

    const contentType = upstreamResponse.headers.get("content-type")?.split(";")[0] || "image/jpeg";
    if (!contentType.startsWith("image/")) return NextResponse.json({ error: "Tile source did not return an image" }, { status: 502 });
    const body = await upstreamResponse.arrayBuffer();
    cache.set(key, { body, contentType, expiresAt: Date.now() + ttlMs });
    while (cache.size > maxEntries) cache.delete(cache.keys().next().value as string);
    return response(body, contentType, "MISS");
  } catch {
    return NextResponse.json({ error: "Tile source unavailable" }, { status: 502 });
  }
}

function tileBounds(x: number, y: number, zoom: number) {
  const earthRadius = 20_037_508.342789244;
  const world = 2 ** zoom;
  const left = (x / world) * earthRadius * 2 - earthRadius;
  const right = ((x + 1) / world) * earthRadius * 2 - earthRadius;
  const top = earthRadius - (y / world) * earthRadius * 2;
  const bottom = earthRadius - ((y + 1) / world) * earthRadius * 2;
  return [left, bottom, right, top];
}
