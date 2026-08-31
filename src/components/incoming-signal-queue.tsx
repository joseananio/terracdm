"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties, type ElementType, type PointerEvent as ReactPointerEvent } from "react";
import { AirplaneTilt, Bell, Boat, Broadcast, Bug, Camera, CaretDown, CaretRight, Fire, Pulse, Rocket, ShieldWarning, Stamp, TelegramLogo } from "@phosphor-icons/react";
import { Entity, Signal } from "@/src/lib/intelligence";
import { isFireDomainId } from "@/src/lib/catalog/domains";
import { setSignalQueueOpen, useSignalQueueOpen } from "@/src/lib/signal-queue-store";
import { FloatingPanel } from "@/src/components/floating-panel";

const icons: Record<string, ElementType> = {
  aviation: AirplaneTilt,
  maritime: Boat,
  "natural-hazards": Pulse,
  space: Rocket,
  conflict: ShieldWarning,
  cyber: Bug,
  fires: Fire,
  cctv: Camera,
  news: Broadcast,
  sanctions: Stamp,
  telegram: TelegramLogo,
};

export function SignalIcon({ domain }: { domain: string }) {
  const Icon = isFireDomainId(domain) ? Fire : icons[domain] ?? Pulse;
  return <Icon size={15} weight="duotone" />;
}

function relativeSignalAge(value: string) {
  const elapsedMinutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60_000));
  if (elapsedMinutes < 1) return "now";
  if (elapsedMinutes < 60) return `${elapsedMinutes}m`;
  const hours = Math.floor(elapsedMinutes / 60);
  return hours < 24 ? `${hours}h` : `${Math.floor(hours / 24)}d`;
}

function SignalRow({ signal, onClick }: { signal: Signal; onClick: () => void }) {
  return <button className="signal-row" onClick={onClick}><span className={`signal-icon ${signal.risk}`}><SignalIcon domain={signal.domain} /></span><span className="signal-copy"><span className="signal-title">{signal.name}</span><span className="signal-detail">{signal.description}</span></span><span className="signal-time"><time dateTime={signal.observedAt} title={new Date(signal.observedAt).toLocaleString()}>{relativeSignalAge(signal.observedAt)}</time><small>{signal.source.name}</small></span><CaretRight size={15} className="signal-arrow" /></button>;
}

type IncomingSignalQueueProps = {
  signals: Signal[];
  status: string;
  matchingEntities?: Entity[];
  query?: string;
  onOpenSignal?: (signal: Signal) => void;
  onOpenEntity?: (entity: Entity) => void;
  onViewAll?: () => void;
};

type QueueDragState = {
  startX: number;
  startY: number;
  baseX: number;
  baseY: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
};

export function IncomingSignalQueue({ signals, status, matchingEntities = [], query = "", onOpenSignal = () => undefined, onOpenEntity = () => undefined, onViewAll = () => undefined }: IncomingSignalQueueProps) {
  const open = useSignalQueueOpen();
  const panelRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<QueueDragState | null>(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const prioritySignals = useMemo(() => [...signals]
    .sort((left, right) => ({ high: 3, medium: 2, low: 1 })[right.risk] - ({ high: 3, medium: 2, low: 1 })[left.risk] || right.observedAt.localeCompare(left.observedAt))
    .slice(0, 5), [signals]);

  const handleDragStart = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !(event.target instanceof Element) || !event.target.closest(".queue-head") || event.target.closest("button")) return;
    const panel = panelRef.current;
    if (!panel) return;
    const rect = panel.getBoundingClientRect();
    dragRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      baseX: dragOffset.x,
      baseY: dragOffset.y,
      minX: 8 - rect.left,
      maxX: window.innerWidth - 8 - rect.right,
      minY: 8 - rect.top,
      maxY: window.innerHeight - 8 - rect.bottom,
    };
    setDragging(true);
    event.preventDefault();
  };

  useEffect(() => {
    if (!dragging) return;
    const handleDragMove = (event: globalThis.PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const deltaX = Math.min(Math.max(event.clientX - drag.startX, drag.minX), drag.maxX);
      const deltaY = Math.min(Math.max(event.clientY - drag.startY, drag.minY), drag.maxY);
      setDragOffset({ x: drag.baseX + deltaX, y: drag.baseY + deltaY });
    };
    const handleDragEnd = () => {
      dragRef.current = null;
      setDragging(false);
    };
    window.addEventListener("pointermove", handleDragMove);
    window.addEventListener("pointerup", handleDragEnd);
    window.addEventListener("pointercancel", handleDragEnd);
    return () => {
      window.removeEventListener("pointermove", handleDragMove);
      window.removeEventListener("pointerup", handleDragEnd);
      window.removeEventListener("pointercancel", handleDragEnd);
    };
  }, [dragging]);

  useEffect(() => {
    const resetDragAfterResize = () => setDragOffset({ x: 0, y: 0 });
    window.addEventListener("resize", resetDragAfterResize);
    return () => window.removeEventListener("resize", resetDragAfterResize);
  }, []);

  if (!open) return <button type="button" className="map-signal-queue-trigger" onClick={() => setSignalQueueOpen(true)} aria-controls="incoming-signal-queue" aria-expanded="false" aria-label={`Open incoming signals, ${signals.length} active`} title={`${signals.length.toLocaleString()} incoming signals`}><Bell size={17} weight="duotone" /></button>;
  return (
    <FloatingPanel
      ref={panelRef}
      id="incoming-signal-queue"
      className={`incoming-panel${dragging ? " is-dragging" : ""}`}
      style={{ "--queue-drag-x": `${dragOffset.x}px`, "--queue-drag-y": `${dragOffset.y}px` } as CSSProperties}
      onPointerDown={handleDragStart}
    >
      <div className="queue-head">
        <strong>Incoming signals</strong>
        <div className="queue-head-actions">
          <div className="queue-state"><b>{signals.length.toLocaleString()}</b><small>{status}</small></div>
          <button className="queue-collapse" onClick={() => setSignalQueueOpen(false)} aria-label="Collapse incoming signal queue" title="Collapse incoming signal queue"><CaretDown size={14} /></button>
        </div>
      </div>
      <div className="queue-scroll">
        {prioritySignals.map((signal) => <SignalRow key={signal.id} signal={signal} onClick={() => onOpenSignal(signal)} />)}
        {query && matchingEntities.slice(0, 3).map((entity) => <button className="entity-result" key={entity.id} onClick={() => onOpenEntity(entity)}><SignalIcon domain={entity.domain} /><span>{entity.name}</span><small>{entity.domain.toUpperCase()}</small><CaretRight size={13} /></button>)}
        {!signals.length && !matchingEntities.length && <div className="empty-state">{query ? "No incoming records match your search." : "No unresolved signals."}</div>}
      </div>
      {signals.length > 0 && <button type="button" className="queue-view-all" onClick={() => { setSignalQueueOpen(false); onViewAll(); }}>View all signals<CaretRight size={13} /></button>}
    </FloatingPanel>
  );
}
