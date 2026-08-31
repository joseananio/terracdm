import "server-only";

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { CaseEvent, CaseItem, CaseNote, CreateCaseInput, IntelligenceCase } from "../cases";

const localFile = path.join(process.cwd(), ".next", "workflow-data", "terracdm-cases.json");

function client(): SupabaseClient | null {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
}

async function readLocal(): Promise<IntelligenceCase[]> {
  try { return JSON.parse(await readFile(localFile, "utf8")) as IntelligenceCase[]; }
  catch { return []; }
}

async function writeLocal(cases: IntelligenceCase[]) {
  await mkdir(path.dirname(localFile), { recursive: true });
  await writeFile(localFile, JSON.stringify(cases), "utf8");
}

function fromRow(row: Record<string, unknown>): IntelligenceCase {
  return {
    id: String(row.id), workspaceKey: String(row.workspace_key ?? "default"), title: String(row.title), summary: String(row.summary ?? ""), assessment: String(row.assessment ?? ""),
    status: row.status as IntelligenceCase["status"], risk: row.risk as IntelligenceCase["risk"], confidence: row.confidence as IntelligenceCase["confidence"],
    items: Array.isArray(row.items) ? row.items as CaseItem[] : [], notes: Array.isArray(row.notes) ? row.notes as CaseNote[] : [], events: Array.isArray(row.events) ? row.events as CaseEvent[] : [],
    createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  };
}

function toRow(value: IntelligenceCase) {
  return { id: value.id, workspace_key: value.workspaceKey, title: value.title, summary: value.summary, assessment: value.assessment, status: value.status, risk: value.risk, confidence: value.confidence, items: value.items, notes: value.notes, events: value.events, created_at: value.createdAt, updated_at: value.updatedAt };
}

function mergeById<T extends { id: string }>(current: T[], incoming: T[]) {
  const currentById = new Map(current.map((value) => [value.id, value]));
  const incomingIds = new Set(incoming.map((value) => value.id));
  return [
    ...incoming.map((value) => ({ ...currentById.get(value.id), ...value })),
    ...current.filter((value) => !incomingIds.has(value.id)),
  ];
}

function mergeItems(current: CaseItem[], incoming: CaseItem[]) {
  const merged = mergeById(current, incoming);
  const unique = new Map<string, CaseItem>();
  for (const item of merged) unique.set(`${item.kind}:${item.objectId}`, item);
  return [...unique.values()];
}

export async function listCases(workspaceKey = "default") {
  const supabase = client();
  if (supabase) {
    const { data, error } = await supabase.from("cases").select("*").eq("workspace_key", workspaceKey).order("updated_at", { ascending: false });
    if (!error) return (data ?? []).map(fromRow);
  }
  return (await readLocal()).filter((item) => item.workspaceKey === workspaceKey).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function createCase(input: CreateCaseInput, workspaceKey = "default") {
  const now = new Date().toISOString();
  const value: IntelligenceCase = {
    id: crypto.randomUUID(), workspaceKey, title: input.title.trim(), summary: input.summary?.trim() ?? "", assessment: input.assessment?.trim() ?? "", status: input.status ?? "active", risk: input.risk ?? "medium", confidence: input.confidence ?? "medium", items: input.items ?? [], notes: [],
    events: [{ id: crypto.randomUUID(), type: "created", text: "Case created", createdAt: now }, ...(input.items ?? []).map((item): CaseEvent => ({ id: crypto.randomUUID(), type: "evidence", text: `Added ${item.name}`, objectKind: item.kind === "brief" ? undefined : item.kind, objectId: item.kind === "brief" ? undefined : item.objectId, createdAt: now }))], createdAt: now, updatedAt: now,
  };
  const supabase = client();
  if (supabase) {
    const { data, error } = await supabase.from("cases").insert(toRow(value)).select("*").single();
    if (!error && data) return fromRow(data);
  }
  const cases = await readLocal(); cases.push(value); await writeLocal(cases); return value;
}

export async function updateCase(id: string, patch: Partial<Pick<IntelligenceCase, "title" | "summary" | "assessment" | "status" | "risk" | "confidence" | "items" | "notes" | "events">>, workspaceKey = "default") {
  const current = (await listCases(workspaceKey)).find((item) => item.id === id);
  if (!current) return null;
  const updated: IntelligenceCase = {
    ...current,
    ...patch,
    ...(patch.items ? { items: mergeItems(current.items, patch.items) } : {}),
    ...(patch.notes ? { notes: mergeById(current.notes, patch.notes) } : {}),
    ...(patch.events ? { events: mergeById(current.events, patch.events) } : {}),
    updatedAt: new Date().toISOString(),
  };
  const supabase = client();
  if (supabase) {
    const { data, error } = await supabase.from("cases").update(toRow(updated)).eq("id", id).eq("workspace_key", workspaceKey).select("*").single();
    if (!error && data) return fromRow(data);
  }
  const cases = await readLocal();
  const index = cases.findIndex((item) => item.id === id);
  if (index >= 0) cases[index] = updated; else cases.push(updated);
  await writeLocal(cases); return updated;
}
