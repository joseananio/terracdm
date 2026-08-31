"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { ChatCircleText, MapPin, Planet, ShareNetwork, X } from "@phosphor-icons/react";
import { Entity, MediaSource, layers } from "@/src/lib/intelligence";
import { getSignalPack } from "@/src/lib/catalog/registry";
import { isFireDomainId } from "@/src/lib/catalog/domains";
import { formatCatalogValue, resolveCatalogValue } from "@/src/lib/catalog/value";
import { MediaRenderer, MediaSourcePicker, mediaSourceOptions } from "@/src/components/media-renderer";
import { SignalIcon } from "@/src/components/incoming-signal-queue";

type MapNodeSheetProps = {
  entity: Entity;
  onClose: () => void;
  onAgent?: (entity: Entity, command?: string) => void;
  onGraph?: (entity: Entity) => void;
  facts?: Array<{ label: string; value: string }>;
  observedLabel?: string;
  media?: MediaSource;
  showDetail?: boolean;
  showMediaSourcePicker?: boolean;
  sourceActionLabel?: string;
};

function nodeLocation(entity: Entity) {
  const coordinates = entity.location.coordinates;
  const city = String(entity.properties?.city ?? "").trim();
  const country = String(entity.properties?.country ?? "").trim();
  const county = String(entity.properties?.county ?? "").trim();
  if (entity.domain === "cctv" && county) return [city, county].filter(Boolean).join(", ");
  if (city || country) return [city, country].filter(Boolean).join(", ");
  return `${coordinates.lat.toFixed(3)}° / ${coordinates.lng.toFixed(3)}°`;
}

function formatSubgroup(value: unknown) {
  return String(value)
    .replaceAll(/[-_]+/g, " ")
    .replaceAll(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

function dateFromDetail(value: string) {
  return value.match(/\b\d{4}-\d{2}-\d{2}\b/)?.[0];
}

function nodeSubgroup(entity: Entity) {
  const properties = entity.properties ?? {};

  if (isFireDomainId(entity.domain)) return String(properties.fireKind ?? "fire observation");

  switch (entity.domain) {
    case "aviation":
      return formatSubgroup(properties.aircraftClass ?? "aircraft");
    case "maritime":
      return formatSubgroup(properties.vesselClass ?? properties.kind ?? "maritime");
    case "natural-hazards":
      if (entity.subdomainId === "seismic") return "EARTHQUAKE";
      return formatSubgroup(String(properties.weatherType ?? (String(entity.description).split(" · ")[0] || "weather event")));
    case "space":
      return formatSubgroup(properties.spaceClass ?? (entity.id.startsWith("noaa:") ? "space weather" : "satellite"));
    case "conflict":
      return "THEATER";
    case "cyber":
      return "VULNERABILITY";
    case "cctv":
      return "TRAFFIC CAMERA";
    case "news":
      return "NEWS";
    case "sanctions":
      return "SANCTIONS RECORD";
    case "telegram":
      return "PUBLIC CHANNEL";
    default:
      return formatSubgroup(entity.domain);
  }
}

function nodeSubgroupLabel(entity: Entity) {
  if (isFireDomainId(entity.domain)) return "TYPE";

  switch (entity.domain) {
    case "aviation": return "CLASS";
    case "maritime": return entity.properties?.vesselClass ? "CLASS" : "TYPE";
    case "natural-hazards": return "TYPE";
    case "space": return entity.id.startsWith("noaa:") ? "TYPE" : "MISSION";
    case "conflict": return "TYPE";
    case "cyber": return "TYPE";
    case "cctv": return "TYPE";
    case "news": return "FEED";
    case "sanctions": return "TYPE";
    case "telegram": return "CHANNEL";
    default: return "TYPE";
  }
}

function broadcastMedia(entity: Entity) {
  if (entity.media) return entity.media;
  const embedUrl = String(entity.properties?.embedUrl ?? "").trim();
  const liveUrl = String(entity.properties?.liveUrl ?? "").trim();
  if (embedUrl) return { kind: "iframe" as const, url: embedUrl, liveUrl };
  if (liveUrl) return { kind: "external" as const, url: liveUrl };
  return undefined;
}

function cameraMedia(entity: Entity) {
  if (entity.media) return entity.media;
  const feedUrl = String(entity.properties?.feedUrl ?? "").trim();
  const liveUrl = String(entity.properties?.liveUrl ?? "").trim();
  return feedUrl ? { kind: "jpg" as const, url: feedUrl, refreshSeconds: 30, liveUrl } : undefined;
}

type NodeAction = { id: "n2yo" | "adsb-exchange"; label: string; href: string };

function nodeAction(entity: Entity): NodeAction | null {
  const noradId = String(entity.properties?.noradId ?? "").trim();
  if (entity.domain === "space" && /^\d{1,7}$/.test(noradId)) {
    return { id: "n2yo", label: "TRACK ON N2YO", href: `https://www.n2yo.com/satellite/?s=${noradId}` };
  }
  const icao24 = String(entity.properties?.icao24 ?? "").trim().toLowerCase();
  if (entity.domain === "aviation" && /^[a-f0-9]{6}$/.test(icao24)) {
    return { id: "adsb-exchange", label: "VIEW ON ADS-B EXCHANGE", href: `https://globe.adsbexchange.com/?icao=${encodeURIComponent(icao24)}` };
  }
  return null;
}

function cameraLocationAction(entity: Entity) {
  const { lat, lng } = entity.location.coordinates;
  if (entity.domain !== "cctv" || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const query = `${lat.toFixed(6)},${lng.toFixed(6)}`;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

export function MapNodeSheet({ entity, onClose, onAgent, onGraph, facts: factsOverride, observedLabel, media: mediaOverride, showDetail, showMediaSourcePicker, sourceActionLabel }: MapNodeSheetProps) {
  const layer = layers.find((item) => item.id === entity.domain);
  const pack = getSignalPack(entity.domain);
  const configuredLabel = pack?.presentation.node?.label ? formatCatalogValue(resolveCatalogValue(entity, pack.presentation.node.label)) : entity.name;
  const accent = layer?.color ?? "#56d7ff";
  const isBroadcast = entity.domain === "news";
  const isCamera = entity.domain === "cctv";
  const source = mediaOverride ?? (isBroadcast ? broadcastMedia(entity) : isCamera ? cameraMedia(entity) : undefined);
  const mediaOptions = useMemo(() => mediaSourceOptions(source, entity.mediaSources), [entity.mediaSources, source]);
  const [activeMediaIndex, setActiveMediaIndex] = useState(0);
  useEffect(() => { setActiveMediaIndex(0); }, [source?.kind, source?.url]);
  const activeMediaSource = mediaOptions[activeMediaIndex] ?? source;
  const configuredDetail = pack?.presentation.node?.detail ? formatCatalogValue(resolveCatalogValue(entity, pack.presentation.node.detail)) : "";
  const detail = configuredDetail && configuredDetail !== "—" ? configuredDetail : typeof entity.properties?.detail === "string" ? entity.properties.detail : entity.description || "Live observation from the connected intelligence provider.";
  const displayDetail = entity.domain === "aviation"
    ? detail.replace(/\s*·\s*[\d.,]+\s*m\b.*$/i, "")
    : entity.domain === "natural-hazards" && entity.subdomainId === "seismic"
      ? detail.replace(/^\s*[\d.,]+\s+magnitude\s*·\s*/i, "")
    : entity.domain === "space"
      ? detail.replace(/^\s*[\d.,]+\s*km\s+orbit(?:\s*·\s*)?/i, "").trim() || detail
      : entity.domain === "cctv"
        ? detail.split(" · ")[0]
      : isFireDomainId(entity.domain)
        ? detail.replace(/\s*·\s*\d{4}-\d{2}-\d{2}\b.*$/, "")
          : detail;
  const observed = observedLabel ?? (entity.observedAt ? `${entity.observedAt.slice(11, 19)}Z` : "LIVE");
  const action = nodeAction(entity);
  const cameraLocationUrl = cameraLocationAction(entity);
  const altitude = Number(entity.properties?.altitudeM);
  const aviationAltitude = Number.isFinite(altitude) ? `${Math.round(altitude)} M` : "—";
  const velocity = Number(entity.properties?.velocity);
  const aviationSpeed = Number.isFinite(velocity) ? `${Math.round(velocity * 3.6)} KM/H` : "—";
  const heading = Number(entity.properties?.heading);
  const aviationHeading = Number.isFinite(heading) ? `${Math.round(heading)}°` : "—";
  const aviationIdentifier = String(entity.properties?.registration ?? entity.properties?.icao24 ?? "—").toUpperCase();
  const orbitalAltitude = Number(entity.properties?.altitudeKm);
  const spaceAltitude = Number.isFinite(orbitalAltitude) ? `${Math.round(orbitalAltitude)} KM` : "—";
  const seismicMagnitude = Number(entity.properties?.magnitude);
  const magnitude = Number.isFinite(seismicMagnitude) ? `M ${seismicMagnitude.toFixed(1)}` : "—";
  const fireDate = dateFromDetail(detail) ?? entity.observedAt?.slice(0, 10) ?? "—";
  const cameraRoute = String(entity.properties?.route ?? "").trim();
  const cameraDirection = String(entity.properties?.direction ?? "").trim();
  const cameraPostmile = Number(entity.properties?.postmile);
  const hasRoadFacts = Boolean(cameraRoute || cameraDirection || Number.isFinite(cameraPostmile));
  const cameraFacts = entity.domain === "cctv" ? [
    { label: "AGENCY", value: String(entity.properties?.source ?? entity.source.name ?? "—") },
    ...(hasRoadFacts ? [
      { label: "ROUTE", value: cameraRoute || "—" },
      { label: "DIRECTION", value: cameraDirection || "—" },
      { label: "POSTMILE", value: Number.isFinite(cameraPostmile) ? `PM ${cameraPostmile.toFixed(1)}` : "—" },
    ] : []),
  ] : [];
  const subgroup = pack?.presentation.node?.subgroup ? formatCatalogValue(resolveCatalogValue(entity, pack.presentation.node.subgroup)) : nodeSubgroup(entity);
  const defaultFacts = [
    { label: nodeSubgroupLabel(entity), value: subgroup },
    { label: "LOCATION", value: nodeLocation(entity) },
    ...(entity.domain === "cctv" ? cameraFacts : entity.domain === "aviation" ? [
      { label: "ALT", value: aviationAltitude },
      { label: "SPEED", value: aviationSpeed },
      { label: "HEADING", value: aviationHeading },
      { label: "REG / ICAO24", value: aviationIdentifier },
    ] : entity.domain === "natural-hazards" && entity.subdomainId === "seismic" ? [{ label: "MAGNITUDE", value: magnitude }] : entity.domain === "space" ? [{ label: "ALT", value: spaceAltitude }] : isFireDomainId(entity.domain) ? [{ label: "DATE", value: fireDate }] : []),
  ];
  const configuredFacts = pack?.presentation.node?.fields?.map((field) => ({ label: field.label, value: formatCatalogValue(resolveCatalogValue(entity, field.value), field.format) })) ?? [];
  const facts = isBroadcast ? [] : factsOverride ?? (configuredFacts.length ? configuredFacts : defaultFacts);
  const configuredActions = pack?.presentation.menu ?? [];
  const shouldShowDetail = showDetail ?? !isBroadcast;
  const shouldShowMedia = Boolean(activeMediaSource) || ((isBroadcast || isCamera) && mediaOverride === undefined);
  // Camera feeds expose one chosen refreshable frame. Their public authority
  // page is a destination, not an interchangeable media source.
  const shouldShowMediaSourcePicker = showMediaSourcePicker ?? isBroadcast;

  return <article className={`map-node-sheet${isBroadcast || isCamera ? " with-live-feed" : ""}${isCamera ? " is-camera-sheet" : ""}`} style={{ "--node-accent": accent } as CSSProperties} aria-label={`${entity.name} map node`}>
    <header className="map-node-sheet-head">
      <div>
        <strong className="map-node-sheet-title"><span title={layer?.label ?? entity.domain} aria-label={layer?.label ?? entity.domain}><SignalIcon domain={entity.domain} /></span><span>{configuredLabel}</span></strong>
      </div>
      <div className="map-node-sheet-controls">
        <span className="map-node-sheet-observed" title={entity.observedAt ? "OBSERVED · UTC" : "OBSERVED STATUS"} aria-label={entity.observedAt ? `Observed ${observed} UTC` : `Observed status ${observed}`}>{observed}</span>
        <button type="button" onClick={onClose} aria-label={`Close ${entity.name} node`}><X size={16} /></button>
      </div>
    </header>
    {shouldShowMedia && <section className={`map-node-live-feed${isCamera ? " is-camera" : ""}`} aria-label={`${entity.name} live feed`}>
      <MediaRenderer source={activeMediaSource} name={entity.name} label={isCamera ? "CAMERA" : "BROADCAST"} sourcePickerPlacement="none" showUnavailableLink={false} />
    </section>}
    {shouldShowDetail && <p>{displayDetail}</p>}
    {facts.length > 0 && <dl className={`map-node-sheet-grid${facts.length % 3 === 0 ? " has-three-columns" : ""}`}>
      {facts.map((fact) => <div key={fact.label}><dt>{fact.label}</dt><dd>{fact.value}</dd></div>)}
    </dl>}
    <footer className="map-node-sheet-footer">
      {onAgent && <button className="map-node-sheet-agent-action" type="button" onClick={() => onAgent(entity)} aria-label={`Attach ${entity.name} to analyst`} title="Attach to analyst"><ChatCircleText size={15} weight="duotone" /></button>}
      {onGraph && <button className="map-node-sheet-graph-action" type="button" onClick={() => onGraph(entity)} aria-label={`View ${entity.name} relationship graph`} title="Relationship graph"><ShareNetwork size={15} weight="duotone" /></button>}
      {shouldShowMediaSourcePicker ? <MediaSourcePicker options={mediaOptions} selectedIndex={activeMediaIndex} onSelect={setActiveMediaIndex} className="map-node-source-picker" separated /> : null}
      {configuredActions.length > 0 && <div className="map-node-sheet-actions">
        {configuredActions.map((configuredAction) => {
          if (configuredAction.kind === "agent-command") return onAgent ? <button type="button" key={configuredAction.id} onClick={() => onAgent(entity, configuredAction.command)} title={configuredAction.command}>{configuredAction.label}</button> : null;
          const href = configuredAction.url ? formatCatalogValue(resolveCatalogValue(entity, configuredAction.url)) : "";
          return href && href !== "—" ? <a key={configuredAction.id} href={href} target="_blank" rel="noreferrer">{configuredAction.label}</a> : null;
        })}
      </div>}
      {(cameraLocationUrl || action || entity.source.url) && <div className="map-node-sheet-actions">
        {cameraLocationUrl ? <a href={cameraLocationUrl} target="_blank" rel="noreferrer"><MapPin size={13} weight="duotone" /> VIEW LOCATION</a> : null}
        {action ? <a href={action.href} target="_blank" rel="noreferrer"><Planet size={13} weight="duotone" /> {action.label}</a> : entity.source.url ? <a href={entity.source.url} target="_blank" rel="noreferrer">{sourceActionLabel ?? "OPEN SOURCE"}</a> : null}
      </div>}
    </footer>
  </article>;
}
