import { NextRequest, NextResponse } from "next/server";
import { runChat, type ChatContext, type ChatMessage } from "@/src/lib/server/chat";
import { appendChatMessage, createChatThread, getChatMessages, getChatThread } from "@/src/lib/server/chat-store";

export const runtime = "nodejs";

function isChatMessage(value: unknown): value is ChatMessage {
  if (!value || typeof value !== "object") return false;
  const message = value as Record<string, unknown>;
  return (message.role === "user" || message.role === "assistant") && typeof message.content === "string" && message.content.trim().length > 0;
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const messages = Array.isArray(body.messages) ? body.messages.filter(isChatMessage).slice(-20) : [];
  const requestedMessage = typeof body.message === "string" ? body.message.trim() : "";
  const content = requestedMessage || messages.at(-1)?.content?.trim() || "";
  if (!content) return NextResponse.json({ error: "a user message is required" }, { status: 400 });

  try {
    const context = body.context as ChatContext | undefined;
    const requestedThreadId = typeof body.threadId === "string" ? body.threadId : "";
    let thread = requestedThreadId ? await getChatThread(requestedThreadId) : null;
    if (!thread) {
      thread = await createChatThread({
        title: content.slice(0, 80),
        entityIds: context?.selectedEntityIds ?? [],
        context: {
          fetchedAt: context?.fetchedAt,
          viewport: context?.viewport,
          selectedEntityIds: context?.selectedEntityIds ?? [],
        },
      });
    }

    const persistedMessages = await getChatMessages(thread.id);
    const latest = persistedMessages.at(-1);
    const duplicatePendingUser = latest?.role === "user" && latest.content === content;
    if (!duplicatePendingUser) {
      await appendChatMessage({
        threadId: thread.id,
        role: "user",
        content,
        metadata: {
          fetchedAt: context?.fetchedAt ?? null,
          references: (context?.references ?? []).slice(0, 20).map(({ id, kind, name, type }) => ({ id, kind, name, type })),
        },
      });
    }

    const storedHistory = persistedMessages
      .filter((message): message is typeof message & { role: "user" | "assistant" } => message.role === "user" || message.role === "assistant")
      .map((message) => ({ role: message.role, content: message.content }));
    const history = duplicatePendingUser ? storedHistory : [...storedHistory, { role: "user" as const, content }];
    const reply = await runChat(history, context);
    const assistant = reply.message.trim();
    if (!assistant) throw new Error("The analyst could not produce a response. Please try again.");
    await appendChatMessage({
      threadId: thread.id,
      role: "assistant",
      content: assistant,
      provider: reply.provider,
      model: reply.model,
      metadata: { fallback: reply.fallback },
    });

    return NextResponse.json({ ...reply, message: assistant, threadId: thread.id, storage: thread.storage });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "AI chat failed" }, { status: 503 });
  }
}

export async function GET(request: NextRequest) {
  const threadId = request.nextUrl.searchParams.get("threadId")?.trim() ?? "";
  if (!threadId) return NextResponse.json({ error: "threadId is required" }, { status: 400 });

  try {
    const thread = await getChatThread(threadId);
    if (!thread) return NextResponse.json({ error: "Chat thread not found" }, { status: 404 });
    const messages = await getChatMessages(threadId);
    return NextResponse.json({
      thread,
      messages: messages.map(({ role, content }) => ({ role, content })),
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Chat history read failed" }, { status: 503 });
  }
}
