"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { ArrowLeft, CaretRight, Check, FolderOpen, MagnifyingGlass, MapTrifold, Plus, ShareNetwork, Star, X } from "@phosphor-icons/react";
import type { CaseEvent, CaseItem, CaseNote, CaseStatus, CreateCaseInput, IntelligenceCase } from "@/src/lib/cases";
import type { BriefDevelopment } from "@/src/lib/brief";
import type { WorkspaceSearchCorpus, WorkspaceSearchSelection } from "@/src/components/maplibre-react-spike";
import { WorkspaceSelect } from "@/src/components/workspace-controls";
import type { InspectorRef, WorkspaceLens } from "@/src/lib/workspace-shell-state";

type CaseTab = "summary" | "timeline" | "evidence" | "relationships" | "notes";
type CaseHandoff = { briefId?: string; development?: BriefDevelopment } | { kind: "signal" | "entity"; id: string };

type Props = {
  corpus: WorkspaceSearchCorpus;
  onInspect: (content: InspectorRef) => void;
  onNavigate: (lens: WorkspaceLens) => void;
  onViewMap: (selection: Omit<WorkspaceSearchSelection, "token">) => void;
  handoffToken: number;
};

const statusOptions: Array<{ value: CaseStatus; label: string }> = [{ value: "active", label: "Active" }, { value: "watching", label: "Watching" }, { value: "closed", label: "Closed" }];
const riskOptions: Array<{ value: IntelligenceCase["risk"]; label: string }> = [{ value: "low", label: "Low" }, { value: "medium", label: "Medium" }, { value: "high", label: "High" }];
const evidenceRoleOptions: Array<{ value: CaseItem["role"]; label: string }> = [{ value: "supporting", label: "Supporting" }, { value: "contradicting", label: "Contradicting" }, { value: "context", label: "Context" }];

function relativeTime(value: string) {
  const minutes = Math.max(0, Math.floor((Date.now() - Date.parse(value)) / 60_000));
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h`;
  return `${Math.floor(minutes / 1440)}d`;
}

function excerpt(value: string, limit = 100) {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > limit ? `${compact.slice(0, limit - 1)}…` : compact;
}

function handoffItems(handoff: CaseHandoff | null, corpus: WorkspaceSearchCorpus): CaseItem[] {
  if (!handoff) return [];
  const now = new Date().toISOString();
  if ("development" in handoff && handoff.development) {
    const development = handoff.development;
    const records: CaseItem[] = [
      ...development.signalIds.map((id) => corpus.signals.find((item) => item.id === id)).filter(Boolean).map((signal) => ({ id: crypto.randomUUID(), kind: "signal" as const, objectId: signal!.id, name: signal!.name, description: signal!.description, role: "context" as const, note: development.assessment, addedAt: now })),
      ...development.entityIds.map((id) => corpus.entities.find((item) => item.id === id)).filter(Boolean).map((entity) => ({ id: crypto.randomUUID(), kind: "entity" as const, objectId: entity!.id, name: entity!.name, description: entity!.description, role: "context" as const, addedAt: now })),
    ];
    if (!records.length && handoff.briefId) records.push({ id: crypto.randomUUID(), kind: "brief", objectId: handoff.briefId, name: development.title, description: development.assessment, role: "context", addedAt: now });
    return records;
  }
  if (!("kind" in handoff)) return [];
  const record = handoff.kind === "signal" ? corpus.signals.find((item) => item.id === handoff.id) : corpus.entities.find((item) => item.id === handoff.id);
  return record ? [{ id: crypto.randomUUID(), kind: handoff.kind, objectId: record.id, name: record.name, description: record.description, role: "context", addedAt: now }] : [];
}

export function CasesWorkspace({ corpus, handoffToken, onInspect, onNavigate, onViewMap }: Props) {
  const [cases, setCases] = useState<IntelligenceCase[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<CaseTab>("summary");
  const [filter, setFilter] = useState<CaseStatus | "all">("active");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [handoff, setHandoff] = useState<CaseHandoff | null>(null);
  const [title, setTitle] = useState("");
  const [assessmentDraft, setAssessmentDraft] = useState("");
  const [noteDraft, setNoteDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const selected = cases.find((item) => item.id === selectedId) ?? null;

  const refresh = async () => {
    const response = await fetch("/api/cases", { cache: "no-store" });
    const payload = await response.json() as { cases?: IntelligenceCase[]; error?: string };
    if (!response.ok) throw new Error(payload.error ?? "Cases could not be loaded");
    setCases(payload.cases ?? []);
  };

  useEffect(() => {
    let active = true;
    void refresh().catch((cause) => active && setError(cause instanceof Error ? cause.message : "Cases could not be loaded")).finally(() => active && setLoading(false));
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const raw = window.localStorage.getItem("terracdm:cases:handoff");
    if (!raw) return;
    window.localStorage.removeItem("terracdm:cases:handoff");
    try { setHandoff(JSON.parse(raw) as CaseHandoff); setSelectedId(null); setAssessmentDraft(""); setCreateOpen(true); } catch { /* Ignore malformed handoffs. */ }
  }, [handoffToken]);

  const visible = useMemo(() => cases.filter((item) => filter === "all" || item.status === filter).filter((item) => !query.trim() || `${item.title} ${item.summary} ${item.assessment}`.toLowerCase().includes(query.trim().toLowerCase())).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), [cases, filter, query]);
  const pendingItems = useMemo(() => handoffItems(handoff, corpus), [corpus, handoff]);

  const create = async () => {
    if (!title.trim() || saving) return;
    setSaving(true); setError(null);
    try {
      const input: CreateCaseInput = { title, assessment: assessmentDraft, items: pendingItems };
      const response = await fetch("/api/cases", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) });
      const payload = await response.json() as { case?: IntelligenceCase; error?: string };
      if (!response.ok || !payload.case) throw new Error(payload.error ?? "Case could not be created");
      setCases((current) => [payload.case!, ...current]); setSelectedId(payload.case.id); setCreateOpen(false); setTitle(""); setAssessmentDraft(payload.case.assessment); setHandoff(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Case could not be created"); }
    finally { setSaving(false); }
  };

  const patchCase = async (value: IntelligenceCase, patch: Partial<IntelligenceCase>) => {
    const optimistic = { ...value, ...patch, updatedAt: new Date().toISOString() };
    setCases((current) => current.map((item) => item.id === value.id ? optimistic : item));
    try {
      const response = await fetch("/api/cases", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: value.id, patch }) });
      const payload = await response.json() as { case?: IntelligenceCase; error?: string };
      if (!response.ok || !payload.case) throw new Error(payload.error ?? "Case could not be saved");
      setCases((current) => current.map((item) => item.id === value.id ? payload.case! : item));
      return true;
    } catch (cause) {
      setCases((current) => current.map((item) => item.id === value.id ? value : item));
      setError(cause instanceof Error ? cause.message : "Case could not be saved");
      return false;
    }
  };

  const addPendingTo = async (value: IntelligenceCase) => {
    const additions = pendingItems.filter((incoming) => !value.items.some((item) => item.kind === incoming.kind && item.objectId === incoming.objectId));
    const now = new Date().toISOString();
    const saved = await patchCase(value, { items: [...value.items, ...additions], events: [...additions.map((item): CaseEvent => ({ id: crypto.randomUUID(), type: "evidence", text: `Added ${item.name}`, objectKind: item.kind === "brief" ? undefined : item.kind, objectId: item.kind === "brief" ? undefined : item.objectId, createdAt: now })), ...value.events] });
    if (!saved) return;
    setHandoff(null); setCreateOpen(false); setSelectedId(value.id); setAssessmentDraft(value.assessment);
  };

  const saveAssessment = async () => {
    if (!selected) return;
    const now = new Date().toISOString();
    await patchCase(selected, { assessment: assessmentDraft, events: [{ id: crypto.randomUUID(), type: "assessment", text: "Assessment updated", createdAt: now }, ...selected.events] });
  };

  const setAssessmentLevel = async (field: "risk" | "confidence", next: IntelligenceCase["risk"]) => {
    if (!selected || selected[field] === next) return;
    const previous = selected[field];
    const label = field === "risk" ? "Risk level" : "Assessment confidence";
    const patch = field === "risk" ? { risk: next } : { confidence: next };
    await patchCase(selected, { ...patch, events: [{ id: crypto.randomUUID(), type: "assessment", text: `${label} changed to ${next}`, changes: { field, from: previous, to: next }, createdAt: new Date().toISOString() }, ...selected.events] });
  };

  const setEvidenceRole = async (item: CaseItem, role: CaseItem["role"]) => {
    if (!selected || item.role === role) return;
    const now = new Date().toISOString();
    await patchCase(selected, { items: selected.items.map((value) => value.id === item.id ? { ...value, role } : value), events: [{ id: crypto.randomUUID(), type: "evidence", text: `${item.name} marked ${role}`, objectKind: item.kind === "brief" ? undefined : item.kind, objectId: item.kind === "brief" ? undefined : item.objectId, changes: { field: "evidence role", from: item.role, to: role }, createdAt: now }, ...selected.events] });
  };

  const addNote = async () => {
    if (!selected || !noteDraft.trim()) return;
    const now = new Date().toISOString();
    const note: CaseNote = { id: crypto.randomUUID(), body: noteDraft.trim(), pinned: false, createdAt: now, updatedAt: now };
    if (await patchCase(selected, { notes: [note, ...selected.notes], events: [{ id: crypto.randomUUID(), type: "note", text: `Note added · ${excerpt(note.body)}`, objectKind: "note", objectId: note.id, createdAt: now }, ...selected.events] })) setNoteDraft("");
  };

  const inspectItem = (item: CaseItem) => {
    if (item.kind === "brief") onInspect({ kind: "evidence", id: item.id, sourceLens: "cases", title: item.name, body: item.description || "No description available." });
    else onInspect({ kind: item.kind, id: item.objectId, sourceLens: "cases" });
  };
  const inspectEvent = (event: CaseEvent) => {
    if (!event.objectId || !event.objectKind) return;
    if (event.objectKind === "note") {
      const note = selected?.notes.find((item) => item.id === event.objectId);
      if (note && selected) onInspect({ kind: "note", id: note.id, sourceLens: "cases", title: selected.title, body: note.body, updatedAt: note.updatedAt });
      return;
    }
    onInspect({ kind: event.objectKind, id: event.objectId, sourceLens: "cases" });
  };
  const mapItem = selected?.items.find((item) => item.kind !== "brief" && (item.kind === "signal" ? corpus.signals : corpus.entities).some((record) => record.id === item.objectId));
  const viewCaseOnMap = () => {
    if (!mapItem || mapItem.kind === "brief") return;
    const value = mapItem.kind === "signal" ? corpus.signals.find((item) => item.id === mapItem.objectId) : corpus.entities.find((item) => item.id === mapItem.objectId);
    if (value) onViewMap({ kind: mapItem.kind, value } as Omit<WorkspaceSearchSelection, "token">);
  };

  if (selected) return <section className="workspace-foundation cases-workspace case-detail" aria-labelledby="case-title">
    <header className="case-detail-head"><button onClick={() => setSelectedId(null)} aria-label="Back to cases"><ArrowLeft size={17} /></button><div><h1 id="case-title">{selected.title}</h1><WorkspaceSelect ariaLabel="Case status" value={selected.status} options={statusOptions} onChange={(status) => void patchCase(selected, { status, events: [{ id: crypto.randomUUID(), type: "status", text: `Status changed to ${status}`, changes: { field: "status", from: selected.status, to: status }, createdAt: new Date().toISOString() }, ...selected.events] })} /></div><div className="case-detail-actions"><div className="case-detail-indicators"><div className="case-detail-indicator"><span>Risk</span><WorkspaceSelect ariaLabel="Case risk level" value={selected.risk} options={riskOptions} onChange={(risk) => void setAssessmentLevel("risk", risk)} /></div></div><button onClick={viewCaseOnMap} disabled={!mapItem}><MapTrifold size={16} />Map</button><button onClick={() => { window.localStorage.setItem("terracdm:graph:handoff", JSON.stringify({ caseId: selected.id, itemIds: selected.items.map((item) => item.objectId) })); onNavigate("graph"); }}><ShareNetwork size={16} />Graph</button></div></header>
    <nav className="case-tabs" aria-label="Case sections">{(["summary", "timeline", "evidence", "relationships", "notes"] as CaseTab[]).map((item) => <button key={item} className={tab === item ? "active" : ""} onClick={() => setTab(item)}>{item}</button>)}</nav>
    {error && <div className="case-error"><span>{error}</span><button onClick={() => setError(null)}>Dismiss</button></div>}
    <div className="case-detail-scroll">
      {tab === "summary" && <div className="case-summary-grid"><main><section className="case-assessment"><div className="case-assessment-heading"><h2>Assessment</h2></div><textarea value={assessmentDraft} onChange={(event) => setAssessmentDraft(event.target.value)} placeholder="Current assessment" /><div className="case-assessment-footer"><div className="case-assessment-control"><span>Assessment confidence</span><WorkspaceSelect ariaLabel="Assessment confidence" value={selected.confidence} options={riskOptions} onChange={(confidence) => void setAssessmentLevel("confidence", confidence)} /></div><button onClick={() => void saveAssessment()} disabled={assessmentDraft === selected.assessment}>Save assessment</button></div></section><CaseEvidenceList items={selected.items.slice(0, 5)} onInspect={inspectItem} /></main><aside><h2>Recent activity</h2><CaseTimeline events={selected.events.slice(0, 6)} onInspect={inspectEvent} /></aside></div>}
      {tab === "timeline" && <section className="case-section"><CaseTimeline events={selected.events} onInspect={inspectEvent} /></section>}
      {tab === "evidence" && <section className="case-section"><CaseEvidenceList items={selected.items} onInspect={inspectItem} onRoleChange={(item, role) => void setEvidenceRole(item, role)} showHeading={false} /></section>}
      {tab === "relationships" && <section className="case-section case-relationships"><div>{selected.items.map((item, index) => <button key={item.id} onClick={() => inspectItem(item)} style={{ "--case-node-index": index } as CSSProperties}><i className={item.kind} /><b>{item.name}</b><small>{item.kind}</small></button>)}</div><button className="case-open-graph" onClick={() => onNavigate("graph")}><ShareNetwork />Open in Graph</button></section>}
      {tab === "notes" && <section className="case-section case-notes"><label htmlFor="case-note-draft">Add note</label><div className="case-note-compose"><textarea id="case-note-draft" value={noteDraft} onChange={(event) => setNoteDraft(event.target.value)} placeholder="Write a note" /><button onClick={() => void addNote()} disabled={!noteDraft.trim()}><Plus />Add note</button></div>{selected.notes.map((note) => <article key={note.id}><button onClick={() => void patchCase(selected, { notes: selected.notes.map((item) => item.id === note.id ? { ...item, pinned: !item.pinned } : item) })} aria-label={note.pinned ? "Unpin note" : "Pin note"}><Star weight={note.pinned ? "fill" : "regular"} /></button><button className="case-note-open" onClick={() => onInspect({ kind: "note", id: note.id, sourceLens: "cases", title: selected.title, body: note.body, updatedAt: note.updatedAt })} aria-label={`Open note from ${selected.title}`}><p>{note.body}</p></button><time>{new Date(note.updatedAt).toLocaleString()}</time></article>)}</section>}
    </div>
  </section>;

  return <section className="workspace-foundation cases-workspace" aria-labelledby="cases-title">
    <header className="workspace-foundation-head cases-head"><div><h1 id="cases-title">Cases</h1><span>{cases.filter((item) => item.status !== "closed").length} open</span></div><button onClick={() => { setHandoff(null); setCreateOpen(true); }}><Plus size={16} />New case</button></header>
    <div className="cases-controls"><nav>{(["all", "active", "watching", "closed"] as const).map((item) => <button key={item} className={filter === item ? "active" : ""} onClick={() => setFilter(item)}>{item}</button>)}</nav><label><MagnifyingGlass size={14} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter cases" />{query && <button onClick={() => setQuery("")} aria-label="Clear case filter"><X /></button>}</label></div>
    {error && <div className="case-error"><span>{error}</span><button onClick={() => setError(null)}>Dismiss</button></div>}
    {loading ? <div className="case-empty">Loading cases…</div> : visible.length ? <div className="cases-list">{visible.map((item) => <button key={item.id} onClick={() => { setSelectedId(item.id); setAssessmentDraft(item.assessment); }}><span className={`case-risk ${item.risk}`} /><span><b>{item.title}</b><small>{item.items.filter((entry) => entry.kind === "signal").length} signals · {item.items.filter((entry) => entry.kind === "entity").length} entities</small></span><em>{item.status}</em><time>{relativeTime(item.updatedAt)}</time><CaretRight size={15} /></button>)}</div> : <div className="case-empty"><FolderOpen size={23} /><p>No cases in this view.</p></div>}
    {createOpen && <><button className="case-modal-scrim" onClick={() => { setCreateOpen(false); setHandoff(null); }} aria-label="Close case dialog" /><aside className="case-create" role="dialog" aria-modal="true" aria-labelledby="case-create-title"><header><h2 id="case-create-title">{pendingItems.length ? "Add to case" : "New case"}</h2><button onClick={() => { setCreateOpen(false); setHandoff(null); }} aria-label="Close"><X /></button></header>{pendingItems.length > 0 && <div className="case-pending-items">{pendingItems.map((item) => <span key={item.id}><Check />{item.name}</span>)}</div>}{pendingItems.length > 0 && cases.filter((item) => item.status !== "closed").length > 0 && <div className="case-existing"><h3>Existing case</h3>{cases.filter((item) => item.status !== "closed").map((item) => <button key={item.id} onClick={() => void addPendingTo(item)}><span>{item.title}</span><CaretRight /></button>)}</div>}<div className="case-create-fields"><h3>{pendingItems.length ? "Or create a case" : "Create case"}</h3><label>Title<input value={title} onChange={(event) => setTitle(event.target.value)} autoFocus placeholder="Case title" /></label><label>Initial assessment<textarea value={assessmentDraft} onChange={(event) => setAssessmentDraft(event.target.value)} placeholder="Optional" /></label><button onClick={() => void create()} disabled={!title.trim() || saving}>{saving ? "Creating…" : "Create case"}</button></div></aside></>}
  </section>;
}

function CaseEvidenceList({ items, onInspect, onRoleChange, showHeading = true }: { items: CaseItem[]; onInspect: (item: CaseItem) => void; onRoleChange?: (item: CaseItem, role: CaseItem["role"]) => void; showHeading?: boolean }) {
  return <section className="case-evidence-list">{showHeading && <h2>Evidence</h2>}{items.length ? items.map((item) => <article key={item.id} className={item.role}><button onClick={() => onInspect(item)}><i /><span><b>{item.name}</b><small>{item.description || item.kind}</small></span></button>{onRoleChange && <WorkspaceSelect ariaLabel={`Evidence role for ${item.name}`} value={item.role} options={evidenceRoleOptions} onChange={(role) => onRoleChange(item, role)} />}<button className="case-evidence-open" onClick={() => onInspect(item)} aria-label={`Open evidence ${item.name}`}><CaretRight /></button></article>) : <p>No evidence has been added.</p>}</section>;
}

function CaseTimeline({ events, onInspect }: { events: CaseEvent[]; onInspect: (event: CaseEvent) => void }) {
  return <div className="case-timeline">{events.length ? events.map((event) => <button key={event.id} onClick={() => onInspect(event)} disabled={!event.objectId}><time>{new Date(event.createdAt).toLocaleString()}</time><i /><span title={event.text}>{event.text}</span>{event.objectId && <CaretRight />}</button>) : <p>No activity yet.</p>}</div>;
}
