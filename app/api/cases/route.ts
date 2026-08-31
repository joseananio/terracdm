import { NextRequest, NextResponse } from "next/server";
import { createCase, listCases, updateCase } from "@/src/lib/server/case-store";
import type { CreateCaseInput, IntelligenceCase } from "@/src/lib/cases";

export const runtime = "nodejs";

export async function GET() {
  try { return NextResponse.json({ cases: await listCases() }, { headers: { "cache-control": "no-store" } }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Cases could not be read" }, { status: 503 }); }
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({})) as CreateCaseInput;
  if (!body.title?.trim()) return NextResponse.json({ error: "Case title is required" }, { status: 400 });
  try { return NextResponse.json({ case: await createCase(body) }, { status: 201, headers: { "cache-control": "no-store" } }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Case could not be created" }, { status: 503 }); }
}

export async function PATCH(request: NextRequest) {
  const body = await request.json().catch(() => ({})) as { id?: string; patch?: Partial<IntelligenceCase> };
  if (!body.id || !body.patch) return NextResponse.json({ error: "Case id and patch are required" }, { status: 400 });
  const patch: Partial<Pick<IntelligenceCase, "title" | "summary" | "assessment" | "status" | "risk" | "confidence" | "items" | "notes" | "events">> = {};
  if (typeof body.patch.title === "string") patch.title = body.patch.title.trim();
  if (typeof body.patch.summary === "string") patch.summary = body.patch.summary;
  if (typeof body.patch.assessment === "string") patch.assessment = body.patch.assessment;
  if (["active", "watching", "closed"].includes(body.patch.status ?? "")) patch.status = body.patch.status;
  if (["low", "medium", "high"].includes(body.patch.risk ?? "")) patch.risk = body.patch.risk;
  if (["low", "medium", "high"].includes(body.patch.confidence ?? "")) patch.confidence = body.patch.confidence;
  if (Array.isArray(body.patch.items)) patch.items = body.patch.items;
  if (Array.isArray(body.patch.notes)) patch.notes = body.patch.notes;
  if (Array.isArray(body.patch.events)) patch.events = body.patch.events;
  try {
    const value = await updateCase(body.id, patch);
    return value ? NextResponse.json({ case: value }, { headers: { "cache-control": "no-store" } }) : NextResponse.json({ error: "Case not found" }, { status: 404 });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Case could not be updated" }, { status: 503 }); }
}
