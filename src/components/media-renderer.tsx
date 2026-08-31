"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Broadcast, Eye } from "@phosphor-icons/react";
import type Hls from "hls.js";
import type { MediaSource } from "@/src/lib/intelligence";

type MediaLabel = "CAMERA" | "BROADCAST";
type SourcePickerPlacement = "overlay" | "above" | "none";

function CameraFeed({ source, name, showUnavailableLink = true }: { source: Extract<MediaSource, { kind: "jpg" | "mjpeg" }>; name: string; showUnavailableLink?: boolean }) {
  const [stamp, setStamp] = useState(() => Date.now());
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  const refreshSeconds = source.kind === "jpg" ? source.refreshSeconds ?? 30 : 0;
  useEffect(() => {
    if (!refreshSeconds) return;
    const timer = window.setInterval(() => { setStamp(Date.now()); setAttempt(0); setFailed(false); }, refreshSeconds * 1_000);
    return () => window.clearInterval(timer);
  }, [refreshSeconds]);
  if (failed) return <MediaUnavailable source={source} label="CAMERA" showLink={showUnavailableLink} />;
  const url = attempt === 0 ? `${source.url}${source.url.includes("?") ? "&" : "?"}t=${stamp}` : `/api/media/camera?url=${encodeURIComponent(source.url)}&t=${stamp}`;
  return <img src={url} alt={`Live camera view from ${name}`} onError={() => { if (attempt === 0) setAttempt(1); else setFailed(true); }} />;
}

function MediaUnavailable({ source, label, showLink = true }: { source?: MediaSource; label: MediaLabel; showLink?: boolean }) {
  const Icon = label === "CAMERA" ? Eye : Broadcast;
  const liveUrl = source && "liveUrl" in source ? source.liveUrl : undefined;
  const externalUrl = source?.kind === "external" ? source.url : undefined;
  const openUrl = liveUrl ?? externalUrl;
  return <div className="media-unavailable"><Icon size={28} /> {label} SOURCE UNAVAILABLE{showLink && openUrl ? <a href={openUrl} target="_blank" rel="noreferrer">OPEN OFFICIAL FEED</a> : null}</div>;
}

function HlsPlayer({ source, name, onFailed }: { source: Extract<MediaSource, { kind: "hls" }>; name: string; onFailed: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = source.url;
      return;
    }
    let cancelled = false;
    let player: Hls | undefined;
    void import("hls.js").then(({ default: Hls }) => {
      if (cancelled) return;
      if (!Hls.isSupported()) {
        onFailed();
        return;
      }
      player = new Hls({ enableWorker: true, lowLatencyMode: true, backBufferLength: 30 });
      player.loadSource(source.url);
      player.attachMedia(video);
      player.on(Hls.Events.ERROR, (_event, data) => { if (data.fatal) onFailed(); });
    }).catch(onFailed);
    return () => { cancelled = true; player?.destroy(); };
  }, [onFailed, source.url]);
  return <video ref={videoRef} controls autoPlay muted playsInline aria-label={`${name} HLS stream`} onError={onFailed} />;
}

export function mediaSourceOptions(source?: MediaSource, alternatives: MediaSource[] = []) {
  const options: MediaSource[] = [];
  const seen = new Set<string>();
  for (const candidate of [source, ...alternatives]) {
    let current = candidate;
    while (current) {
      const key = `${current.kind}:${current.url}`;
      if (!seen.has(key)) {
        options.push(current);
        seen.add(key);
      }
      current = current.kind === "hls" ? current.fallback : undefined;
    }
  }
  const liveUrl = source && "liveUrl" in source ? source.liveUrl : undefined;
  if (liveUrl && !seen.has(`external:${liveUrl}`) && liveUrl !== source?.url) options.push({ kind: "external", url: liveUrl, reason: "Official broadcaster page" });
  return options;
}

export function mediaSourceLabel(source: MediaSource) {
  if (source.kind === "hls") return "HLS";
  if (source.kind === "youtube") return "YOUTUBE";
  if (source.kind === "external") return "OFFICIAL";
  return source.kind.toUpperCase();
}

type MediaSourcePickerProps = {
  options: MediaSource[];
  selectedIndex: number;
  onSelect: (index: number) => void;
  className?: string;
  separated?: boolean;
};

export function MediaSourcePicker({ options, selectedIndex, onSelect, className = "", separated = false }: MediaSourcePickerProps) {
  if (options.length < 2) return null;

  return <div className={`media-source-picker ${className}`.trim()} role="tablist" aria-label="Available media sources">
    {options.map((option, index) => {
      const unavailable = option.kind === "hls" && option.health?.status !== "healthy";
      return <Fragment key={`${option.kind}:${option.url}`}>
        {separated && index > 0 ? <span className="media-source-separator" aria-hidden="true">|</span> : null}
        <button type="button" role="tab" aria-selected={selectedIndex === index} disabled={unavailable} title={unavailable ? option.health?.error ?? "Source unavailable" : `Use ${mediaSourceLabel(option)} source`} className={`${selectedIndex === index ? "selected" : ""} ${unavailable ? "unavailable" : ""}`} onClick={() => onSelect(index)}>{mediaSourceLabel(option)}</button>
      </Fragment>;
    })}
  </div>;
}

type MediaRendererProps = {
  source?: MediaSource;
  alternatives?: MediaSource[];
  name: string;
  label: MediaLabel;
  onSourceChange?: (source?: MediaSource) => void;
  sourcePickerPlacement?: SourcePickerPlacement;
  showUnavailableLink?: boolean;
};

export function MediaRenderer({ source, alternatives, name, label, onSourceChange, sourcePickerPlacement = "overlay", showUnavailableLink = true }: MediaRendererProps) {
  const [failed, setFailed] = useState(false);
  const options = useMemo(() => mediaSourceOptions(source, alternatives), [alternatives, source]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  useEffect(() => { setSelectedIndex(0); setFailed(false); }, [source?.kind, source?.url]);
  const activeSource = options[selectedIndex];
  const selectSource = useCallback((index: number) => { setSelectedIndex(index); setFailed(false); onSourceChange?.(options[index]); }, [onSourceChange, options]);
  const advanceSource = useCallback(() => {
    if (selectedIndex < options.length - 1) selectSource(selectedIndex + 1);
    else setFailed(true);
  }, [options.length, selectSource, selectedIndex]);
  const picker = sourcePickerPlacement === "none" ? null : <MediaSourcePicker options={options} selectedIndex={selectedIndex} onSelect={selectSource} className={`media-source-picker-${sourcePickerPlacement}`} />;
  if (!activeSource || failed) return <>{sourcePickerPlacement === "above" ? picker : null}<MediaUnavailable source={activeSource ?? source} label={label} showLink={showUnavailableLink} /></>;
  return <>
    {sourcePickerPlacement === "above" ? picker : null}
    <div className="media-render-surface">
      {sourcePickerPlacement === "overlay" ? picker : null}
      {activeSource.kind === "jpg" || activeSource.kind === "mjpeg" ? <CameraFeed source={activeSource} name={name} showUnavailableLink={showUnavailableLink} /> : null}
      {activeSource.kind === "hls" ? <HlsPlayer source={activeSource} name={name} onFailed={advanceSource} /> : null}
      {activeSource.kind === "youtube" || activeSource.kind === "iframe" ? <iframe src={activeSource.url} title={`${name} live broadcast`} loading="eager" allow="autoplay; encrypted-media; picture-in-picture" referrerPolicy="strict-origin-when-cross-origin" onError={advanceSource} /> : null}
      {activeSource.kind === "external" ? <MediaUnavailable source={activeSource} label={label} showLink={showUnavailableLink} /> : null}
    </div>
  </>;
}
