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
    workspaceShellReducer(defaultWorkspaceShellState, { type: "open-inspector", content: { kind: "entity", id: "entity 1", sourceLens: "entities" } }),
    { type: "pin-inspector" },
  );
  const search = writeWorkspaceLocation(state);
  const restored = readWorkspaceLocation(search);
  assert.equal(restored.activeLens, "map");
  assert.deepEqual(restored.inspector, state.inspector);
});
