"use client";

import { useEffect, useMemo, useReducer, useRef, useState, type CSSProperties, type ElementType, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject } from "react";
import {
  Article,
  Bell,
  CaretDown,
  CaretRight,
  Check,
  ChatCircleText,
  CirclesThreePlus,
  FolderOpen,
  GearSix,
  GlobeHemisphereWest,
  MagnifyingGlass,
  MapPin,
  MapTrifold,
  ArrowSquareOut,
  PushPin,
  ShareNetwork,
  Star,
  Stack,
  UsersThree,
  X,
} from "@phosphor-icons/react";
import { MaplibreReactSpike, type WorkspaceMapSettingsRequest, type WorkspaceMapSettingsState, type WorkspaceSearchCorpus, type WorkspaceSearchSelection, type WorkspaceToolRequest, type WorkspaceToolState } from "@/src/components/maplibre-react-spike";
import { SignalIcon } from "@/src/components/incoming-signal-queue";
import { BriefWorkspace } from "@/src/components/brief-workspace";
import type { BriefDevelopment } from "@/src/lib/brief";
import type { ChatReference } from "@/src/lib/server/chat";
import type { FeedStatus } from "@/src/lib/feed-status";
import { geosearchKindLabel, type GeosearchResult } from "@/src/lib/geosearch";
import type { Entity, Signal } from "@/src/lib/intelligence";
import { defaultMapSettings, timeZoneOptions, type MapSettings, type MapTimeZone, type TimeFormat } from "@/src/lib/map-settings";
import { defaultWorkspaceShellState, readWorkspaceLocation, workspaceLenses, workspaceShellReducer, writeWorkspaceLocation, type InspectorRef, type WorkspaceLens } from "@/src/lib/workspace-shell-state";

type WorkspaceMode = WorkspaceLens;

type CompactMenuOption<T extends string> = { value: T; label: string };

function CompactMenu<T extends string>({ ariaLabel, className, onChange, options, value }: { ariaLabel: string; className: string; onChange: (value: T) => void; options: CompactMenuOption<T>[]; value: T }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = options.find((option) => option.value === value) ?? options[0];

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!(event.target instanceof Node && rootRef.current?.contains(event.target))) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return <div ref={rootRef} className={`${className}${open ? " open" : ""}`}>
    <button type="button" className="workspace-compact-menu-trigger" aria-label={ariaLabel} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((current) => !current)}>
      <span>{selected.label}</span><CaretDown size={14} aria-hidden="true" />
    </button>
    {open && <div className="workspace-compact-menu-options" role="menu" aria-label={ariaLabel}>
      {options.map((option) => <button key={option.value} type="button" role="menuitemradio" aria-checked={option.value === value} onClick={() => { onChange(option.value); setOpen(false); }}><span>{option.label}</span>{option.value === value && <Check size={13} />}</button>)}
    </div>}
  </div>;
}

type ModeDefinition = {
  id: WorkspaceMode;
  label: string;
  icon: ElementType;
  shortcut: string;
};

const modes: ModeDefinition[] = [
  { id: "signals", label: "Signals", icon: Bell, shortcut: "1" },
  { id: "brief", label: "Brief", icon: Article, shortcut: "2" },
  { id: "cases", label: "Cases", icon: FolderOpen, shortcut: "3" },
  { id: "entities", label: "Entities", icon: UsersThree, shortcut: "4" },
  { id: "graph", label: "Graph", icon: ShareNetwork, shortcut: "5" },
  { id: "map", label: "Map", icon: MapTrifold, shortcut: "6" },
];

const modeCopy: Record<Exclude<WorkspaceMode, "map" | "settings">, { title: string; empty: string; action?: string }> = {
  signals: { title: "Signals", empty: "No signals match this view." },
  brief: { title: "Brief", empty: "The current brief will appear here." },
  cases: { title: "Cases", empty: "No active cases.", action: "New case" },
  entities: { title: "Entities", empty: "Search aircraft, vessels, places, organizations, actors, and infrastructure." },
  graph: { title: "Graph", empty: "Select a signal, case, or entity to explore its relationships." },
};

function normalizeSearch(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function matchesSearch(query: string, ...values: Array<string | undefined>) {
  const terms = normalizeSearch(query).split(/\s+/).filter(Boolean);
  const text = normalizeSearch(values.filter(Boolean).join(" "));
  return terms.every((term) => text.includes(term));
}

type SearchPaletteProps = {
  corpus: WorkspaceSearchCorpus;
  onSelect: (selection: Omit<WorkspaceSearchSelection, "token">) => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  query: string;
  setQuery: (query: string) => void;
  inputRef: RefObject<HTMLInputElement | null>;
};

function SearchPalette({ corpus, inputRef, onOpenChange, onSelect, open, query, setQuery }: SearchPaletteProps) {
  const [places, setPlaces] = useState<GeosearchResult[]>([]);
  const [placeSearching, setPlaceSearching] = useState(false);
  const signals = useMemo(() => query.trim() ? corpus.signals.filter((signal) => matchesSearch(query, signal.name, signal.description, signal.source.name, signal.domain)).slice(0, 5) : [], [corpus.signals, query]);
  const entities = useMemo(() => {
    if (!query.trim()) return [];
    const matchingSignalNames = new Set(signals.map((signal) => normalizeSearch(signal.name)));
    return corpus.entities
      .filter((entity) => !matchingSignalNames.has(normalizeSearch(entity.name)) && matchesSearch(query, entity.name, entity.description, entity.domain))
      .slice(0, 5);
  }, [corpus.entities, query, signals]);

  useEffect(() => {
    const value = query.trim();
    if (!open || value.length < 2) {
      setPlaces([]);
      setPlaceSearching(false);
      return;
    }
    const controller = new AbortController();
    setPlaceSearching(true);
    const timer = window.setTimeout(() => {
      void fetch(`/api/geosearch?q=${encodeURIComponent(value)}`, { cache: "no-store", signal: controller.signal })
        .then((response) => response.ok ? response.json() as Promise<{ results?: GeosearchResult[] }> : Promise.reject(new Error(`Geosearch returned ${response.status}`)))
        .then((payload) => setPlaces((payload.results ?? []).slice(0, 5)))
        .catch((cause: unknown) => { if (!(cause instanceof DOMException && cause.name === "AbortError")) setPlaces([]); })
        .finally(() => { if (!controller.signal.aborted) setPlaceSearching(false); });
    }, 220);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [open, query]);

  const hasResults = signals.length + entities.length + places.length > 0;
  const close = () => { setQuery(""); onOpenChange(false); };
  const openSearch = () => {
    onOpenChange(true);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  return <div className={`workspace-search${open ? " open" : ""}`}>
    {open ? <label className="workspace-command" onBlur={(event) => {
      if (query.length === 0 && !(event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget))) onOpenChange(false);
    }}>
      <MagnifyingGlass size={15} />
      <input ref={inputRef} value={query} onFocus={() => onOpenChange(true)} onChange={(event) => { setQuery(event.target.value); onOpenChange(true); }} aria-label="Search signals, entities, and places" placeholder="Search intelligence or places" />
      {query.length > 0 && <button type="button" onClick={() => setQuery("")} aria-label="Clear search"><X size={14} /></button>}
    </label> : <button type="button" className="workspace-search-trigger" onClick={openSearch} aria-label="Search" title="Search · ⌘ K"><MagnifyingGlass size={17} /></button>}
    {open && query.trim() && <>
      <button type="button" className="workspace-search-scrim" onClick={close} aria-label="Close search results" />
      <section className="workspace-search-palette" aria-label="Search results">
        {signals.length > 0 && <SearchGroup label="Signals">{signals.map((signal) => <SearchSignalResult key={signal.id} signal={signal} onSelect={() => onSelect({ kind: "signal", value: signal })} />)}</SearchGroup>}
        {entities.length > 0 && <SearchGroup label="Entities">{entities.map((entity) => <SearchEntityResult key={entity.id} entity={entity} onSelect={() => onSelect({ kind: "entity", value: entity })} />)}</SearchGroup>}
        {(places.length > 0 || placeSearching) && <SearchGroup label="Places" state={placeSearching ? "Searching…" : undefined}>{places.map((place) => <button type="button" className="workspace-search-result" key={place.id} onClick={() => onSelect({ kind: "place", value: place })}><MapPin size={15} /><span><b>{place.label}</b><small>{place.detail || place.source}</small></span><em>{geosearchKindLabel[place.kind]}</em><CaretRight size={13} /></button>)}</SearchGroup>}
        {!hasResults && !placeSearching && <div className="workspace-search-empty">No matching intelligence or places.</div>}
      </section>
    </>}
  </div>;
}

function SearchGroup({ children, label, state }: { children: ReactNode; label: string; state?: string }) {
  return <div className="workspace-search-group"><header><span>{label}</span>{state && <small>{state}</small>}</header>{children}</div>;
}

function SearchSignalResult({ onSelect, signal }: { onSelect: () => void; signal: Signal }) {
  return <button type="button" className="workspace-search-result" onClick={onSelect}><span className={`workspace-search-result-icon ${signal.risk}`}><SignalIcon domain={signal.domain} /></span><span><b>{signal.name}</b><small>{signal.description || signal.source.name}</small></span><em>{signal.domain}</em><CaretRight size={13} /></button>;
}

function SearchEntityResult({ entity, onSelect }: { entity: Entity; onSelect: () => void }) {
  return <button type="button" className="workspace-search-result" onClick={onSelect}><span className="workspace-search-result-icon"><SignalIcon domain={entity.domain} /></span><span><b>{entity.name}</b><small>{entity.description}</small></span><em>{entity.domain}</em><CaretRight size={13} /></button>;
}

type SignalFilter = "all" | "high" | "unread" | "watchlist";
type SignalSort = "newest" | "risk";
type EntityFilter = "all" | "high" | "located" | "watchlist";
type EntitySort = "newest" | "risk" | "name";

const signalRiskRank: Record<Signal["risk"], number> = { high: 3, medium: 2, low: 1 };

function signalAge(value: string) {
  const elapsed = Math.max(0, Date.now() - new Date(value).getTime());
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function SignalWorkspace({ onInspect, signals }: { onInspect: (content: InspectorRef) => void; signals: Signal[] }) {
  const [filter, setFilter] = useState<SignalFilter>("all");
  const [sort, setSort] = useState<SignalSort>("newest");
  const [query, setQuery] = useState("");
  const [readIds, setReadIds] = useState<Set<string>>(() => new Set());
  const [watchedIds, setWatchedIds] = useState<Set<string>>(() => new Set());
  const visibleSignals = useMemo(() => signals
    .filter((signal) => filter !== "high" || signal.risk === "high")
    .filter((signal) => filter !== "unread" || !readIds.has(signal.id))
    .filter((signal) => filter !== "watchlist" || watchedIds.has(signal.id))
    .filter((signal) => !query.trim() || matchesSearch(query, signal.name, signal.description, signal.source.name, signal.domain, signal.location?.label))
    .sort((left, right) => sort === "risk" ? signalRiskRank[right.risk] - signalRiskRank[left.risk] || right.observedAt.localeCompare(left.observedAt) : right.observedAt.localeCompare(left.observedAt)), [filter, query, readIds, signals, sort, watchedIds]);
  const unreadCount = signals.filter((signal) => !readIds.has(signal.id)).length;
  const openSignal = (signal: Signal) => {
    setReadIds((current) => new Set(current).add(signal.id));
    onInspect({ kind: "signal", id: signal.id, sourceLens: "signals" });
  };
  const toggleWatch = (signalId: string) => setWatchedIds((current) => {
    const next = new Set(current);
    if (next.has(signalId)) next.delete(signalId);
    else next.add(signalId);
    return next;
  });

  return <section className="workspace-foundation workspace-foundation-signals workspace-signals" aria-labelledby="workspace-signals-title">
    <header className="workspace-foundation-head workspace-signals-head"><div><h1 id="workspace-signals-title">Signals</h1><span>{signals.length} active</span></div></header>
    <div className="workspace-signals-controls">
      <nav className="workspace-filter-row workspace-filter-tabs" aria-label="Signal filters">
        <button className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>All</button>
        <button className={filter === "high" ? "active" : ""} onClick={() => setFilter("high")}>High risk</button>
        <button className={filter === "unread" ? "active" : ""} onClick={() => setFilter("unread")}>Unread <span>{unreadCount}</span></button>
        <button className={filter === "watchlist" ? "active" : ""} onClick={() => setFilter("watchlist")}>Watchlist <span>{watchedIds.size}</span></button>
      </nav>
      <CompactMenu className="workspace-signals-sort workspace-filter-menu" ariaLabel="Filter signals" value={filter} onChange={setFilter} options={[{ value: "all", label: "All" }, { value: "high", label: "High risk" }, { value: "unread", label: `Unread ${unreadCount}` }, { value: "watchlist", label: `Watchlist ${watchedIds.size}` }]} />
      <label className="workspace-signals-search"><MagnifyingGlass size={14} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter signals" aria-label="Filter signals" />{query && <button type="button" onClick={() => setQuery("")} aria-label="Clear signal filter"><X size={13} /></button>}</label>
      <CompactMenu className="workspace-signals-sort" ariaLabel="Sort signals" value={sort} onChange={setSort} options={[{ value: "newest", label: "Newest" }, { value: "risk", label: "Highest risk" }]} />
    </div>
    <div className="workspace-signal-columns" aria-hidden="true"><span>Signal</span><span>Domain</span><span>Source</span><span>Observed</span><span /></div>
    {visibleSignals.length > 0 ? <div className="workspace-signal-list">{visibleSignals.map((signal) => {
      const unread = !readIds.has(signal.id);
      const watched = watchedIds.has(signal.id);
      return <article key={signal.id} className={`workspace-signal-row${unread ? " unread" : ""}`}>
        <button type="button" className="workspace-signal-open" onClick={() => openSignal(signal)}>
          <span className={`workspace-signal-risk ${signal.risk}`}><SignalIcon domain={signal.domain} /></span>
          <span className="workspace-signal-copy"><b>{signal.name}</b><small>{signal.description || signal.location?.label || "No description available."}</small></span>
          <span className="workspace-signal-domain">{signal.domain}</span>
          <span className="workspace-signal-source">{signal.source.name}</span>
          <time dateTime={signal.observedAt} title={new Date(signal.observedAt).toLocaleString()}>{signalAge(signal.observedAt)}</time>
          <CaretRight size={14} />
        </button>
        <button type="button" className={watched ? "workspace-signal-watch active" : "workspace-signal-watch"} onClick={() => toggleWatch(signal.id)} aria-label={watched ? `Remove ${signal.name} from watchlist` : `Add ${signal.name} to watchlist`} aria-pressed={watched}><Star size={14} weight={watched ? "fill" : "regular"} /></button>
      </article>;
    })}</div> : <div className="workspace-empty-state"><span aria-hidden="true" /><p>No signals match this view.</p></div>}
  </section>;
}

function EntityWorkspace({ entities, onInspect }: { entities: Entity[]; onInspect: (content: InspectorRef) => void }) {
  const [filter, setFilter] = useState<EntityFilter>("all");
  const [sort, setSort] = useState<EntitySort>("newest");
  const [query, setQuery] = useState("");
  const [watchedIds, setWatchedIds] = useState<Set<string>>(() => new Set());
  const visibleEntities = useMemo(() => entities
    .filter((entity) => filter !== "high" || entity.risk === "high")
    .filter((entity) => filter !== "located" || Boolean(entity.location?.label))
    .filter((entity) => filter !== "watchlist" || watchedIds.has(entity.id))
    .filter((entity) => !query.trim() || matchesSearch(query, entity.name, entity.description, entity.source.name, entity.domain, entity.location?.label, entity.providerId))
    .sort((left, right) => {
      if (sort === "name") return left.name.localeCompare(right.name);
      if (sort === "risk") return signalRiskRank[right.risk] - signalRiskRank[left.risk] || right.observedAt.localeCompare(left.observedAt);
      return right.observedAt.localeCompare(left.observedAt);
    }), [entities, filter, query, sort, watchedIds]);
  const toggleWatch = (entityId: string) => setWatchedIds((current) => {
    const next = new Set(current);
    if (next.has(entityId)) next.delete(entityId);
    else next.add(entityId);
    return next;
  });

  return <section className="workspace-foundation workspace-foundation-entities workspace-signals workspace-entities" aria-labelledby="workspace-entities-title">
    <header className="workspace-foundation-head workspace-signals-head"><div><h1 id="workspace-entities-title">Entities</h1><span>{entities.length} indexed</span></div></header>
    <div className="workspace-signals-controls">
      <nav className="workspace-filter-row workspace-filter-tabs" aria-label="Entity filters">
        <button className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>All</button>
        <button className={filter === "high" ? "active" : ""} onClick={() => setFilter("high")}>High risk</button>
        <button className={filter === "located" ? "active" : ""} onClick={() => setFilter("located")}>Located</button>
        <button className={filter === "watchlist" ? "active" : ""} onClick={() => setFilter("watchlist")}>Watchlist <span>{watchedIds.size}</span></button>
      </nav>
      <CompactMenu className="workspace-signals-sort workspace-filter-menu" ariaLabel="Filter entities" value={filter} onChange={setFilter} options={[{ value: "all", label: "All" }, { value: "high", label: "High risk" }, { value: "located", label: "Located" }, { value: "watchlist", label: `Watchlist ${watchedIds.size}` }]} />
      <label className="workspace-signals-search"><MagnifyingGlass size={14} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter entities" aria-label="Filter entities" />{query && <button type="button" onClick={() => setQuery("")} aria-label="Clear entity filter"><X size={13} /></button>}</label>
      <CompactMenu className="workspace-signals-sort" ariaLabel="Sort entities" value={sort} onChange={setSort} options={[{ value: "newest", label: "Newest" }, { value: "risk", label: "Highest risk" }, { value: "name", label: "Name" }]} />
    </div>
    <div className="workspace-signal-columns" aria-hidden="true"><span>Entity</span><span>Domain</span><span>Location</span><span>Observed</span><span /></div>
    {visibleEntities.length > 0 ? <div className="workspace-signal-list">{visibleEntities.map((entity) => {
      const watched = watchedIds.has(entity.id);
      return <article key={entity.id} className="workspace-signal-row entity">
        <button type="button" className="workspace-signal-open" onClick={() => onInspect({ kind: "entity", id: entity.id, sourceLens: "entities" })}>
          <span className={`workspace-signal-risk ${entity.risk}`}><SignalIcon domain={entity.domain} /></span>
          <span className="workspace-signal-copy"><b>{entity.name}</b><small>{entity.description || entity.location.label || "No description available."}</small></span>
          <span className="workspace-signal-domain">{entity.domain}</span>
          <span className="workspace-signal-source">{entity.location.label || `${entity.location.coordinates.lat.toFixed(2)}°, ${entity.location.coordinates.lng.toFixed(2)}°`}</span>
          <time dateTime={entity.observedAt} title={new Date(entity.observedAt).toLocaleString()}>{signalAge(entity.observedAt)}</time>
          <CaretRight size={14} />
        </button>
        <button type="button" className={watched ? "workspace-signal-watch active" : "workspace-signal-watch"} onClick={() => toggleWatch(entity.id)} aria-label={watched ? `Remove ${entity.name} from watchlist` : `Add ${entity.name} to watchlist`} aria-pressed={watched}><Star size={14} weight={watched ? "fill" : "regular"} /></button>
      </article>;
    })}</div> : <div className="workspace-empty-state"><span aria-hidden="true" /><p>No entities match this view.</p></div>}
  </section>;
}

function ModeFoundation({ mode }: { mode: Exclude<WorkspaceMode, "map" | "settings" | "signals" | "entities"> }) {
  const copy = modeCopy[mode];
  const [filter, setFilter] = useState("all");
  return (
    <section className={`workspace-foundation workspace-foundation-${mode}`} aria-labelledby="workspace-mode-title">
      <header className="workspace-foundation-head">
        <h1 id="workspace-mode-title">{copy.title}</h1>
        {copy.action && <button type="button"><CirclesThreePlus size={17} />{copy.action}</button>}
      </header>
      {mode === "brief" && <nav className="workspace-filter-row" aria-label="Brief range">{["current", "6 hours", "24 hours", "7 days"].map((item) => <button key={item} className={filter === item ? "active" : ""} onClick={() => setFilter(item)}>{item}</button>)}</nav>}
      <div className="workspace-empty-state">
        <span aria-hidden="true" />
        <p>{copy.empty}</p>
      </div>
    </section>
  );
}

function InspectorPanel({ content, corpus, onClose, onPin, onUnpin, onViewMap, presentation }: { content: InspectorRef; corpus: WorkspaceSearchCorpus; onClose: () => void; onPin: () => void; onUnpin: () => void; onViewMap: (selection: Omit<WorkspaceSearchSelection, "token">) => void; presentation: "overlay" | "split" }) {
  const record = content.kind === "signal" ? corpus.signals.find((item) => item.id === content.id) : content.kind === "entity" ? corpus.entities.find((item) => item.id === content.id) : undefined;
  return <aside className={`workspace-inspector workspace-inspector-${presentation}`} aria-label={`${content.kind} inspector`}>
    <header><span>{content.kind}</span><div><button type="button" onClick={presentation === "split" ? onUnpin : onPin} aria-label={presentation === "split" ? "Unpin inspector" : "Pin inspector"} title={presentation === "split" ? "Unpin" : "Pin"}><PushPin size={15} weight={presentation === "split" ? "fill" : "regular"} /></button><button type="button" onClick={onClose} aria-label="Close inspector"><X size={16} /></button></div></header>
    {record ? <div className="workspace-inspector-content"><div className="workspace-inspector-lead"><span className={`workspace-inspector-icon ${record.risk}`}><SignalIcon domain={record.domain} /></span><span className={`workspace-inspector-risk ${record.risk}`}>{record.risk} risk</span></div><h2>{record.name}</h2><p>{record.description || "No description available."}</p><dl><div><dt>Observed</dt><dd>{new Date(record.observedAt).toLocaleString()}</dd></div><div><dt>Domain</dt><dd>{record.domain}</dd></div><div><dt>Risk score</dt><dd>{record.riskScore}</dd></div>{record.location?.label && <div><dt>Location</dt><dd>{record.location.label}</dd></div>}<div><dt>Source</dt><dd>{record.source.name}</dd></div><div><dt>Provider</dt><dd>{record.providerId}</dd></div></dl><div className="workspace-inspector-actions">{record.location?.coordinates && <button type="button" className="workspace-inspector-map" onClick={() => onViewMap({ kind: record.kind, value: record } as Omit<WorkspaceSearchSelection, "token">)}><MapTrifold size={15} />View on map<ArrowSquareOut size={13} /></button>}{record.url && <a href={record.url} target="_blank" rel="noreferrer">Open source<ArrowSquareOut size={13} /></a>}</div></div> : <div className="workspace-inspector-missing"><p>This object is not available in the current intelligence snapshot.</p></div>}
  </aside>;
}

function SettingsWorkspace({ ready, settings, onChange }: WorkspaceMapSettingsState & { onChange: (change: Partial<MapSettings>) => void }) {
  return <section className="workspace-foundation workspace-settings-view" aria-labelledby="workspace-settings-title">
    <header className="workspace-foundation-head"><h1 id="workspace-settings-title">Settings</h1></header>
    <div className="workspace-settings-grid" aria-busy={!ready}>
      <section>
        <h2>Time</h2>
        <label><span>Time zone</span><select value={settings.timeZone} disabled={!ready} onChange={(event) => onChange({ timeZone: event.target.value as MapTimeZone })}>{timeZoneOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
        <label><span>Time format</span><select value={settings.timeFormat} disabled={!ready} onChange={(event) => onChange({ timeFormat: event.target.value as TimeFormat })}><option value="24h">24-hour</option><option value="12h">12-hour</option></select></label>
      </section>
      <section>
        <h2>Map</h2>
        <div className="workspace-settings-row"><span>Ticker feed</span><button type="button" role="switch" aria-checked={settings.tickerVisible} className={settings.tickerVisible ? "active" : ""} disabled={!ready} onClick={() => onChange({ tickerVisible: !settings.tickerVisible })}><span>{settings.tickerVisible ? "Visible" : "Hidden"}</span><i aria-hidden="true" /></button></div>
        <div className="workspace-settings-row"><span>Signal panel</span><button type="button" role="switch" aria-checked={settings.signalPanelEnabled} className={settings.signalPanelEnabled ? "active" : ""} disabled={!ready} onClick={() => onChange({ signalPanelEnabled: !settings.signalPanelEnabled })}><span>{settings.signalPanelEnabled ? "Enabled" : "Disabled"}</span><i aria-hidden="true" /></button></div>
      </section>
    </div>
  </section>;
}

export function WorkspaceShell() {
  const [shell, dispatch] = useReducer(workspaceShellReducer, defaultWorkspaceShellState);
  const [feedStatus, setFeedStatus] = useState<FeedStatus>("SYNCING");
  const [searchCorpus, setSearchCorpus] = useState<WorkspaceSearchCorpus>({ signals: [], entities: [] });
  const [searchSelection, setSearchSelection] = useState<WorkspaceSearchSelection | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [workspaceToolRequest, setWorkspaceToolRequest] = useState<WorkspaceToolRequest | null>(null);
  const [workspaceToolState, setWorkspaceToolState] = useState<WorkspaceToolState>({ chatOpen: false, actionsOpen: false });
  const [briefUnread, setBriefUnread] = useState(false);
  const [mapSettingsState, setMapSettingsState] = useState<WorkspaceMapSettingsState>({ settings: defaultMapSettings, ready: false });
  const [mapSettingsRequest, setMapSettingsRequest] = useState<WorkspaceMapSettingsRequest | null>(null);
  const [renderedSplitContent, setRenderedSplitContent] = useState<InspectorRef | null>(null);
  const [splitExiting, setSplitExiting] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const splitDragRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const [shellReady, setShellReady] = useState(false);
  const mode = shell.activeLens;
  const setMode = (lens: WorkspaceMode) => dispatch({ type: "open-lens", lens });

  useEffect(() => {
    const splitWidth = Number(window.localStorage.getItem("terracdm:workspace:split-width"));
    dispatch({ type: "restore", state: { ...readWorkspaceLocation(window.location.search), ...(Number.isFinite(splitWidth) && splitWidth > 0 ? { splitWidth } : {}) } });
    setShellReady(true);
    const restoreNavigation = () => dispatch({ type: "restore", state: readWorkspaceLocation(window.location.search) });
    window.addEventListener("popstate", restoreNavigation);
    return () => window.removeEventListener("popstate", restoreNavigation);
  }, []);

  useEffect(() => {
    if (!shellReady) return;
    const search = writeWorkspaceLocation(shell, window.location.search);
    const nextLocation = `${window.location.pathname}${search ? `?${search}` : ""}${window.location.hash}`;
    const currentLocation = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (nextLocation !== currentLocation) window.history.pushState(window.history.state, "", nextLocation);
    window.localStorage.setItem("terracdm:workspace:split-width", String(shell.splitWidth));
  }, [shell, shellReady]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (searchOpen && searchQuery.length === 0) {
          setSearchOpen(false);
          searchInputRef.current?.blur();
          return;
        }
        setSearchOpen(true);
        requestAnimationFrame(() => searchInputRef.current?.focus());
        return;
      }
      if (event.key === "Escape" && searchOpen) {
        setSearchQuery("");
        setSearchOpen(false);
        searchInputRef.current?.blur();
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      const nextMode = modes.find((item) => item.shortcut === event.key)?.id;
      if (nextMode) setMode(nextMode);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [searchOpen, searchQuery]);

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const response = await fetch("/api/overview", { cache: "no-store" });
        if (!response.ok) return;
        const payload = await response.json() as { artifact?: { id: string } | null };
        if (!cancelled && payload.artifact?.id) setBriefUnread(window.localStorage.getItem("terracdm:brief:viewed") !== payload.artifact.id);
      } catch { /* A brief badge is non-critical. */ }
    };
    void check();
    const interval = window.setInterval(() => void check(), 15_000);
    return () => { cancelled = true; window.clearInterval(interval); };
  }, []);

  useEffect(() => {
    if (mode !== "brief") return;
    setBriefUnread(false);
  }, [mode]);

  const selectSearchResult = (selection: Omit<WorkspaceSearchSelection, "token">) => {
    if (selection.kind === "place") {
      setMode("map");
      setSearchSelection({ ...selection, token: Date.now() } as WorkspaceSearchSelection);
    } else {
      dispatch({ type: "open-inspector", content: { kind: selection.kind, id: selection.value.id, sourceLens: mode } });
    }
    setSearchQuery("");
    setSearchOpen(false);
  };

  const viewOnMap = (selection: Omit<WorkspaceSearchSelection, "token">) => {
    setMode("map");
    setSearchSelection({ ...selection, token: Date.now() } as WorkspaceSearchSelection);
  };

  const beginSplitResize = (event: ReactPointerEvent<HTMLButtonElement>) => {
    splitDragRef.current = { startX: event.clientX, startWidth: shell.splitWidth };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const resizeSplit = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!splitDragRef.current) return;
    dispatch({ type: "resize-split", width: splitDragRef.current.startWidth + splitDragRef.current.startX - event.clientX });
  };

  const toggleWorkspaceTool = (kind: WorkspaceToolRequest["kind"], trigger: HTMLButtonElement) => {
    setWorkspaceToolRequest({ kind, anchorX: trigger.getBoundingClientRect().right, token: Date.now() });
  };

  const askFromBrief = (prompt: string, development?: BriefDevelopment) => {
    const references: ChatReference[] = [
      ...(development?.signalIds ?? []).map((id) => searchCorpus.signals.find((item) => item.id === id)).filter((item): item is Signal => Boolean(item)).map((signal) => ({ id: signal.id, kind: "signal" as const, name: signal.name, type: signal.domain, accent: "#56d7ff", signal })),
      ...(development?.entityIds ?? []).map((id) => searchCorpus.entities.find((item) => item.id === id)).filter((item): item is Entity => Boolean(item)).map((entity) => ({ id: entity.id, kind: "entity" as const, name: entity.name, type: entity.domain, accent: "#56d7ff", entity })),
    ];
    setWorkspaceToolRequest({ kind: "chat", anchorX: window.innerWidth - 180, token: Date.now(), prompt, references });
  };

  const updateMapSettings = (change: Partial<MapSettings>) => setMapSettingsRequest({ change, token: Date.now() });

  const splitOpen = shell.inspector?.presentation === "split";
  const activeSplitContent = shell.inspector?.presentation === "split" ? shell.inspector.content : null;

  useEffect(() => {
    if (activeSplitContent) {
      setRenderedSplitContent(activeSplitContent);
      setSplitExiting(false);
      return;
    }
    if (!renderedSplitContent) return;
    setSplitExiting(true);
    const timer = window.setTimeout(() => {
      setRenderedSplitContent(null);
      setSplitExiting(false);
    }, 240);
    return () => window.clearTimeout(timer);
  }, [activeSplitContent]);

  return (
    <main className="workspace-shell" data-split={splitOpen ? "true" : "false"} style={{ "--workspace-split-width": `${shell.splitWidth}px` } as CSSProperties}>
      <div className="workspace-primary">
      <header className="workspace-topbar">
        <button className="workspace-brand" type="button" onClick={() => setMode("map")} aria-label="Open map">
          <GlobeHemisphereWest size={20} weight="duotone" />
          <span>TERRACDM</span>
        </button>
        <nav className="workspace-mode-nav" aria-label="Workspace modes">
          {modes.map(({ id, label, icon: Icon, shortcut }) => <button key={id} type="button" className={mode === id ? "active" : ""} onClick={() => setMode(id)} aria-current={mode === id ? "page" : undefined} title={`${label} · ${shortcut}`}><Icon size={15} weight={mode === id ? "fill" : "regular"} /><span>{label}</span>{id === "brief" && briefUnread && <i className="workspace-nav-unread" />}</button>)}
        </nav>
        {splitOpen && <CompactMenu className="workspace-mode-select workspace-desktop-mode-select" ariaLabel="Workspace view" value={mode} onChange={setMode} options={[...modes.map(({ id, label }) => ({ value: id, label })), { value: "settings", label: "Settings" }]} />}
        <CompactMenu className="workspace-mode-select workspace-mobile-mode-select" ariaLabel="Workspace navigation" value={mode} onChange={setMode} options={[...modes.map(({ id, label }) => ({ value: id, label })), { value: "settings", label: "Settings" }]} />
        <SearchPalette corpus={searchCorpus} inputRef={searchInputRef} onOpenChange={setSearchOpen} onSelect={selectSearchResult} open={searchOpen} query={searchQuery} setQuery={setSearchQuery} />
        <div className="workspace-navbar-tools" role="group" aria-label="Workspace tools">
          <button className={workspaceToolState.chatOpen ? "workspace-navbar-tool active" : "workspace-navbar-tool"} type="button" onClick={(event) => toggleWorkspaceTool("chat", event.currentTarget)} aria-label="Open analyst chat" aria-pressed={workspaceToolState.chatOpen}><ChatCircleText size={17} /></button>
          <button className={workspaceToolState.actionsOpen ? "workspace-navbar-tool active" : "workspace-navbar-tool"} type="button" onClick={(event) => toggleWorkspaceTool("actions", event.currentTarget)} aria-label="Actions" aria-pressed={workspaceToolState.actionsOpen}><Stack size={17} /></button>
          <button className={mode === "settings" ? "workspace-settings active" : "workspace-settings"} type="button" onClick={() => setMode("settings")} aria-label="Settings" aria-current={mode === "settings" ? "page" : undefined}><GearSix size={17} /></button>
        </div>
        <div className={`workspace-feed-status workspace-feed-status-${feedStatus.toLowerCase()}`} role="status" aria-live="polite" title={`Feed status: ${feedStatus}`}><i aria-hidden="true" /><span>{feedStatus}</span></div>
      </header>

      <div className="workspace-stage">
        <div className="workspace-lens-stage">
          <div className={`workspace-map-stage${mode === "map" ? " active" : ""}`} aria-hidden={mode !== "map"} {...(mode !== "map" ? { inert: true } : {})}><MaplibreReactSpike mapSettingsRequest={mapSettingsRequest} onFeedStatusChange={setFeedStatus} onMapSettingsStateChange={setMapSettingsState} onOpenSignalsWorkspace={() => setMode("signals")} onSearchCorpusChange={setSearchCorpus} onWorkspaceToolStateChange={setWorkspaceToolState} searchSelection={searchSelection} workspaceToolRequest={workspaceToolRequest} /></div>
          {workspaceLenses.filter((lens): lens is Exclude<WorkspaceMode, "map" | "settings"> => lens !== "map" && lens !== "settings").map((lens) => shell.visitedLenses.includes(lens) && <div key={lens} className={`workspace-lens${mode === lens ? " active" : ""}`} aria-hidden={mode !== lens} {...(mode !== lens ? { inert: true } : {})}>{lens === "signals" ? <SignalWorkspace signals={searchCorpus.signals} onInspect={(content) => { dispatch({ type: "open-inspector", content }); dispatch({ type: "pin-inspector" }); }} /> : lens === "entities" ? <EntityWorkspace entities={searchCorpus.entities} onInspect={(content) => { dispatch({ type: "open-inspector", content }); dispatch({ type: "pin-inspector" }); }} /> : lens === "brief" ? <BriefWorkspace corpus={searchCorpus} onAsk={askFromBrief} onInspect={(content) => { dispatch({ type: "open-inspector", content }); dispatch({ type: "pin-inspector" }); }} onNavigate={setMode} onViewMap={viewOnMap} /> : <ModeFoundation mode={lens} />}</div>)}
          {shell.visitedLenses.includes("settings") && <div className={`workspace-lens${mode === "settings" ? " active" : ""}`} aria-hidden={mode !== "settings"} {...(mode !== "settings" ? { inert: true } : {})}><SettingsWorkspace {...mapSettingsState} onChange={updateMapSettings} /></div>}
          {shell.inspector?.presentation === "overlay" && <><button type="button" className="workspace-inspector-scrim" onClick={() => dispatch({ type: "close-inspector" })} aria-label="Close inspector" /><InspectorPanel content={shell.inspector.content} corpus={searchCorpus} presentation="overlay" onClose={() => dispatch({ type: "close-inspector" })} onPin={() => dispatch({ type: "pin-inspector" })} onUnpin={() => dispatch({ type: "unpin-inspector" })} onViewMap={viewOnMap} /></>}
        </div>
      </div>
      </div>
      <div className={`workspace-split${splitExiting ? " exiting" : ""}`} aria-hidden={!splitOpen}><button type="button" className="workspace-split-handle" onPointerDown={beginSplitResize} onPointerMove={resizeSplit} onPointerUp={() => { splitDragRef.current = null; }} aria-label="Resize inspector" tabIndex={splitOpen ? 0 : -1} />{renderedSplitContent && <InspectorPanel content={renderedSplitContent} corpus={searchCorpus} presentation="split" onClose={() => dispatch({ type: "close-inspector" })} onPin={() => dispatch({ type: "pin-inspector" })} onUnpin={() => dispatch({ type: "unpin-inspector" })} onViewMap={viewOnMap} />}</div>
    </main>
  );
}
