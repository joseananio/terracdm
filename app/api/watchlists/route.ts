import { NextRequest, NextResponse } from "next/server";
import { saveWatchlist } from "@/src/lib/server/agent";
export const runtime = "nodejs";
export async function POST(request: NextRequest) { const body = await request.json().catch(() => ({})); if (!body.name || !Array.isArray(body.entityIds)) return NextResponse.json({ error: "name and entityIds are required" }, { status: 400 }); return NextResponse.json(await saveWatchlist(body.name, body.entityIds)); }
