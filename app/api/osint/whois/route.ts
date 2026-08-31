import { NextRequest, NextResponse } from "next/server";
import { validateQuery, whoisLookup } from "@/src/lib/server/osint";
export const runtime = "nodejs";
export async function GET(request: NextRequest) { try { return NextResponse.json({ ok: true, result: await whoisLookup(validateQuery(request.nextUrl.searchParams.get("q"), "domain")) }); } catch (error) { return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "RDAP lookup failed" }, { status: 400 }); } }
