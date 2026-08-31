import { NextRequest, NextResponse } from "next/server";
import { dnsLookup, validateQuery } from "@/src/lib/server/osint";
export const runtime = "nodejs";
export async function GET(request: NextRequest) { try { return NextResponse.json({ ok: true, result: await dnsLookup(validateQuery(request.nextUrl.searchParams.get("q"), "hostname")) }); } catch (error) { return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "DNS lookup failed" }, { status: 400 }); } }
