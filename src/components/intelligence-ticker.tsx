import { Signal } from "@/src/lib/intelligence";

type IntelligenceTickerProps = {
  signals: Signal[];
  feedVisible?: boolean;
};

export function IntelligenceTicker({ signals, feedVisible = true }: IntelligenceTickerProps) {
  const displayedSignals = signals.slice(0, 12);

  return <footer className="intelligence-ticker" aria-label="Live intelligence feed">
    <div className="ticker-command">PERCIVAL</div>
    <div className="ticker-items">{feedVisible && (displayedSignals.length ? <div className="ticker-track">{[0, 1, 2, 3].flatMap((cycle) => displayedSignals.map((signal) => <span key={`${cycle}-${signal.id}`} className="ticker-item" aria-hidden={cycle > 0 || undefined}><i className={signal.risk} /><strong>{signal.name.toUpperCase()}</strong><small>{signal.location?.label || signal.source.name}</small></span>))}</div> : <span className="ticker-empty">AWAITING LIVE SIGNALS</span>)}</div>
  </footer>;
}
