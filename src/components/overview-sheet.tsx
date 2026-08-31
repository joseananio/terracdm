"use client";

import { AgentSheet } from "./agent-sheet";
import type { ChatContext } from "@/src/lib/server/chat";

type OverviewSheetProps = { context: ChatContext; onClose: () => void; variant?: "drawer" | "map" };

export function OverviewSheet({ context, onClose, variant = "map" }: OverviewSheetProps) {
  return <AgentSheet context={context} entityIds={context.selectedEntityIds ?? []} onClose={onClose} variant={variant} />;
}
