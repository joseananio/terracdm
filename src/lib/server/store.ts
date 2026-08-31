import { createHash } from "node:crypto";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { CanonicalProviderSnapshot } from "../intelligence";
import { ingestObservations } from "./observation-repository";

type Watchlist = { id: string; name: string; entityIds: string[]; createdAt: string; storage: "supabase" | "memory" };
type AgentRun = { id: string; prompt: string; intent: string; summary: string; steps: string[]; evidence: string[]; createdAt: string; storage: "supabase" | "memory" };

const memoryWatchlists = new Map<string, Watchlist>();
const memoryRuns = new Map<string, AgentRun>();

function supabaseServer(): SupabaseClient | null {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
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

export async function persistIntelligence(snapshots: CanonicalProviderSnapshot[]) {
  ingestObservations(snapshots.flatMap((snapshot) => snapshot.observations));
  const client = supabaseServer();
  if (!client) return { storage: "memory" as const, persisted: false };
  const snapshotRows = snapshots.map((item) => {
    const payload = { observations: item.observations, error: item.error ?? null };
    const contentHash = createHash("sha256").update(JSON.stringify({ sourceId: item.source.id, domain: item.domain, status: item.status, payload })).digest("hex");
    return { layer: item.domain, source_id: item.source.id, status: item.status, fetched_at: item.fetchedAt, content_hash: contentHash, payload };
  });
  const eventRows = snapshots.flatMap((item) => item.observations.filter((observation) => observation.kind === "signal").map((observation) => ({ event_id: observation.id, layer: observation.domain, source_id: observation.source.id, observed_at: observation.observedAt, payload: observation })));
  const snapshotResult = await client.from("intelligence_snapshots").upsert(snapshotRows, { onConflict: "source_id,content_hash", ignoreDuplicates: true });
  if (snapshotResult.error) return { storage: "memory" as const, persisted: false, error: snapshotResult.error.message };
  if (eventRows.length) {
    const eventResult = await client.from("intelligence_events").upsert(eventRows, { onConflict: "event_id" });
    if (eventResult.error) return { storage: "supabase" as const, persisted: true, error: eventResult.error.message };
  }
  try {
    const channel = client.channel("terracdm-intelligence");
    const result = await channel.httpSend("source-update", { fetchedAt: new Date().toISOString(), domains: snapshots.map((item) => item.domain) });
    if (!result.success) throw new Error(result.error);
    await client.removeChannel(channel);
  } catch { /* persistence is still successful if broadcast is unavailable */ }
  return { storage: "supabase" as const, persisted: true };
}
