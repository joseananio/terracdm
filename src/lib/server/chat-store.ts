import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

export type ChatStorage = "supabase" | "local";
export type ChatRole = "user" | "assistant" | "system" | "tool";

export type StoredChatMessage = {
  id: string;
  threadId: string;
  sequence: number;
  role: ChatRole;
  content: string;
  provider?: string;
  model?: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  storage: ChatStorage;
};

export type ChatThread = {
  id: string;
  workspaceKey: string;
  agentRole: string;
  title?: string;
  entityIds: string[];
  context: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  storage: ChatStorage;
};

type LocalChatState = { threads: ChatThread[]; messages: StoredChatMessage[] };

function localStatePath() {
  return path.join(process.env.WORKFLOW_LOCAL_DATA_DIR ?? ".next/workflow-data", "terracdm-chat.json");
}

async function readLocalState(): Promise<LocalChatState> {
  try {
    return JSON.parse(await readFile(localStatePath(), "utf8")) as LocalChatState;
  } catch {
    return { threads: [], messages: [] };
  }
}

async function writeLocalState(state: LocalChatState) {
  const file = localStatePath();
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(state), "utf8");
}

function supabaseServer(): SupabaseClient | null {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
}

function threadFromRow(row: Record<string, unknown>, storage: ChatStorage): ChatThread {
  return {
    id: String(row.id),
    workspaceKey: String(row.workspace_key ?? "default"),
    agentRole: String(row.agent_role ?? "analyst"),
    title: row.title ? String(row.title) : undefined,
    entityIds: Array.isArray(row.entity_ids) ? row.entity_ids.map(String) : [],
    context: row.context && typeof row.context === "object" ? row.context as Record<string, unknown> : {},
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at ?? row.created_at),
    storage,
  };
}

function messageFromRow(row: Record<string, unknown>, storage: ChatStorage): StoredChatMessage {
  return {
    id: String(row.id),
    threadId: String(row.thread_id),
    sequence: Number(row.sequence),
    role: row.role as ChatRole,
    content: String(row.content),
    provider: row.provider ? String(row.provider) : undefined,
    model: row.model ? String(row.model) : undefined,
    metadata: row.metadata && typeof row.metadata === "object" ? row.metadata as Record<string, unknown> : {},
    createdAt: String(row.created_at),
    storage,
  };
}

export async function getChatThread(id: string): Promise<ChatThread | null> {
  const client = supabaseServer();
  if (client) {
    const { data, error } = await client.from("agent_threads").select("*").eq("id", id).maybeSingle();
    if (error) throw new Error(`chat thread read failed: ${error.message}`);
    return data ? threadFromRow(data, "supabase") : null;
  }

  const state = await readLocalState();
  return state.threads.find((thread) => thread.id === id) ?? null;
}

export async function getChatMessages(threadId: string): Promise<StoredChatMessage[]> {
  const client = supabaseServer();
  if (client) {
    const { data, error } = await client
      .from("agent_messages")
      .select("*")
      .eq("thread_id", threadId)
      .order("sequence", { ascending: true });
    if (error) throw new Error(`chat messages read failed: ${error.message}`);
    return (data ?? []).map((row) => messageFromRow(row, "supabase"));
  }

  const state = await readLocalState();
  return state.messages
    .filter((message) => message.threadId === threadId)
    .sort((left, right) => left.sequence - right.sequence);
}

export async function createChatThread(input: {
  title?: string;
  entityIds?: string[];
  context?: Record<string, unknown>;
  workspaceKey?: string;
}): Promise<ChatThread> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const workspaceKey = input.workspaceKey ?? "default";
  const entityIds = input.entityIds ?? [];
  const context = input.context ?? {};
  const client = supabaseServer();

  if (client) {
    const { data, error } = await client.from("agent_threads").insert({
      id,
      workspace_key: workspaceKey,
      agent_role: "analyst",
      title: input.title ?? null,
      entity_ids: entityIds,
      context,
    }).select("*").single();
    if (error) throw new Error(`chat thread create failed: ${error.message}`);
    return threadFromRow(data, "supabase");
  }

  const thread: ChatThread = { id, workspaceKey, agentRole: "analyst", title: input.title, entityIds, context, createdAt: now, updatedAt: now, storage: "local" };
  const state = await readLocalState();
  state.threads.push(thread);
  await writeLocalState(state);
  return thread;
}

export async function appendChatMessage(input: {
  threadId: string;
  role: ChatRole;
  content: string;
  provider?: string;
  model?: string;
  metadata?: Record<string, unknown>;
}): Promise<StoredChatMessage> {
  const content = input.content.trim();
  if (!content) throw new Error("Cannot persist an empty chat message");
  const client = supabaseServer();

  if (client) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const { data: latest, error: latestError } = await client
        .from("agent_messages")
        .select("sequence")
        .eq("thread_id", input.threadId)
        .order("sequence", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (latestError) throw new Error(`chat sequence read failed: ${latestError.message}`);

      const id = crypto.randomUUID();
      const sequence = Number(latest?.sequence ?? 0) + 1;
      const { data, error } = await client.from("agent_messages").insert({
        id,
        thread_id: input.threadId,
        sequence,
        role: input.role,
        content,
        provider: input.provider ?? null,
        model: input.model ?? null,
        metadata: input.metadata ?? {},
      }).select("*").single();
      if (!error) {
        await client.from("agent_threads").update({ updated_at: new Date().toISOString() }).eq("id", input.threadId);
        return messageFromRow(data, "supabase");
      }
      if (!/duplicate|unique/i.test(error.message) || attempt === 2) throw new Error(`chat message write failed: ${error.message}`);
    }
  }

  const state = await readLocalState();
  const thread = state.threads.find((candidate) => candidate.id === input.threadId);
  if (!thread) throw new Error("Chat thread not found");
  const id = crypto.randomUUID();
  const sequence = state.messages.filter((message) => message.threadId === input.threadId).reduce((max, message) => Math.max(max, message.sequence), 0) + 1;
  const message: StoredChatMessage = { id, threadId: input.threadId, sequence, role: input.role, content, provider: input.provider, model: input.model, metadata: input.metadata ?? {}, createdAt: new Date().toISOString(), storage: "local" };
  state.messages.push(message);
  thread.updatedAt = message.createdAt;
  await writeLocalState(state);
  return message;
}
