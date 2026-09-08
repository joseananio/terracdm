import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import type { Observation } from "../intelligence";
import { stableMaterialJson } from "./provider-revision";
import { loadOptionalInstanceConfig } from "./instance-config";

type Mapping = { ontologyPackageId: string; typeRef: string };
type Reference = { provider: ProviderRef; status: "canonical" | "unresolved" | "redirected"; canonicalId: string | null; canonicalRevision: number | null; decisionId: string | null };
type ProviderRef = { namespace: string; id: string; revision: string };
type Correction = { id: string; operationKey: string; provider: ProviderRef; expectedProviderRevision: string; canonicalId: string | null; canonicalRevision: number; kind: string; rationale: string };

function config() {
  const baseUrl = process.env.CRAVEN_BASE_URL?.trim();
  const projectId = process.env.CRAVEN_PROJECT_ID?.trim();
  const token = process.env.CRAVEN_API_TOKEN?.trim();
  const mappings = loadOptionalInstanceConfig()?.config.semanticBackend?.mappings;
  if (!baseUrl || !projectId || !token || !mappings) return null;
  return { baseUrl: baseUrl.replace(/\/$/, ""), projectId, token, mappings: mappings as Record<string, Mapping> };
}

function database() {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
}

function revision(observation: Observation) {
  return createHash("sha256").update(stableMaterialJson(observation)).digest("hex");
}

async function call<T>(settings: NonNullable<ReturnType<typeof config>>, path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${settings.baseUrl}/api/v1/projects/${settings.projectId}${path}`, {
    ...init, headers: { authorization: `Bearer ${settings.token}`, "content-type": "application/json", ...init?.headers }, signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw Object.assign(new Error(`Craven returned ${response.status}`), { status: response.status });
  return response.json() as Promise<T>;
}

function observationContract(observation: Observation, mapping: Mapping) {
  const provider = { namespace: observation.source.id, id: observation.providerId || observation.id, revision: revision(observation) };
  return { contractVersion: 1, operationKey: `terracdm:${provider.namespace}:${provider.id}:${provider.revision}`, clientNamespace: "terracdm",
    provider, kind: observation.kind, ontologyPackageId: mapping.ontologyPackageId, typeRef: mapping.typeRef,
    observedAt: observation.observedAt, validFrom: observation.observedAt, validTo: null, names: [observation.name],
    attributes: { domain: observation.domain, subdomainId: observation.subdomainId, description: observation.description,
      risk: observation.risk, riskScore: observation.riskScore, location: observation.location ?? null, properties: observation.properties ?? {} },
    evidence: [{ locator: observation.url ?? observation.source.url ?? `terracdm:${observation.source.id}:${observation.id}`,
      selector: null, capturedAt: observation.observedAt, mediaType: "application/json", sha256: null }], localStateRef: observation.id };
}

async function saveReference(observation: Observation, reference: Reference) {
  const client = database(); if (!client) return;
  const { error } = await client.from("semantic_observation_links").upsert({ observation_id: observation.id,
    provider_namespace: reference.provider.namespace, provider_id: reference.provider.id, provider_revision: reference.provider.revision,
    canonical_id: reference.canonicalId, canonical_revision: reference.canonicalRevision, decision_id: reference.decisionId,
    status: reference.status, updated_at: new Date().toISOString() }, { onConflict: "provider_namespace,provider_id" });
  if (error) throw new Error(`Failed to save Craven reference: ${error.message}`);
}

async function applyCorrections(settings: NonNullable<ReturnType<typeof config>>) {
  const client = database(); if (!client) return 0;
  const { data: cursorRow } = await client.from("semantic_sync_state").select("cursor").eq("backend", "craven").maybeSingle();
  const suffix = cursorRow?.cursor ? `?cursor=${encodeURIComponent(cursorRow.cursor)}` : "";
  const page = await call<{ corrections: Correction[]; nextCursor: string | null }>(settings, `/integrations/corrections${suffix}`);
  for (const correction of page.corrections) {
    const { data: link } = await client.from("semantic_observation_links").select("observation_id,provider_revision").eq("provider_namespace", correction.provider.namespace).eq("provider_id", correction.provider.id).maybeSingle();
    const conflict = !link || link.provider_revision !== correction.expectedProviderRevision;
    if (!conflict) await client.from("semantic_observation_links").update({ canonical_id: correction.canonicalId,
      canonical_revision: correction.canonicalRevision, status: correction.canonicalId ? "canonical" : "unresolved", updated_at: new Date().toISOString() })
      .eq("provider_namespace", correction.provider.namespace).eq("provider_id", correction.provider.id);
    await call(settings, `/integrations/corrections/${correction.id}/ack`, { method: "POST", body: JSON.stringify({ contractVersion: 1,
      operationKey: correction.operationKey, status: conflict ? "conflict" : "committed", provider: correction.provider,
      committedAt: conflict ? null : new Date().toISOString(), currentProviderRevision: link?.provider_revision ?? null,
      detail: conflict ? "TerraCDM provider revision changed before correction application." : null }) });
  }
  if (page.nextCursor) await client.from("semantic_sync_state").upsert({ backend: "craven", cursor: page.nextCursor, updated_at: new Date().toISOString() });
  return page.corrections.length;
}

/** Optional synchronization: local provider storage succeeds even when this returns standalone. */
export async function synchronizeWithCraven(observations: Observation[]) {
  const settings = config();
  if (!settings) return { mode: "standalone" as const, synced: 0, failed: 0, corrections: 0, reason: "Craven integration is not configured." };
  let synced = 0, failed = 0;
  for (const observation of observations) {
    const mapping = settings.mappings[observation.domain]; if (!mapping) continue;
    try { const reference = await call<Reference>(settings, "/integrations/observations", { method: "POST", body: JSON.stringify(observationContract(observation, mapping)) });
      await saveReference(observation, reference); synced += 1;
    } catch (error) { failed += 1; console.warn("Craven observation sync failed", { observationId: observation.id, error }); }
  }
  let corrections = 0;
  try { corrections = await applyCorrections(settings); } catch (error) { console.warn("Craven correction sync failed", error); }
  return { mode: "connected" as const, synced, failed, corrections, reason: failed ? "Some observations remain queued for retry." : null };
}
