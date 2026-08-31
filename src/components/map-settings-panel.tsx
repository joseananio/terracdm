"use client";

import { X } from "@phosphor-icons/react";
import { timeZoneOptions, type MapSettings, type MapTimeZone, type TimeFormat } from "@/src/lib/map-settings";

export { defaultMapSettings, formatMapClock, isSupportedMapTimeZone, normalizeMapSettings, type MapSettings, type MapTimeZone, type TimeFormat } from "@/src/lib/map-settings";

type MapSettingsPanelProps = {
  settings: MapSettings;
  onChange: (change: Partial<MapSettings>) => void;
  onClose: () => void;
};

export function MapSettingsPanel({ settings, onChange, onClose }: MapSettingsPanelProps) {
  return <aside className="spike-settings-overlay" aria-label="Map settings">
    <header className="map-settings-head">
      <div>
        <strong>Settings</strong>
      </div>
      <button type="button" className="spike-actions-close" onClick={onClose} aria-label="Close settings"><X size={15} /></button>
    </header>
    <div className="map-settings-body">
      <label className="map-settings-field" htmlFor="map-time-zone">
        <span>TIME ZONE</span>
        <select id="map-time-zone" value={settings.timeZone} onChange={(event) => onChange({ timeZone: event.target.value as MapTimeZone })}>
          {timeZoneOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </label>
      <label className="map-settings-field" htmlFor="map-time-format">
        <span>TIME FORMAT</span>
        <select id="map-time-format" value={settings.timeFormat} onChange={(event) => onChange({ timeFormat: event.target.value as TimeFormat })}>
          <option value="24h">24-hour</option>
          <option value="12h">12-hour</option>
        </select>
      </label>
      <div className="map-settings-field">
        <span>SIGNAL PANEL</span>
        <button type="button" role="switch" aria-checked={settings.signalPanelEnabled} className={`map-settings-toggle${settings.signalPanelEnabled ? " active" : ""}`} onClick={() => onChange({ signalPanelEnabled: !settings.signalPanelEnabled })}><span>{settings.signalPanelEnabled ? "Enabled" : "Disabled"}</span><i aria-hidden="true" /></button>
      </div>
    </div>
  </aside>;
}
