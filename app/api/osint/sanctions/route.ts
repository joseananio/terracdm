import { NextRequest, NextResponse } from "next/server";
import { searchSanctions } from "@/src/lib/server/osint";
export const runtime = "nodejs";
export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("q")?.trim();
  if (!query) return NextResponse.json({ ok: false, status: "invalid_input", error: "q is required" }, { status: 400 });
  try { return NextResponse.json({ ok: true, result: await searchSanctions(query) }, { headers: { "cache-control": "no-store" } }); }
  catch (error) { return NextResponse.json({ ok: false, status: "degraded", source: "OFAC SDN XML", query, error: error instanceof Error ? error.message : "sanctions search failed" }, { status: 502 }); }
}
