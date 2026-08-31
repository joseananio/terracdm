import { NextRequest, NextResponse } from "next/server";
import { getHlsHealth } from "@/src/lib/server/media-health";

export const runtime = "nodejs";

const allowedHosts = new Set(["live.france24.com"]);

export async function GET(request: NextRequest) {
  const rawUrl = request.nextUrl.searchParams.get("url");
  if (!rawUrl) return NextResponse.json({ error: "HLS URL is required" }, { status: 400 });
  let url: URL;
  try { url = new URL(rawUrl); } catch { return NextResponse.json({ error: "Invalid HLS URL" }, { status: 400 }); }
  if (url.protocol !== "https:" || !allowedHosts.has(url.hostname) || !url.pathname.endsWith(".m3u8")) return NextResponse.json({ error: "HLS source is not allowlisted" }, { status: 403 });
  return NextResponse.json(await getHlsHealth(url.toString()), { headers: { "cache-control": "public, max-age=60, stale-while-revalidate=300" } });
}
