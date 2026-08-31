import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { observationsToEntities, observationsToSignals } from "../catalog/observations";
import type { ChatContext, OverviewResult } from "./chat";
import { defaultBriefScope, type BriefDevelopment, type BriefScope } from "../brief";

export type OverviewTrigger = "ui" | "incoming-data" | "cron" | "manual";
export type OverviewStorage = "supabase" | "memory";

export type OverviewArtifact = OverviewResult & {
  id: string;
  workspaceKey: string;
  contextHash: string;
  trigger: OverviewTrigger;
  createdAt: string;
  storage: OverviewStorage;
};

export type OverviewJob = {
  id: string;
  workspaceKey: string;
  dedupeKey: string;
  trigger: OverviewTrigger;
  status: "queued" | "running" | "completed" | "failed";
  contextHash?: string;
  workflowRunId?: string;
  error?: string;
  requestedAt: string;
  startedAt?: string;
  completedAt?: string;
};

type LocalOverviewState = { artifacts: OverviewArtifact[]; jobs: OverviewJob[] };

function localStatePath() {
  return path.join(process.env.WORKFLOW_LOCAL_DATA_DIR ?? ".next/workflow-data", "terracdm-overview.json");
}

async function readLocalState(): Promise<LocalOverviewState> {
  try {
    return JSON.parse(await readFile(localStatePath(), "utf8")) as LocalOverviewState;
  } catch {
    return { artifacts: [], jobs: [] };
  }
}

async function writeLocalState(state: LocalOverviewState) {
  const file = localStatePath();
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(state), "utf8");
}

function supabaseServer(): SupabaseClient | null {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
}

function normalizeContext(context: ChatContext) {
  return {
    viewport: context.viewport,
    selectedEntityIds: [...(context.selectedEntityIds ?? [])].sort(),
    observations: (context.observations ?? []).map(({ id, kind, packId, providerId, domain, signalType, subdomainId, observedAt, source }) => ({ id, kind, packId, providerId, domain, signalType, subdomainId, observedAt, source })).sort((left, right) => left.id.localeCompare(right.id)),
    sourceStatuses: (context.sourceStatuses ?? []).slice().sort((left, right) => left.sourceId.localeCompare(right.sourceId)),
  };
}

export function overviewContextHash(context: ChatContext) {
  return createHash("sha256").update(JSON.stringify(normalizeContext(context))).digest("hex");
}

function artifactFromRow(row: Record<string, unknown>): OverviewArtifact {
  return {
    id: String(row.id),
    workspaceKey: String(row.workspace_key ?? "default"),
    contextHash: String(row.context_hash),
    trigger: row.trigger as OverviewTrigger,
    overview: String(row.overview ?? ""),
    highlights: Array.isArray(row.highlights) ? row.highlights.map(String) : [],
    suggestedQueries: Array.isArray(row.suggested_queries) ? row.suggested_queries.map(String) : [],
    developments: Array.isArray(row.developments) ? row.developments as BriefDevelopment[] : [],
    scope: row.scope && typeof row.scope === "object" ? row.scope as BriefScope : defaultBriefScope,
    helpers: Array.isArray(row.helpers) ? row.helpers as OverviewResult["helpers"] : [],
    provider: (row.provider ?? "deterministic") as OverviewResult["provider"],
    model: String(row.model ?? "local-context"),
    fallback: Boolean(row.fallback),
    generatedAt: String(row.created_at),
    createdAt: String(row.created_at),
    storage: "supabase",
  };
}

function jobFromRow(row: Record<string, unknown>): OverviewJob {
  return {
    id: String(row.id),
    workspaceKey: String(row.workspace_key ?? "default"),
    dedupeKey: String(row.dedupe_key),
    trigger: row.trigger as OverviewTrigger,
    status: row.status as OverviewJob["status"],
    contextHash: row.context_hash ? String(row.context_hash) : undefined,
    workflowRunId: row.workflow_run_id ? String(row.workflow_run_id) : undefined,
    error: row.error ? String(row.error) : undefined,
    requestedAt: String(row.requested_at),
    startedAt: row.started_at ? String(row.started_at) : undefined,
    completedAt: row.completed_at ? String(row.completed_at) : undefined,
  };
}

export async function getLatestOverview(workspaceKey = "default") {
  const client = supabaseServer();
  if (client) {
    const { data, error } = await client.from("overview_artifacts").select("*").eq("workspace_key", workspaceKey).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (error) throw new Error(`overview read failed: ${error.message}`);
    return data ? artifactFromRow(data) : null;
  }
  const state = await readLocalState();
  return state.artifacts.filter((artifact) => artifact.workspaceKey === workspaceKey).sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0] ?? null;
}

export async function listOverviews(workspaceKey = "default", limit = 20) {
  const client = supabaseServer();
  if (client) {
    const { data, error } = await client.from("overview_artifacts").select("*").eq("workspace_key", workspaceKey).order("created_at", { ascending: false }).limit(limit);
    if (error) throw new Error(`overview history read failed: ${error.message}`);
    return (data ?? []).map(artifactFromRow);
  }
  const state = await readLocalState();
  return state.artifacts.filter((artifact) => artifact.workspaceKey === workspaceKey).sort((left, right) => right.createdAt.localeCompare(left.createdAt)).slice(0, limit);
}

export async function updateOverviewArtifact(id: string, patch: { overview?: string; developments?: BriefDevelopment[] }) {
  const client = supabaseServer();
  if (client) {
    const updates = { ...(patch.overview !== undefined ? { overview: patch.overview } : {}), ...(patch.developments ? { developments: patch.developments } : {}), updated_at: new Date().toISOString() };
    const { data, error } = await client.from("overview_artifacts").update(updates).eq("id", id).select("*").single();
    if (error) throw new Error(`brief update failed: ${error.message}`);
    return artifactFromRow(data);
  }
  const state = await readLocalState();
  const current = state.artifacts.find((artifact) => artifact.id === id);
  if (!current) return null;
  const updated = { ...current, ...patch };
  state.artifacts = state.artifacts.map((artifact) => artifact.id === id ? updated : artifact);
  await writeLocalState(state);
  return updated;
}

export async function getOverviewForContext(contextHash: string, workspaceKey = "default") {
  const client = supabaseServer();
  if (client) {
    const { data, error } = await client.from("overview_artifacts").select("*").eq("workspace_key", workspaceKey).eq("context_hash", contextHash).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (error) throw new Error(`overview context read failed: ${error.message}`);
    return data ? artifactFromRow(data) : null;
  }
  const state = await readLocalState();
  return state.artifacts.filter((artifact) => artifact.workspaceKey === workspaceKey && artifact.contextHash === contextHash).sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0] ?? null;
}

export async function createOverviewJob(input: { dedupeKey: string; trigger: OverviewTrigger; contextHash?: string; workspaceKey?: string }) {
  const workspaceKey = input.workspaceKey ?? "default";
  const client = supabaseServer();
  if (client) {
    const payload = { workspace_key: workspaceKey, dedupe_key: input.dedupeKey, trigger: input.trigger, context_hash: input.contextHash ?? null };
    const { data, error } = await client.from("overview_jobs").upsert(payload, { onConflict: "dedupe_key", ignoreDuplicates: true }).select("*").maybeSingle();
    if (error) throw new Error(`overview job create failed: ${error.message}`);
    if (data) return jobFromRow(data);
    const { data: existing, error: existingError } = await client.from("overview_jobs").select("*").eq("dedupe_key", input.dedupeKey).single();
    if (existingError) throw new Error(`overview job read failed: ${existingError.message}`);
    return jobFromRow(existing);
  }
  const state = await readLocalState();
  const existing = state.jobs.find((job) => job.dedupeKey === input.dedupeKey);
  if (existing) return existing;
  const job: OverviewJob = { id: crypto.randomUUID(), workspaceKey, dedupeKey: input.dedupeKey, trigger: input.trigger, status: "queued", contextHash: input.contextHash, requestedAt: new Date().toISOString() };
  state.jobs.push(job);
  await writeLocalState(state);
  return job;
}

export async function updateOverviewJob(id: string, patch: Partial<Pick<OverviewJob, "status" | "workflowRunId" | "error">>) {
  const now = new Date().toISOString();
  const updates = {
    ...(patch.status ? { status: patch.status } : {}),
    ...(patch.workflowRunId ? { workflow_run_id: patch.workflowRunId } : {}),
    ...(patch.error ? { error: patch.error } : {}),
    ...(patch.status === "running" ? { started_at: now } : {}),
    ...(patch.status === "completed" || patch.status === "failed" ? { completed_at: now } : {}),
  };
  const client = supabaseServer();
  if (client) {
    const { data, error } = await client.from("overview_jobs").update(updates).eq("id", id).select("*").single();
    if (error) throw new Error(`overview job update failed: ${error.message}`);
    return jobFromRow(data);
  }
  const state = await readLocalState();
  const current = state.jobs.find((job) => job.id === id);
  if (!current) return null;
  const updated = { ...current, ...patch, ...(patch.status === "running" ? { startedAt: now } : {}), ...(patch.status === "completed" || patch.status === "failed" ? { completedAt: now } : {}) };
  state.jobs = state.jobs.map((job) => job.id === id ? updated : job);
  await writeLocalState(state);
  return updated;
}

export async function saveOverviewArtifact(input: { context: ChatContext; result: OverviewResult; trigger: OverviewTrigger; workflowRunId?: string; jobId?: string; workspaceKey?: string }) {
  const workspaceKey = input.workspaceKey ?? "default";
  const contextHash = overviewContextHash(input.context);
  const row = {
    workspace_key: workspaceKey,
    context_hash: contextHash,
    trigger: input.trigger,
    overview: input.result.overview,
    highlights: input.result.highlights,
    suggested_queries: input.result.suggestedQueries,
    developments: input.result.developments,
    scope: input.result.scope,
    helpers: input.result.helpers,
    provider: input.result.provider,
    model: input.result.model,
    fallback: input.result.fallback,
    source_fetched_at: input.context.fetchedAt ?? null,
    signal_count: observationsToSignals(input.context.observations ?? []).length,
    entity_count: observationsToEntities(input.context.observations ?? []).length,
    workflow_run_id: input.workflowRunId ?? null,
  };
  const client = supabaseServer();
  if (client) {
    const { data, error } = await client.from("overview_artifacts").insert(row).select("*").single();
    if (error) {
      if (input.jobId) await updateOverviewJob(input.jobId, { status: "failed", error: error.message });
      throw new Error(`overview artifact write failed: ${error.message}`);
    }
    if (input.jobId) await updateOverviewJob(input.jobId, { status: "completed" });
    return artifactFromRow(data);
  }
  const createdAt = new Date().toISOString();
  const artifact: OverviewArtifact = { ...input.result, id: crypto.randomUUID(), workspaceKey, contextHash, trigger: input.trigger, createdAt, storage: "memory" };
  const state = await readLocalState();
  state.artifacts.push(artifact);
  if (input.jobId) state.jobs = state.jobs.map((job) => job.id === input.jobId ? { ...job, status: "completed", completedAt: createdAt } : job);
  await writeLocalState(state);
  return artifact;
}
