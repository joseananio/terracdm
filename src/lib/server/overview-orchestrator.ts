import { start } from "workflow/api";
import { overviewWorkflow } from "@/src/workflows/overview";
import type { ChatContext } from "./chat";
import { createOverviewJob, getLatestOverview, getOverviewForContext, overviewContextHash, updateOverviewJob, type OverviewArtifact, type OverviewTrigger } from "./overview-store";
import type { BriefScope } from "../brief";

export type OverviewRequest = {
  trigger: OverviewTrigger;
  context?: ChatContext;
  force?: boolean;
  scope?: BriefScope;
};

const UI_OVERVIEW_MAX_AGE_MS = 60 * 60 * 1_000;

export async function requestOverview(input: OverviewRequest) {
  const contextHash = input.context ? overviewContextHash(input.context) : undefined;
  if (!input.force) {
    const cached = contextHash ? await getOverviewForContext(contextHash) : await getLatestOverview();
    const isFreshEnough = input.trigger !== "ui" || Date.now() - Date.parse(cached?.createdAt ?? "") < UI_OVERVIEW_MAX_AGE_MS;
    if (cached && isFreshEnough) return { status: "cached" as const, artifact: cached };
  }

  const timeBucket = Math.floor(Date.now() / (5 * 60 * 1_000));
  const scopeKey = JSON.stringify(input.scope ?? {});
  const dedupeKey = `${input.trigger}:${contextHash ?? timeBucket}:${scopeKey}`;
  const job = await createOverviewJob({ dedupeKey, trigger: input.trigger, contextHash });
  if (job.status === "queued" || job.status === "running") {
    if (job.workflowRunId) return { status: "running" as const, jobId: job.id, runId: job.workflowRunId };
    const run = await start(overviewWorkflow, [{ trigger: input.trigger, context: input.context, jobId: job.id, scope: input.scope }]);
    await updateOverviewJob(job.id, { workflowRunId: run.runId });
    return { status: "started" as const, jobId: job.id, runId: run.runId };
  }

  if (job.status === "completed" && !input.force) {
    const completed = contextHash ? await getOverviewForContext(contextHash) : await getLatestOverview();
    if (completed) return { status: "cached" as const, artifact: completed };
  }

  const run = await start(overviewWorkflow, [{ trigger: input.trigger, context: input.context, jobId: job.id, scope: input.scope }]);
  await updateOverviewJob(job.id, { workflowRunId: run.runId, status: "queued" });
  return { status: "started" as const, jobId: job.id, runId: run.runId };
}

export async function latestOverview(): Promise<OverviewArtifact | null> {
  return getLatestOverview();
}
