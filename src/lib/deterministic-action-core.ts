import type { DeterministicAction } from "./deterministic-actions";

export async function runDeterministicAction(action: DeterministicAction, value: string): Promise<unknown> {
  const target = value.trim();
  if (!target) throw new Error(`${action.inputLabel.toLowerCase()} is required`);

  const url = new URL(action.path, window.location.origin);
  const init: RequestInit = { method: action.method, headers: { "content-type": "application/json" } };
  if (action.method === "GET") {
    if (action.queryParam) url.searchParams.set(action.queryParam, target);
    if (action.id === "crypto") url.searchParams.set("chain", "bitcoin");
  } else {
    init.body = JSON.stringify({ target });
  }

  const response = await fetch(url, init);
  const payload = await response.json().catch(() => ({})) as { ok?: boolean; result?: unknown; error?: string };
  if (!response.ok || payload.ok === false) throw new Error(payload.error ?? `${action.label} action failed`);
  return payload.result ?? payload;
}
