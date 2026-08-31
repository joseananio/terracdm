import type { ChatContext, ChatMessage } from "./server/chat";
import type { AgentHelper } from "./catalog/agents";

export type ChatReply = { message: string; helpers: AgentHelper[]; provider: "openai" | "anthropic" | "deterministic"; model: string; fallback: boolean };

export async function sendChat(messages: ChatMessage[], context?: ChatContext, threadId?: string | null): Promise<ChatReply & { threadId: string; storage?: string }> {
  const response = await fetch("/api/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ messages, message: messages.at(-1)?.content, threadId, context }) });
  const payload = await response.json() as ChatReply & { threadId?: string; storage?: string; error?: string };
  if (!response.ok) throw new Error(payload.error ?? "AI chat failed");
  if (!payload.threadId) throw new Error("Chat thread was not created");
  return payload as ChatReply & { threadId: string; storage?: string };
}
