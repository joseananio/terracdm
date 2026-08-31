export type AgentResult = {
  traceId: string;
  intent: string;
  summary: string;
  steps: string[];
  evidence: string[];
  sources: string[];
  data?: unknown;
  storage?: string;
};

export async function runAgentCommand(command: string, context?: { entityIds?: string[] }): Promise<AgentResult> {
  const response = await fetch("/api/agent", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ command, context }) });
  const payload = await response.json() as AgentResult & { error?: string };
  if (!response.ok) throw new Error(payload.error ?? "Agent request failed");
  return payload;
}
