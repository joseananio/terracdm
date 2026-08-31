import { NextRequest, NextResponse } from "next/server";
import { tlsLookup, validateQuery } from "@/src/lib/server/osint";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const hostname = validateQuery(request.nextUrl.searchParams.get("q"), "hostname");
    const port = Number(request.nextUrl.searchParams.get("port") ?? 443);
    return NextResponse.json({ ok: true, result: await tlsLookup(hostname, Number.isFinite(port) ? port : 443) }, { headers: { "cache-control": "no-store" } });
  } catch (error) { return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "TLS inspection failed" }, { status: 400 }); }
}
