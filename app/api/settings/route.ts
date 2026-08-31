import { NextRequest, NextResponse } from "next/server";
import { getMapSettings, saveMapSettings } from "@/src/lib/server/map-settings-store";

export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json({ settings: await getMapSettings() }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Settings read failed" }, { status: 503 });
  }
}

export async function PUT(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  try {
    return NextResponse.json({ settings: await saveMapSettings(body.settings ?? body) }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Settings write failed" }, { status: 503 });
  }
}
