import { NextRequest, NextResponse } from "next/server";
import { bitcoinLookup, ethereumLookup, validateQuery } from "@/src/lib/server/osint";
export const runtime = "nodejs";
export async function GET(request: NextRequest) {
  try {
    const address = validateQuery(request.nextUrl.searchParams.get("address"), "wallet address");
    const chain = request.nextUrl.searchParams.get("chain") === "ethereum" ? "ethereum" : "bitcoin";
    return NextResponse.json({ ok: true, result: chain === "ethereum" ? await ethereumLookup(address) : await bitcoinLookup(address) });
  } catch (error) { return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "wallet lookup failed" }, { status: 400 }); }
}
