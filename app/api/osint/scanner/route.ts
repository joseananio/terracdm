import { NextRequest, NextResponse } from "next/server";
import { scannerLookup, validateQuery } from "@/src/lib/server/osint";
import { ProviderError } from "@/src/lib/server/fetch-json";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    return NextResponse.json({ ok: true, result: await scannerLookup(validateQuery(body.target, "scan target")) }, { headers: { "cache-control": "no-store" } });
  } catch (error) { return NextResponse.json({ ok: false, status: error instanceof ProviderError ? error.code : "error", error: error instanceof Error ? error.message : "scanner failed" }, { status: error instanceof ProviderError ? error.statusCode ?? 502 : 400 }); }
}
