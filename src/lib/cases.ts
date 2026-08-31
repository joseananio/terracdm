export type CaseStatus = "active" | "watching" | "closed";
export type CaseItemKind = "signal" | "entity" | "brief";
export type CaseEvidenceRole = "supporting" | "contradicting" | "context";

export type CaseItem = {
  id: string;
  kind: CaseItemKind;
  objectId: string;
  name: string;
  description?: string;
  role: CaseEvidenceRole;
  note?: string;
  addedAt: string;
};

export type CaseNote = {
  id: string;
  body: string;
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
};

export type CaseEvent = {
  id: string;
  type: "created" | "status" | "assessment" | "evidence" | "note";
  text: string;
  objectKind?: "signal" | "entity" | "note";
  objectId?: string;
  changes?: { field: string; from?: string; to?: string };
  createdAt: string;
};

export type IntelligenceCase = {
  id: string;
  workspaceKey: string;
  title: string;
  summary: string;
  assessment: string;
  status: CaseStatus;
  risk: "low" | "medium" | "high";
  confidence: "low" | "medium" | "high";
  items: CaseItem[];
  notes: CaseNote[];
  events: CaseEvent[];
  createdAt: string;
  updatedAt: string;
};

export type CreateCaseInput = Pick<IntelligenceCase, "title"> & Partial<Pick<IntelligenceCase, "summary" | "assessment" | "status" | "risk" | "confidence">> & { items?: CaseItem[] };
