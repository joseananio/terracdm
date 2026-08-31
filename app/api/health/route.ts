import { NextResponse } from "next/server";
import { getCatalog } from "@/src/lib/catalog/registry";
import "@/src/lib/server/catalog-assembly";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    status: "ok",
    service: "terracdm",
    catalogPacks: getCatalog().packs.length,
  }, {
    headers: { "cache-control": "no-store" },
  });
}
