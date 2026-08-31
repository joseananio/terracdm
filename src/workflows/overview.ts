import { getSnapshot } from "@/src/lib/server/providers";
import { runOverview, type ChatContext, type OverviewResult } from "@/src/lib/server/chat";
import { saveOverviewArtifact, updateOverviewJob, type OverviewArtifact, type OverviewTrigger } from "@/src/lib/server/overview-store";
import { defaultBriefScope, type BriefScope } from "@/src/lib/brief";

export type OverviewWorkflowInput = {
  trigger: OverviewTrigger;
  context?: ChatContext;
  jobId?: string;
  workflowRunId?: string;
  scope?: BriefScope;
};

async function loadOverviewContext(context?: ChatContext): Promise<ChatContext> {
  "use step";
  if (context) return context;
  const snapshot = await getSnapshot();
  return {
    fetchedAt: new Date().toISOString(),
    viewport: { west: -180, south: -60, east: 180, north: 80 },
    observations: snapshot.observations,
    sourceStatuses: snapshot.snapshots.map((item) => ({ sourceId: item.source.id, status: item.status, error: item.error })),
  };
}

async function markOverviewRunning(jobId?: string) {
  "use step";
  if (jobId) await updateOverviewJob(jobId, { status: "running" });
}

async function generateOverview(context: ChatContext, scope: BriefScope): Promise<OverviewResult> {
  "use step";
  const rangeMs = scope.range === "current" ? 60 * 60 * 1_000 : scope.range === "6h" ? 6 * 60 * 60 * 1_000 : scope.range === "24h" ? 24 * 60 * 60 * 1_000 : 7 * 24 * 60 * 60 * 1_000;
  const cutoff = Date.now() - rangeMs;
  const geography = scope.geography?.trim().toLowerCase();
  const observations = (context.observations ?? []).filter((observation) => {
    if (scope.domains.length && !scope.domains.includes(observation.domain)) return false;
    if (Date.parse(observation.observedAt) < cutoff) return false;
    if (geography && !JSON.stringify(observation).toLowerCase().includes(geography)) return false;
    return !scope.watchlistOnly || (context.selectedEntityIds ?? []).includes(observation.id);
  });
  return runOverview({ ...context, observations }, scope);
}

async function persistOverview(input: OverviewWorkflowInput, context: ChatContext, result: OverviewResult) {
  "use step";
  return saveOverviewArtifact({ context, result, trigger: input.trigger, workflowRunId: input.workflowRunId, jobId: input.jobId });
}

async function markOverviewFailed(jobId: string | undefined, error: string) {
  "use step";
  if (jobId) await updateOverviewJob(jobId, { status: "failed", error });
}

export async function overviewWorkflow(input: OverviewWorkflowInput): Promise<OverviewArtifact> {
  "use workflow";
  const context = await loadOverviewContext(input.context);
  await markOverviewRunning(input.jobId);
  try {
    const result = await generateOverview(context, input.scope ?? defaultBriefScope);
    return await persistOverview(input, context, result);
  } catch (error) {
    await markOverviewFailed(input.jobId, error instanceof Error ? error.message : "Overview workflow failed");
    throw error;
  }
}
