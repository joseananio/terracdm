"use client";

import { Archive, CaretRight, Database, MagnifyingGlass, ShieldWarning, Target } from "@phosphor-icons/react";
import { deterministicActions, type DeterministicAction } from "@/src/lib/deterministic-actions";

type ActionDeckProps = {
  onAction: (action: DeterministicAction) => void;
  /** Retained for existing callers; AI surfaces now have dedicated entry points. */
  onAgent?: () => void;
  onOverview?: () => void;
};

const icons = { dns: MagnifyingGlass, rdap: Archive, ip: ShieldWarning, tls: ShieldWarning, cve: Database, crypto: Archive, sanctions: ShieldWarning, scan: Target } as const;

export function ActionDeck({ onAction }: ActionDeckProps) {
  return <div className="action-deck"><header className="action-deck-head"><strong>ACTIONS</strong></header><div className="action-grid">{deterministicActions.map((action) => { const ToolIcon = icons[action.id]; return <button key={action.id} onClick={() => onAction(action)}><ToolIcon size={17} /><span><b>{action.label}</b><small>{action.detail}</small></span><CaretRight size={14} /></button>; })}</div></div>;
}
