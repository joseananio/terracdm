"use client";

import { FormEvent, useState } from "react";
import { ArrowRight, CircleNotch, Database, X } from "@phosphor-icons/react";
import { runDeterministicAction } from "@/src/lib/deterministic-action-core";
import type { DeterministicAction } from "@/src/lib/deterministic-actions";

type DeterministicActionSheetProps = {
  action: DeterministicAction;
  onClose: () => void;
  variant?: "drawer" | "map";
};

function resultText(value: unknown) {
  try { return JSON.stringify(value, null, 2); } catch { return "Result could not be rendered."; }
}

export function DeterministicActionSheet({ action, onClose, variant = "map" }: DeterministicActionSheetProps) {
  const [value, setValue] = useState(action.defaultValue);
  const [result, setResult] = useState<unknown>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  const execute = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setRunning(true);
    setError(null);
    try { setResult(await runDeterministicAction(action, value)); }
    catch (cause) { setResult(null); setError(cause instanceof Error ? cause.message : `${action.label} action failed`); }
    finally { setRunning(false); }
  };

  return <aside className={`agent-sheet agent-sheet-${variant}`} aria-label={`${action.label} deterministic action`}>
    <header className="agent-sheet-head"><div><span className="eyebrow"><Database size={14} /> ACTION / {action.label}</span><strong>Enter a target and run the action.</strong></div><button type="button" onClick={onClose} aria-label="Close action"><X size={17} /></button></header>
    <section className="agent-sheet-command deterministic-command">
      <form className="deterministic-form" onSubmit={execute}><div className="deterministic-field"><input id={`deterministic-${action.id}`} type="text" value={value} onChange={(event) => setValue(event.target.value)} placeholder={action.placeholder} autoComplete="off" spellCheck={false} aria-label={`${action.label} ${action.inputLabel}`} /><button className="deterministic-run" type="submit" disabled={running || !value.trim()} aria-label={`Run ${action.label}`}><span>{running ? "RUNNING" : "RUN"}</span>{running ? <CircleNotch className="spin" size={16} /> : <ArrowRight size={16} weight="bold" />}</button></div></form>
    </section>
    {(running || error || result !== null) && <section className="agent-sheet-output" aria-live="polite">
      {running && <div className="agent-sheet-pending"><CircleNotch className="spin" size={16} /> Running {action.label}…</div>}
      {error && <p className="agent-sheet-error">{error}</p>}
      {result !== null && <div className="agent-sheet-section"><span>RESULT</span><pre className="deterministic-result">{resultText(result)}</pre></div>}
    </section>}
  </aside>;
}
