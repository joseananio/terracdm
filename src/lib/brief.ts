export type BriefRange = "current" | "6h" | "24h" | "7d";

export type BriefScope = {
  range: BriefRange;
  geography?: string;
  domains: string[];
  watchlistOnly: boolean;
};

export type BriefDevelopment = {
  id: string;
  title: string;
  assessment: string;
  risk: "low" | "medium" | "high";
  signalIds: string[];
  entityIds: string[];
  uncertainty?: string;
};

export const defaultBriefScope: BriefScope = { range: "24h", domains: [], watchlistOnly: false };
