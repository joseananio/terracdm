"use client";

import { useEffect, useState } from "react";

type MapHudFact = { label: string; value: string; tone?: "cyan" | "green" | "amber" };

type MapHudProps = {
  facts: MapHudFact[];
  className?: string;
};

type MapHudPopupProps = {
  eyebrow: string;
  title: string;
  detail: string;
  metricLabel: string;
  metricValue: string;
};

type MapHudInfoCardProps = {
  eyebrow: string;
  title: string;
  facts: MapHudFact[];
  failures?: Array<{ provider: string; detail: string }>;
};

export function useMapLocation([longitude, latitude]: [number, number]) {
  const [locationName, setLocationName] = useState("LOCATING…");
  const roundedLatitude = latitude.toFixed(4);
  const roundedLongitude = longitude.toFixed(4);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void fetch(`/api/geocode?lat=${roundedLatitude}&lng=${roundedLongitude}`, { cache: "no-store" })
        .then((response) => response.ok ? response.json() as Promise<{ name?: string }> : null)
        .then((result) => { if (!cancelled) setLocationName(result?.name?.trim() || "UNKNOWN"); })
        .catch(() => { if (!cancelled) setLocationName("UNKNOWN"); });
    }, 350);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [roundedLatitude, roundedLongitude]);

  return locationName;
}

export function MapHud({ facts, className = "" }: MapHudProps) {
  return <div className={`map-hud ${className}`.trim()} aria-label="Map location facts">
    {facts.map((fact) => <div key={fact.label} data-tone={fact.tone ?? "cyan"}>
      <span>{fact.label}</span>
      <strong>{fact.value}</strong>
    </div>)}
  </div>;
}

export function MapHudPopup({ eyebrow, title, detail, metricLabel, metricValue }: MapHudPopupProps) {
  return <div className="map-hud-popup">
    <span className="map-hud-popup-eyebrow">{eyebrow}</span>
    <strong>{title}</strong>
    <p>{detail}</p>
    <div className="map-hud-popup-metric"><span>{metricLabel}</span><b>{metricValue}</b></div>
  </div>;
}

export function MapHudInfoCard({ eyebrow, title, facts, failures = [] }: MapHudInfoCardProps) {
  return <div className="map-hud-popup map-hud-info-card">
    <span className="map-hud-popup-eyebrow">{eyebrow}</span>
    <strong>{title}</strong>
    <div className="map-hud-info-grid">{facts.map((fact) => <div key={fact.label} data-tone={fact.tone ?? "cyan"}><span>{fact.label}</span><b>{fact.value}</b></div>)}</div>
    {failures.length > 0 && <div className="map-hud-info-failures" aria-label="Provider fetch failures">
      <span>PROVIDER FAILURES / {failures.length}</span>
      {failures.map((failure) => <div key={`${failure.provider}:${failure.detail}`} title={failure.detail}><b>{failure.provider}</b><small>{failure.detail}</small></div>)}
    </div>}
  </div>;
}
