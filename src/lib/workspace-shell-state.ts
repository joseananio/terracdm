export const workspaceLenses = ["signals", "brief", "cases", "entities", "graph", "map", "settings"] as const;

export type WorkspaceLens = (typeof workspaceLenses)[number];
export type InspectorKind = "signal" | "entity" | "case" | "evidence" | "node" | "note";
export type InspectorRef = { kind: InspectorKind; id: string; sourceLens: WorkspaceLens; title?: string; body?: string; updatedAt?: string };
export type InspectorState = { content: InspectorRef; presentation: "overlay" | "split" };

export type WorkspaceShellState = {
  activeLens: WorkspaceLens;
  visitedLenses: WorkspaceLens[];
  inspector: InspectorState | null;
  splitWidth: number;
};

export type WorkspaceShellAction =
  | { type: "open-lens"; lens: WorkspaceLens }
  | { type: "open-inspector"; content: InspectorRef }
  | { type: "close-inspector" }
  | { type: "pin-inspector" }
  | { type: "unpin-inspector" }
  | { type: "resize-split"; width: number }
  | { type: "restore"; state: Partial<WorkspaceShellState> };

export const defaultWorkspaceShellState: WorkspaceShellState = {
  activeLens: "map",
  visitedLenses: ["map"],
  inspector: null,
  splitWidth: 420,
};

export function isWorkspaceLens(value: string | null): value is WorkspaceLens {
  return workspaceLenses.includes(value as WorkspaceLens);
}

export function clampSplitWidth(width: number) {
  return Math.min(620, Math.max(340, Math.round(width)));
}

export function workspaceShellReducer(state: WorkspaceShellState, action: WorkspaceShellAction): WorkspaceShellState {
  switch (action.type) {
    case "open-lens":
      return { ...state, activeLens: action.lens, visitedLenses: state.visitedLenses.includes(action.lens) ? state.visitedLenses : [...state.visitedLenses, action.lens] };
    case "open-inspector":
      return { ...state, inspector: { content: action.content, presentation: state.inspector?.presentation ?? "overlay" } };
    case "close-inspector":
      return { ...state, inspector: null };
    case "pin-inspector":
      return state.inspector ? { ...state, inspector: { ...state.inspector, presentation: "split" } } : state;
    case "unpin-inspector":
      return state.inspector ? { ...state, inspector: { ...state.inspector, presentation: "overlay" } } : state;
    case "resize-split":
      return { ...state, splitWidth: clampSplitWidth(action.width) };
    case "restore": {
      const activeLens = action.state.activeLens ?? state.activeLens;
      return {
        ...state,
        ...action.state,
        activeLens,
        splitWidth: clampSplitWidth(action.state.splitWidth ?? state.splitWidth),
        visitedLenses: Array.from(new Set([...(action.state.visitedLenses ?? state.visitedLenses), activeLens])),
      };
    }
  }
}

export function readWorkspaceLocation(search: string): Partial<WorkspaceShellState> {
  const params = new URLSearchParams(search);
  const lens = params.get("lens");
  const kind = params.get("inspect");
  const id = params.get("id");
  const source = params.get("from");
  const presentation: InspectorState["presentation"] = params.get("panel") === "split" ? "split" : "overlay";
  const activeLens = isWorkspaceLens(lens) ? lens : undefined;
  const inspector = kind && id && ["signal", "entity", "case", "evidence", "node", "note"].includes(kind)
    ? { content: { kind: kind as InspectorKind, id, sourceLens: isWorkspaceLens(source) ? source : activeLens ?? "map" }, presentation }
    : undefined;
  return { ...(activeLens ? { activeLens } : {}), ...(inspector ? { inspector } : {}) };
}

export function writeWorkspaceLocation(state: WorkspaceShellState, currentSearch = "") {
  const params = new URLSearchParams(currentSearch);
  params.set("lens", state.activeLens);
  for (const key of ["inspect", "id", "from", "panel"]) params.delete(key);
  if (state.inspector) {
    params.set("inspect", state.inspector.content.kind);
    params.set("id", state.inspector.content.id);
    params.set("from", state.inspector.content.sourceLens);
    if (state.inspector.presentation === "split") params.set("panel", "split");
  }
  return params.toString();
}
