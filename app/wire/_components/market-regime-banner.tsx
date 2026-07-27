"use client";

import type { MarketRegime, MacroSignal } from "@/lib/types";

const REGIME_STYLE = {
  "risk-on":  { dot: "bg-positive", label: "Risk-On",  bar: "border-positive/30 bg-positive/5" },
  "risk-off": { dot: "bg-negative", label: "Risk-Off", bar: "border-negative/30 bg-negative/5" },
  "neutral":  { dot: "bg-muted",    label: "Neutral",  bar: "border-border bg-surface" },
};

/** Exported so the Macro Dashboard section can render the full macroSignals set with the same tile. */
export function MacroTile({ signal }: { signal: MacroSignal }) {
  const positive = (signal.changePercent ?? 0) >= 0;
  const isVix = signal.ticker === "^VIX";
  // VIX rising is bearish — invert color logic
  const colorPositive = isVix ? !positive : positive;

  return (
    <div className="flex flex-col gap-0.5 rounded-lg border border-border bg-surface px-3 py-2">
      <span className="text-[10px] font-medium uppercase tracking-widest text-muted/60 truncate">
        {signal.name}
      </span>
      <div className="flex items-baseline gap-1.5">
        <span className="font-mono text-sm font-semibold text-foreground">
          {signal.price != null ? signal.price.toFixed(signal.ticker.includes("^T") ? 2 : 2) : "—"}
        </span>
        {signal.changePercent != null && (
          <span
            className={`font-mono text-xs ${colorPositive ? "animate-winner-positive" : "animate-winner-negative"}`}
          >
            {signal.changePercent >= 0 ? "+" : ""}
            {signal.changePercent.toFixed(2)}%
          </span>
        )}
      </div>
    </div>
  );
}

export function MarketRegimeBanner({
  regime,
  macroSignals,
}: {
  regime: MarketRegime;
  macroSignals: MacroSignal[];
}) {
  const style = REGIME_STYLE[regime.trend];

  // Show the 6 most relevant macro signals
  const featured = macroSignals
    .filter((s) => s.price != null)
    .slice(0, 6);

  return (
    <div className={`rounded-xl border px-5 py-4 ${style.bar}`}>
      <div className="flex flex-col gap-3">
        {/* Header row */}
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="arrival-flash flex items-center gap-2 rounded-md px-1.5 py-0.5">
              <span className={`h-2 w-2 rounded-full ${style.dot}`} />
              <span className="text-sm font-semibold">{style.label} Market</span>
            </div>
            {regime.breadthPct != null && (
              <span className="text-xs text-muted">
                {regime.breadthPct}% of sectors advancing
              </span>
            )}
          </div>
          {regime.dominantSectors.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[10px] text-muted/60 uppercase tracking-widest">Leading:</span>
              {regime.dominantSectors.map((s) => (
                <span
                  key={s}
                  className="rounded-full border border-positive/25 bg-positive/10 px-2 py-0.5 text-[10px] text-positive"
                >
                  {s}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Macro signal tiles */}
        {featured.length > 0 && (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
            {featured.map((s) => (
              <MacroTile key={s.ticker} signal={s} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
