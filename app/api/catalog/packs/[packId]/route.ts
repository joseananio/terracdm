import { NextResponse } from "next/server";
import { assertValidSignalPacks, getSignalPack, publicSignalPack } from "@/src/lib/catalog/registry";
import "@/src/lib/server/catalog-assembly";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ packId: string }> }) {
  assertValidSignalPacks();
  const { packId } = await params;
  const pack = getSignalPack(decodeURIComponent(packId));
  if (!pack) return NextResponse.json({ error: "Pack not found" }, { status: 404 });
  return NextResponse.json(publicSignalPack(pack), { headers: { "cache-control": "no-store" } });
}
