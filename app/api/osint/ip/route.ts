import { NextRequest, NextResponse } from "next/server";
import { ipLookup, validateQuery } from "@/src/lib/server/osint";
export const runtime = "nodejs";
export async function GET(request: NextRequest) { try { return NextResponse.json({ ok: true, result: await ipLookup(validateQuery(request.nextUrl.searchParams.get("q"), "IP")) }); } catch (error) { return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "IP lookup failed" }, { status: 400 }); } }
