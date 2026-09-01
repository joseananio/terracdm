import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { CanonicalProviderSnapshot, type Observation } from "../intelligence";
import { ingestObservations } from "./observation-repository";
import { providerSnapshotRevision, stableMaterialJson } from "./provider-revision";

type Watchlist = { id: string; name: string; entityIds: string[]; createdAt: string; storage: "supabase" | "memory" };
type AgentRun = { id: string; prompt: string; intent: string; summary: string; steps: string[]; evidence: string[]; createdAt: string; storage: "supabase" | "memory" };

const memoryWatchlists = new Map<string, Watchlist>();
const memoryRuns = new Map<string, AgentRun>();
const OBSERVATION_BATCH_SIZE = 500;
const REST_FILTER_BATCH_SIZE = 50;

function storageError(error: { code?: string; details?: string; hint?: string; message: string }) {
  return [error.code, error.message, error.details, error.hint].filter(Boolean).join(": ");
}

function supabaseServer(): SupabaseClient | null {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
}

function memoryStorageEnabled() {
  return process.env.OBSERVATION_STORAGE_MODE === "memory";
}

export async function saveAgentRun(run: Omit<AgentRun, "id" | "createdAt" | "storage">) {
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const client = supabaseServer();
  if (client) {
    const { error } = await client.from("agent_runs").insert({ id, intent: run.intent, prompt: run.prompt, summary: run.summary, steps: run.steps, evidence: run.evidence });
    if (!error) return { ...run, id, createdAt, storage: "supabase" as const };
  }
  const result = { ...run, id, createdAt, storage: "memory" as const };
  memoryRuns.set(id, result);
  return result;
}

export async function saveWatchlist(name: string, entityIds: string[]) {
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const client = supabaseServer();
  if (client) {
    const { error } = await client.from("watchlists").insert({ id, name, entity_ids: entityIds });
    if (!error) return { id, name, entityIds, createdAt, storage: "supabase" as const };
  }
  const result = { id, name, entityIds, createdAt, storage: "memory" as const };
  memoryWatchlists.set(id, result);
  return result;
}

export async function listAgentRuns() { return [...memoryRuns.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)); }

function observationSearchText(observation: Observation) {
  return [
    observation.name,
    observation.description,
    observation.location?.label,
    observation.domain,
    observation.subdomainId,
    observation.source.id,
    observation.source.name,
    observation.providerId,
    JSON.stringify(observation.properties ?? {}),
  ].filter(Boolean).join(" ");
}

function observationRow(observation: Observation) {
  const coordinates = observation.location?.coordinates;
  return {
    observation_id: observation.id,
    kind: observation.kind,
    domain: observation.domain.toLowerCase(),
    subdomain_id: observation.subdomainId,
    source_id: observation.source.id.toLowerCase(),
    source_name: observation.source.name,
    provider_id: observation.providerId,
    pack_id: observation.packId ?? null,
    signal_type: observation.signalType ?? null,
    name: observation.name,
    description: observation.description,
    risk: observation.risk,
    risk_score: observation.riskScore,
    observed_at: observation.observedAt,
    location_label: observation.location?.label ?? null,
    location_wkt: coordinates ? `POINT(${coordinates.lng} ${coordinates.lat})` : null,
    search_text: observationSearchText(observation),
    payload: observation,
    updated_at: new Date().toISOString(),
  };
}

async function upsertObservationRows(client: SupabaseClient, observations: Observation[]) {
  const latest = new Map<string, Observation>();
  for (const observation of observations) {
    const current = latest.get(observation.id);
    if (!current || observation.observedAt > current.observedAt) latest.set(observation.id, observation);
  }
  const rows = [...latest.values()].map(observationRow);
  for (let start = 0; start < rows.length; start += OBSERVATION_BATCH_SIZE) {
    const batch = rows.slice(start, start + OBSERVATION_BATCH_SIZE);
    const existingPayloads = new Map<string, string>();
    for (let readStart = 0; readStart < batch.length; readStart += REST_FILTER_BATCH_SIZE) {
      const ids = batch.slice(readStart, readStart + REST_FILTER_BATCH_SIZE).map((row) => row.observation_id);
      const { data: existing, error: readError } = await client.from("intelligence_observations").select("observation_id,payload").in("observation_id", ids);
      if (readError) return readError;
      for (const row of existing ?? []) existingPayloads.set(String(row.observation_id), stableMaterialJson(row.payload));
    }
    const changed = batch.filter((row) => existingPayloads.get(row.observation_id) !== stableMaterialJson(row.payload));
    if (!changed.length) continue;
    const { error } = await client.from("intelligence_observations").upsert(changed.map(({ location_wkt, ...row }) => ({ ...row, location: location_wkt })), { onConflict: "observation_id" });
    if (error) return error;
  }
  return null;
}

async function upsertEventRows(client: SupabaseClient, events: Array<Record<string, unknown>>) {
  for (let start = 0; start < events.length; start += OBSERVATION_BATCH_SIZE) {
    const batch = events.slice(start, start + OBSERVATION_BATCH_SIZE);
    const existingPayloads = new Map<string, string>();
    for (let readStart = 0; readStart < batch.length; readStart += REST_FILTER_BATCH_SIZE) {
      const ids = batch.slice(readStart, readStart + REST_FILTER_BATCH_SIZE).map((event) => String(event.event_id));
      const { data: existing, error: readError } = await client.from("intelligence_events").select("event_id,payload").in("event_id", ids);
      if (readError) return readError;
      for (const row of existing ?? []) existingPayloads.set(String(row.event_id), stableMaterialJson(row.payload));
    }
    const changed = batch.filter((event) => existingPayloads.get(String(event.event_id)) !== stableMaterialJson(event.payload));
    if (!changed.length) continue;
    const { error } = await client.from("intelligence_events").upsert(changed, { onConflict: "event_id" });
    if (error) return error;
  }
  return null;
}

export async function persistIntelligence(snapshots: CanonicalProviderSnapshot[]) {
  const observations = snapshots.flatMap((snapshot) => snapshot.observations);
  const client = memoryStorageEnabled() ? null : supabaseServer();
  if (!client) {
    if (!memoryStorageEnabled()) throw new Error("Supabase intelligence storage is not configured");
    ingestObservations(observations);
    return { storage: "memory" as const, persisted: false };
  }
  if (!snapshots.length) return { storage: "supabase" as const, persisted: true, changed: false };

  const snapshotsByProvider = new Map<string, CanonicalProviderSnapshot>();
  for (const snapshot of snapshots) {
    const current = snapshotsByProvider.get(snapshot.providerId);
    if (!current || snapshot.fetchedAt > current.fetchedAt) snapshotsByProvider.set(snapshot.providerId, snapshot);
  }
  const providerSnapshots = [...snapshotsByProvider.values()];
  const revisions = new Map(providerSnapshots.map((snapshot) => [snapshot.providerId, providerSnapshotRevision(snapshot)]));
  const storedRevisionByProvider = new Map<string, string>();
  await Promise.all(providerSnapshots.map(async (snapshot) => {
    const { data, error } = await client.from("intelligence_snapshots")
      .select("content_hash")
      .eq("source_id", snapshot.source.id)
      .order("fetched_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(`Failed to read provider revision for ${snapshot.providerId}: ${error.message}`);
    if (data?.content_hash) storedRevisionByProvider.set(snapshot.providerId, String(data.content_hash));
  }));
  const changedSnapshots = providerSnapshots.filter((snapshot) => storedRevisionByProvider.get(snapshot.providerId) !== revisions.get(snapshot.providerId));
  if (!changedSnapshots.length) return { storage: "supabase" as const, persisted: true, changed: false };

  const changedObservations = changedSnapshots.flatMap((snapshot) => snapshot.observations);
  const snapshotRows = changedSnapshots.map((item) => {
    const payload = { observations: item.observations, error: item.error ?? null };
    const contentHash = revisions.get(item.providerId)!;
    return { layer: item.domain, source_id: item.source.id, status: item.status, fetched_at: item.fetchedAt, content_hash: contentHash, payload };
  });
  const eventsById = new Map<string, Record<string, unknown>>();
  for (const item of changedSnapshots) {
    for (const observation of item.observations) {
      if (observation.kind !== "signal") continue;
      const current = eventsById.get(observation.id);
      if (!current || observation.observedAt > String(current.observed_at)) {
        eventsById.set(observation.id, { event_id: observation.id, layer: observation.domain, source_id: observation.source.id, observed_at: observation.observedAt, payload: observation });
      }
    }
  }
  const eventRows = [...eventsById.values()];
  const snapshotResult = await client.from("intelligence_snapshots").upsert(snapshotRows, { onConflict: "source_id,content_hash", ignoreDuplicates: true });
  if (snapshotResult.error) throw new Error(`Failed to persist intelligence snapshots: ${storageError(snapshotResult.error)}`);
  if (eventRows.length) {
    const eventError = await upsertEventRows(client, eventRows);
    if (eventError) throw new Error(`Failed to persist intelligence events: ${storageError(eventError)}`);
  }
  const observationError = await upsertObservationRows(client, changedObservations);
  if (observationError) throw new Error(`Failed to persist intelligence observations: ${storageError(observationError)}`);
  const channel = client.channel("terracdm-intelligence");
  try {
    const result = await channel.httpSend("source-update", { fetchedAt: new Date().toISOString(), domains: changedSnapshots.map((item) => item.domain) });
    if (!result.success) throw new Error(result.error);
  } catch (error) {
    console.warn("Failed to broadcast intelligence update", error);
  } finally {
    try { await client.removeChannel(channel); } catch { /* Broadcast cleanup is best-effort. */ }
  }
  return { storage: "supabase" as const, persisted: true, changed: true, changedProviders: changedSnapshots.map((snapshot) => snapshot.providerId) };
}
