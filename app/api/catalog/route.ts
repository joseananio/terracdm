import { NextResponse } from "next/server";
import { assertValidSignalPacks, publicCatalog } from "@/src/lib/catalog/registry";
import "@/src/lib/server/catalog-assembly";

export const runtime = "nodejs";

export async function GET() {
  assertValidSignalPacks();
  return NextResponse.json(publicCatalog(), { headers: { "cache-control": "no-store" } });
}
