import { NextRequest, NextResponse } from "next/server";
import { cveLookup, validateQuery } from "@/src/lib/server/osint";
export const runtime = "nodejs";
export async function GET(request: NextRequest) { try { return NextResponse.json({ ok: true, result: await cveLookup(validateQuery(request.nextUrl.searchParams.get("q"), "CVE query")) }); } catch (error) { return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "CVE lookup failed" }, { status: 400 }); } }
