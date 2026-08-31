export type MapTimeZone = string;
export type TimeFormat = "24h" | "12h";

export type MapSettings = {
  timeZone: MapTimeZone;
  timeFormat: TimeFormat;
  tickerVisible: boolean;
  signalPanelEnabled: boolean;
};

export const defaultMapSettings: MapSettings = {
  timeZone: "UTC",
  timeFormat: "24h",
  tickerVisible: true,
  signalPanelEnabled: true,
};

const fallbackTimeZones = ["Africa/Cairo", "America/Chicago", "America/Los_Angeles", "America/New_York", "Asia/Dubai", "Asia/Kolkata", "Asia/Tokyo", "Australia/Sydney", "Europe/Berlin", "Europe/London", "Pacific/Auckland"];
const supportedTimeZones = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : fallbackTimeZones;
const supportedTimeZoneSet = new Set(supportedTimeZones);

function timeZoneLabel(timeZone: string) {
  return timeZone.replaceAll("_", " ");
}

export const timeZoneOptions: Array<{ value: MapTimeZone; label: string }> = [
  { value: "local", label: "Local time" },
  { value: "UTC", label: "UTC" },
  ...supportedTimeZones.map((timeZone) => ({ value: timeZone, label: timeZoneLabel(timeZone) })),
];

export function isSupportedMapTimeZone(value: unknown): value is MapTimeZone {
  return value === "local" || value === "UTC" || (typeof value === "string" && supportedTimeZoneSet.has(value));
}

export function normalizeMapSettings(input: unknown): MapSettings {
  const candidate = input && typeof input === "object" ? input as Partial<MapSettings> : {};
  return {
    timeZone: isSupportedMapTimeZone(candidate.timeZone) ? candidate.timeZone : defaultMapSettings.timeZone,
    timeFormat: candidate.timeFormat === "12h" ? "12h" : defaultMapSettings.timeFormat,
    tickerVisible: typeof candidate.tickerVisible === "boolean" ? candidate.tickerVisible : defaultMapSettings.tickerVisible,
    signalPanelEnabled: typeof candidate.signalPanelEnabled === "boolean" ? candidate.signalPanelEnabled : defaultMapSettings.signalPanelEnabled,
  };
}

export function formatMapClock(date: Date, timeZone: MapTimeZone, timeFormat: TimeFormat) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: timeFormat === "12h",
    ...(timeZone === "local" ? {} : { timeZone }),
  }).format(date);
  const suffix = timeZone === "UTC" ? "Z" : timeZone === "local" ? "LOCAL" : new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "short" }).formatToParts(date).find((part) => part.type === "timeZoneName")?.value ?? timeZoneLabel(timeZone);
  return `${parts} ${suffix}`;
}
