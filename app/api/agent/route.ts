import { NextRequest, NextResponse } from "next/server";
import { runAgentTask } from "@/src/lib/server/agent";
export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  if (typeof body.command !== "string" || !body.command.trim()) return NextResponse.json({ error: "command is required" }, { status: 400 });
  return NextResponse.json(await runAgentTask(body.command, body.context));
}
