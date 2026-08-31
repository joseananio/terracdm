"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowClockwise, ArrowSquareOut, CaretDown, CaretRight, ChatCircleText, ClockCounterClockwise, DownloadSimple, FloppyDisk, FolderOpen, MapTrifold, PencilSimple, ShareNetwork, X } from "@phosphor-icons/react";
import { defaultBriefScope, type BriefDevelopment, type BriefRange, type BriefScope } from "@/src/lib/brief";
import type { OverviewArtifact } from "@/src/lib/server/overview-store";
import type { WorkspaceSearchCorpus, WorkspaceSearchSelection } from "@/src/components/maplibre-react-spike";
import type { InspectorRef, WorkspaceLens } from "@/src/lib/workspace-shell-state";
import { WorkspaceMultiMenu } from "@/src/components/workspace-controls";

type Props = {
  corpus: WorkspaceSearchCorpus;
  onAsk: (prompt: string, development?: BriefDevelopment) => void;
  onAddToCase: (development: BriefDevelopment, briefId?: string) => void;
  onInspect: (content: InspectorRef) => void;
  onNavigate: (lens: WorkspaceLens) => void;
  onViewMap: (selection: Omit<WorkspaceSearchSelection, "token">) => void;
};

const rangeOptions: Array<{ value: BriefRange; label: string }> = [{ value: "current", label: "Current" }, { value: "6h", label: "6 hours" }, { value: "24h", label: "24 hours" }, { value: "7d", label: "7 days" }];
const viewedKey = "terracdm:brief:viewed";

export function BriefWorkspace({ corpus, onAsk, onAddToCase, onInspect, onNavigate, onViewMap }: Props) {
  const [artifact, setArtifact] = useState<OverviewArtifact | null>(null);
  const [history, setHistory] = useState<OverviewArtifact[]>([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [scope, setScope] = useState<BriefScope>(defaultBriefScope);
  const [loading, setLoading] = useState(true);
  const [regenerating, setRegenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [historyOpen, setHistoryOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draftSummary, setDraftSummary] = useState("");
  const [saving, setSaving] = useState(false);

  const domains = useMemo(() => [...new Set(corpus.signals.map((signal) => signal.domain))].sort(), [corpus.signals]);
  const developments: BriefDevelopment[] = artifact?.developments?.length ? artifact.developments : (artifact?.highlights ?? []).map((highlight, index) => ({ id: `legacy:${index}`, title: highlight.replace(/^[A-Z]+ · /, ""), assessment: highlight, risk: "medium" as const, signalIds: [], entityIds: [] }));
  const stale = artifact ? Date.now() - Date.parse(artifact.createdAt) > 60 * 60 * 1_000 : false;

  const readHistory = async () => {
    const response = await fetch("/api/overview?history=1", { cache: "no-store" });
    const payload = await response.json() as { artifacts?: OverviewArtifact[]; error?: string };
    if (!response.ok) throw new Error(payload.error ?? "Brief history could not be read");
    const next = payload.artifacts ?? [];
    setHistory(next);
    setHistoryLoaded(true);
    return next;
  };

  useEffect(() => {
    let active = true;
    void fetch("/api/overview", { cache: "no-store" }).then(async (response) => {
      const payload = await response.json() as { artifact?: OverviewArtifact; error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Brief could not be read");
      return payload.artifact ?? null;
    }).then((latest) => {
      if (!active) return;
      setArtifact(latest);
      setScope(latest?.scope ?? defaultBriefScope);
      setDraftSummary(latest?.overview ?? "");
      if (latest) window.localStorage.setItem(viewedKey, latest.id);
    }).catch((cause) => active && setError(cause instanceof Error ? cause.message : "Brief could not be loaded")).finally(() => active && setLoading(false));
    return () => { active = false; };
  }, []);

  const generate = async () => {
    if (regenerating) return;
    const previousId = artifact?.id;
    setRegenerating(true);
    setError(null);
    try {
      const response = await fetch("/api/overview", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ trigger: "manual", force: true, scope }) });
      const payload = await response.json() as { artifact?: OverviewArtifact; error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Brief generation failed");
      let next = payload.artifact;
      for (let attempt = 0; !next && attempt < 90; attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 700));
        const items = await readHistory();
        if (items[0] && items[0].id !== previousId) next = items[0];
      }
      if (!next) throw new Error("The brief is still generating. The current brief remains available.");
      setArtifact(next);
      setHistory((current) => [next!, ...current.filter((item) => item.id !== next!.id)]);
      setDraftSummary(next.overview);
      window.localStorage.setItem(viewedKey, next.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Brief generation failed");
    } finally { setRegenerating(false); }
  };

  const save = async () => {
    if (!artifact) return;
    setSaving(true);
    try {
      const response = await fetch("/api/overview", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: artifact.id, overview: draftSummary }) });
      const payload = await response.json() as { artifact?: OverviewArtifact; error?: string };
      if (!response.ok || !payload.artifact) throw new Error(payload.error ?? "Brief could not be saved");
      setArtifact(payload.artifact);
      setHistory((current) => current.map((item) => item.id === payload.artifact!.id ? payload.artifact! : item));
      setEditing(false);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Brief could not be saved"); }
    finally { setSaving(false); }
  };

  const exportBrief = () => {
    if (!artifact) return;
    const body = [`# Brief`, "", artifact.overview, "", ...developments.flatMap((item) => [`## ${item.title}`, "", item.assessment, item.uncertainty ? `Uncertainty: ${item.uncertainty}` : "", ""])].join("\n");
    const url = URL.createObjectURL(new Blob([body], { type: "text/markdown" }));
    const link = document.createElement("a"); link.href = url; link.download = `brief-${artifact.createdAt.slice(0, 10)}.md`; link.click(); URL.revokeObjectURL(url);
  };

  const shareBrief = async () => {
    if (!artifact) return;
    const url = new URL(window.location.href); url.searchParams.set("lens", "brief"); url.searchParams.set("brief", artifact.id);
    if (navigator.share) await navigator.share({ title: "TerraCDM Brief", text: artifact.overview, url: url.toString() });
    else await navigator.clipboard.writeText(url.toString());
  };

  const openEvidence = (kind: "signal" | "entity", id: string) => onInspect({ kind, id, sourceLens: "brief" });
  const handoff = (lens: "graph", development: BriefDevelopment) => {
    window.localStorage.setItem(`terracdm:${lens}:handoff`, JSON.stringify({ briefId: artifact?.id, development }));
    onNavigate(lens);
  };

  const toggleHistory = () => {
    if (historyOpen) {
      setHistoryOpen(false);
      return;
    }
    setHistoryOpen(true);
    if (!historyLoaded) void readHistory().catch((cause) => setError(cause instanceof Error ? cause.message : "Brief history could not be read"));
  };

  return <section className="workspace-foundation workspace-brief" aria-labelledby="brief-title">
    <header className="workspace-foundation-head brief-head"><div><h1 id="brief-title">Brief</h1>{artifact && <span>{new Date(artifact.createdAt).toLocaleString()}</span>}{stale && <i>Update available</i>}</div><div className="brief-head-actions">
      <button type="button" onClick={toggleHistory} aria-expanded={historyOpen}><ClockCounterClockwise size={16} />History</button>
      <button type="button" onClick={() => { setDraftSummary(artifact?.overview ?? ""); setEditing(true); }} disabled={!artifact}><PencilSimple size={16} />Edit</button>
      <button type="button" onClick={() => void shareBrief()} disabled={!artifact}><ShareNetwork size={16} />Share</button>
      <button type="button" onClick={exportBrief} disabled={!artifact}><DownloadSimple size={16} />Export</button>
      <button type="button" className="primary" onClick={() => void generate()} disabled={regenerating}><ArrowClockwise className={regenerating ? "spin" : ""} size={16} />{regenerating ? "Updating" : "Update"}</button>
    </div></header>
    <div className="brief-scope" aria-label="Brief scope">
      <div className="brief-range">{rangeOptions.map((option) => <button key={option.value} className={scope.range === option.value ? "active" : ""} onClick={() => setScope((current) => ({ ...current, range: option.value }))}>{option.label}</button>)}</div>
      <label><span>Place</span><input value={scope.geography ?? ""} onChange={(event) => setScope((current) => ({ ...current, geography: event.target.value || undefined }))} placeholder="Global" /></label>
      <WorkspaceMultiMenu ariaLabel="Brief domains" className="brief-domain-menu" emptyLabel="All domains" value={scope.domains} options={domains.map((domain) => ({ value: domain, label: domain }))} onChange={(domainValues) => setScope((current) => ({ ...current, domains: domainValues }))} />
    </div>
    {historyOpen && <aside className="brief-history"><header><b>History</b><button onClick={() => setHistoryOpen(false)} aria-label="Close history"><X size={15} /></button></header>{history.map((item) => <button key={item.id} className={item.id === artifact?.id ? "active" : ""} onClick={() => { setArtifact(item); setScope(item.scope ?? defaultBriefScope); setDraftSummary(item.overview); setHistoryOpen(false); window.localStorage.setItem(viewedKey, item.id); }}><b>{new Date(item.createdAt).toLocaleString()}</b><span>{item.overview}</span></button>)}</aside>}
    {error && <div className="brief-error"><span>{error}</span><button onClick={() => setError(null)}>Dismiss</button></div>}
    {loading ? <div className="brief-loading"><ArrowClockwise className="spin" />Loading brief…</div> : !artifact ? <div className="workspace-empty-state"><span /><p>No brief yet.</p><button onClick={() => void generate()}>Generate brief</button></div> : <div className="brief-scroll">
      <article className="brief-summary">{editing ? <><textarea value={draftSummary} onChange={(event) => setDraftSummary(event.target.value)} autoFocus /><div><button onClick={() => setEditing(false)}>Cancel</button><button className="primary" onClick={() => void save()} disabled={saving}><FloppyDisk size={14} />{saving ? "Saving" : "Save"}</button></div></> : <p>{artifact.overview}</p>}</article>
      <div className="brief-content"><main><h2>Developments</h2>{developments.map((development) => { const isOpen = expanded.has(development.id); const signalEvidence = development.signalIds.map((id) => corpus.signals.find((item) => item.id === id)).filter(Boolean); const entityEvidence = development.entityIds.map((id) => corpus.entities.find((item) => item.id === id)).filter(Boolean); return <article key={development.id} className={`brief-development ${development.risk}`}>
        <button className="brief-development-toggle" onClick={() => setExpanded((current) => { const next = new Set(current); if (next.has(development.id)) next.delete(development.id); else next.add(development.id); return next; })} aria-expanded={isOpen}><i /><span><b>{development.title}</b><small>{development.assessment}</small></span><CaretDown size={16} /></button>
        {isOpen && <div className="brief-evidence">{development.uncertainty && <p>{development.uncertainty}</p>}{signalEvidence.map((signal) => signal && <button key={signal.id} onClick={() => openEvidence("signal", signal.id)}><span>{signal.name}</span><small>{signal.source.name}</small><CaretRight size={14} /></button>)}{entityEvidence.map((entity) => entity && <button key={entity.id} onClick={() => openEvidence("entity", entity.id)}><span>{entity.name}</span><small>{entity.domain}</small><CaretRight size={14} /></button>)}{!signalEvidence.length && !entityEvidence.length && <span>No linked records in the current snapshot.</span>}<div className="brief-development-actions"><button onClick={() => { const signal = signalEvidence[0]; if (signal) onViewMap({ kind: "signal", value: signal }); }} disabled={!signalEvidence.length}><MapTrifold />Map</button><button onClick={() => handoff("graph", development)}><ShareNetwork />Graph</button><button onClick={() => onAsk(`Investigate: ${development.title}`, development)}><ChatCircleText />Ask</button><button onClick={() => onAddToCase(development, artifact?.id)}><FolderOpen />Add to case</button></div></div>}
      </article>; })}</main><aside><h2>Ask next</h2>{artifact.suggestedQueries.map((query) => <button key={query} onClick={() => onAsk(query)}><span>{query}</span><ArrowSquareOut size={13} /></button>)}</aside></div>
    </div>}
  </section>;
}
