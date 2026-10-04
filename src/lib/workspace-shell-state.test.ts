import assert from "node:assert/strict";
import test from "node:test";
import { defaultWorkspaceShellState, readWorkspaceLocation, workspaceShellReducer, writeWorkspaceLocation } from "./workspace-shell-state";

test("lenses are visited once and inspectors survive lens changes", () => {
  let state = workspaceShellReducer(defaultWorkspaceShellState, { type: "open-inspector", content: { kind: "signal", id: "sig-1", sourceLens: "brief" } });
  state = workspaceShellReducer(state, { type: "pin-inspector" });
  state = workspaceShellReducer(state, { type: "open-lens", lens: "graph" });
  assert.equal(state.inspector?.content.id, "sig-1");
  assert.equal(state.inspector?.presentation, "split");
  assert.deepEqual(state.visitedLenses, ["map", "graph"]);
});

test("split widths are bounded", () => {
  assert.equal(workspaceShellReducer(defaultWorkspaceShellState, { type: "resize-split", width: 20 }).splitWidth, 340);
  assert.equal(workspaceShellReducer(defaultWorkspaceShellState, { type: "resize-split", width: 900 }).splitWidth, 620);
});

test("URL state round trips", () => {
  const state = workspaceShellReducer(
    workspaceShellReducer(defaultWorkspaceShellState, { type: "open-inspector", content: { kind: "entity", id: "entity 1", sourceLens: "entities", returnContext: { lens: "entities", query: "france 24", filter: "located", sort: "risk", scrollTop: 319, scopeId: "case-1", tab: "evidence" } } }),
    { type: "pin-inspector" },
  );
  const search = writeWorkspaceLocation(state);
  const restored = readWorkspaceLocation(search);
  assert.equal(restored.activeLens, "map");
  assert.deepEqual(restored.inspector, state.inspector);
});

test("URL state preserves unrelated search parameters", () => {
  const state = workspaceShellReducer(defaultWorkspaceShellState, { type: "open-inspector", content: { kind: "signal", id: "sig/1", sourceLens: "signals", returnContext: { lens: "signals", query: "Gaza & Sudan", filter: "high", sort: "newest" } } });
  const search = writeWorkspaceLocation(state, "?theme=dark");
  const restored = readWorkspaceLocation(search);
  assert.equal(new URLSearchParams(search).get("theme"), "dark");
  assert.deepEqual(restored.inspector?.content.returnContext, state.inspector?.content.returnContext);
  assert.equal(restored.inspector?.content.id, "sig/1");
});
