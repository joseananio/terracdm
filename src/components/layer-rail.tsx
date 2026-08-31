"use client";

import { useEffect, useRef, type CSSProperties, type ElementType, type ReactNode } from "react";
import { AirplaneTilt, Boat, Broadcast, Bug, Camera, Fire, Pulse, Rocket, ShieldWarning, Stack, Stamp, TelegramLogo, X } from "@phosphor-icons/react";
import { Domain, IntelligenceSnapshot, layerDetails, layers } from "@/src/lib/intelligence";
import { observationsToEntities, observationsToSignals } from "@/src/lib/catalog/observations";
import { isFireDomainId } from "@/src/lib/catalog/domains";

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

function LayerIcon({ domain }: { domain: string }) {
  const Icon = isFireDomainId(domain) ? Fire : icons[domain] ?? Pulse;
  return <Icon size={15} weight="duotone" />;
}

type LayerRailProps = {
  activeLayers: string[];
  loadingLayers?: Domain[];
  detailState: Partial<Record<Domain, string[]>>;
  layersData: typeof layers;
  snapshot: IntelligenceSnapshot;
  selectedLayer: Domain;
  open: boolean;
  onSelect: (domain: Domain) => void;
  onToggleLayer: (domain: Domain) => void;
  onToggleAll: () => void;
  onToggleDetail: (domain: Domain, detailId: string) => void;
  onClose: () => void;
  topControl?: ReactNode;
};

export function LayerRail({ activeLayers, loadingLayers = [], detailState, layersData, snapshot, selectedLayer, open, onSelect, onToggleLayer, onToggleAll, onToggleDetail, onClose, topControl }: LayerRailProps) {
  const layerSystemRef = useRef<HTMLDivElement>(null);
  const closeTimerRef = useRef<number | null>(null);
  const selected = layersData.find((layer) => layer.id === selectedLayer) ?? layersData[0];
  const selectedIndex = Math.max(0, layersData.findIndex((layer) => layer.id === selected.id));
  const details = layerDetails[selected.id];
  const selectedDetails = detailState[selected.id] ?? ["all"];
  const allLayersActive = activeLayers.length === layersData.length;
  const entities = observationsToEntities(snapshot.observations);
  const signals = observationsToSignals(snapshot.observations);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && !layerSystemRef.current?.contains(target)) onClose();
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [onClose, open]);

  useEffect(() => () => {
    if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
  }, []);

  const cancelClose = () => {
    if (closeTimerRef.current === null) return;
    window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = null;
  };

  const deferClose = () => {
    cancelClose();
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null;
      onClose();
    }, 260);
  };

  return <div ref={layerSystemRef} className={`layer-system ${open ? "open" : ""}`} onMouseEnter={cancelClose} onMouseLeave={deferClose}>
    <nav className="layer-system-rail" aria-label="intelligence layers">
      {topControl && <div className="layer-rail-top-control">{topControl}</div>}
      {topControl && <div className="layer-rail-separator" aria-hidden="true" />}
      <button className={`layer-rail-close ${allLayersActive ? "all-active" : ""}`} onClick={onToggleAll} aria-label={allLayersActive ? "Disable all layers" : "Enable all layers"} title={allLayersActive ? "Disable all layers" : "Enable all layers"} aria-pressed={allLayersActive}><Stack size={17} weight="duotone" /></button>
      {layersData.map((layer) => {
        const active = activeLayers.includes(layer.id);
        const current = open && selected.id === layer.id;
        const hasDetail = (detailState[layer.id] ?? []).some((id) => id !== "all") || active;
        return <button key={layer.id} className={`layer-rail-button ${active ? "active" : ""} ${current ? "current" : ""} ${hasDetail ? "has-detail" : ""}`} style={{ color: active || current ? layer.color : undefined }} onMouseEnter={() => onSelect(layer.id)} onFocus={() => onSelect(layer.id)} onClick={() => onSelect(layer.id)} aria-label={`${layer.label} layer`} aria-pressed={active}><LayerIcon domain={layer.id} /></button>;
      })}
    </nav>
    {open && <section className="layer-detail-panel" style={{ "--layer-color": selected.color, "--layer-offset": `${selectedIndex * 42}px` } as CSSProperties} aria-label={`${selected.label} layer details`}>
      <div className="layer-detail-panel-head"><div><span className="eyebrow">{selected.label.toUpperCase()}</span><strong>{selected.source}</strong></div><button onClick={onClose} aria-label="close layer details"><X size={16} /></button></div>
      <div className="layer-detail-list">{details.map((detail) => {
        const count = selected.id === "cyber"
          ? signals.filter((signal) => signal.domain === "cyber" && (detail.id === "all" || (detail.id === "critical" && signal.risk === "high"))).length
          : entities.filter((entity) => entity.domain === selected.id && detail.match(entity)).length;
        const loading = loadingLayers.includes(selected.id) || !snapshot.fetchedAt;
        return <button key={detail.id} className={`layer-detail-row ${selectedDetails.includes(detail.id) ? "active" : "none-selected"}`} onClick={() => onToggleDetail(selected.id, detail.id)} aria-pressed={selectedDetails.includes(detail.id)}><span className="layer-detail-toggle"><i /></span><span>{detail.label}</span><b className={`layer-detail-count ${loading ? "is-loading" : ""}`} aria-label={loading ? "Loading count" : `${count.toLocaleString()} records`}>{loading ? <span aria-hidden="true" /> : count.toLocaleString()}</b></button>;
      })}</div>
    </section>}
  </div>;
}
