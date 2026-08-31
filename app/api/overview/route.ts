import { NextRequest, NextResponse } from "next/server";
import { requestOverview } from "@/src/lib/server/overview-orchestrator";
import { latestOverview } from "@/src/lib/server/overview-orchestrator";
import { listOverviews, updateOverviewArtifact } from "@/src/lib/server/overview-store";
import type { ChatContext } from "@/src/lib/server/chat";
import type { BriefDevelopment, BriefScope } from "@/src/lib/brief";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const history = request.nextUrl.searchParams.get("history") === "1";
    return NextResponse.json(history ? { artifacts: await listOverviews() } : { artifact: await latestOverview() }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Overview read failed" }, { status: 503 });
  }
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  try {
    const trigger = body.trigger === "cron" || body.trigger === "incoming-data" || body.trigger === "manual" ? body.trigger : "ui";
    return NextResponse.json(await requestOverview({ trigger, context: body.context as ChatContext | undefined, force: body.force === true, scope: body.scope as BriefScope | undefined }), { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Overview workflow failed" }, { status: 503 });
  }
}

export async function PATCH(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  if (typeof body.id !== "string") return NextResponse.json({ error: "Brief id is required" }, { status: 400 });
  try {
    const artifact = await updateOverviewArtifact(body.id, { overview: typeof body.overview === "string" ? body.overview : undefined, developments: Array.isArray(body.developments) ? body.developments as BriefDevelopment[] : undefined });
    return artifact ? NextResponse.json({ artifact }, { headers: { "cache-control": "no-store" } }) : NextResponse.json({ error: "Brief not found" }, { status: 404 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Brief update failed" }, { status: 503 });
  }
}
