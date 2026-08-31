import { NextResponse } from "next/server";
import { assertValidSignalPacks, publicCatalog } from "@/src/lib/catalog/registry";
import "@/src/lib/server/catalog-assembly";

export const runtime = "nodejs";

export async function GET() {
  assertValidSignalPacks();
  const catalog = publicCatalog();
  return NextResponse.json({ version: catalog.version, providerKinds: catalog.providerKinds, agentRoles: catalog.agentRoles, packs: catalog.packs }, { headers: { "cache-control": "no-store" } });
}
