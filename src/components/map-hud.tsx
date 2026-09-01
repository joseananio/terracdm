"use client";

import { useEffect, useState } from "react";

type MapHudFact = { label: string; value: string; tone?: "cyan" | "green" | "amber" };

type MapHudProps = {
  facts: MapHudFact[];
  className?: string;
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
