"use client";

import { useEffect, useState } from "react";
import type { MacroSignal, MarketRegime } from "@/lib/types";
import { Skeleton } from "@/app/_components/ui";

/**
 * Market Now — the Wire's Tier-1 strip: regime, breadth, one line of macro
 * instruments, one line of sector leaders/laggards. Fed by /api/wire/pulse
 * (live quotes, no LLM) with the scan's regime as fallback, so it renders in
 * about a second and never waits on the intelligence pipeline.
 *
 * Deliberately a strip, not a tile grid: the reader should absorb the state
 * of the market in one downward glance, then move to what happened.
 */

export interface PulseData {
  asOf: string;
  macroSignals: MacroSignal[];
  sectorPerf: { sector: string; etfTicker: string; changePercent: number | null }[];
  breadthPct: number | null;
  regime: MarketRegime;
}

const REGIME_STYLE = {
  "risk-on":  { dot: "bg-positive", label: "Risk-On",  bar: "border-positive/30 bg-positive/5" },
  "risk-off": { dot: "bg-negative", label: "Risk-Off", bar: "border-negative/30 bg-negative/5" },
  "neutral":  { dot: "bg-muted",    label: "Neutral",  bar: "border-border bg-surface" },
};

/** "14:32:05" — pulse timestamps are same-day, so time alone is the honest label. */
function clockTime(iso: string): string {
  const t = new Date(iso);
  return Number.isNaN(t.getTime()) ? "" : t.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function MacroCell({ signal }: { signal: MacroSignal }) {
  const positive = (signal.changePercent ?? 0) >= 0;
  // VIX rising is bearish — invert the color read.
  const colorPositive = signal.ticker === "^VIX" ? !positive : positive;
  return (
    <div className="flex shrink-0 flex-col gap-0.5 px-3 first:pl-0 last:pr-0">
      <span className="whitespace-nowrap text-label font-medium uppercase tracking-widest text-muted/60">
        {signal.name}
      </span>
      <span className="flex items-baseline gap-1.5 font-mono">
        <span className="text-sm font-semibold text-foreground">
          {signal.price != null
            ? signal.price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
            : "—"}
        </span>
        {signal.changePercent != null && (
          <span className={`text-xs ${colorPositive ? "text-positive" : "text-negative"}`}>
            {signal.changePercent >= 0 ? "+" : ""}
            {signal.changePercent.toFixed(2)}%
          </span>
        )}
      </span>
    </div>
  );
}

export function MarketNow({
  pulse,
  pulseFailed,
  scanRegime,
  scanMacro,
}: {
  pulse: PulseData | null;
  /** True once the pulse fetch settled without data — fall back to scan fields. */
  pulseFailed: boolean;
  scanRegime: MarketRegime | null;
  scanMacro: MacroSignal[];
}) {
  const regime = pulse?.regime ?? scanRegime;
  const macro = (pulse?.macroSignals?.length ? pulse.macroSignals : scanMacro).filter(
    (s) => s.price != null,
  );
  const breadth = pulse?.breadthPct ?? regime?.breadthPct ?? null;

  // "Live" only while the pulse is genuinely recent; a tab left open shows its age.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  if (!regime) {
    return <Skeleton height="h-24" radius="rounded-xl" className="border border-border" />;
  }

  const style = REGIME_STYLE[regime.trend];
  const pulseAgeMs = pulse ? now - new Date(pulse.asOf).getTime() : null;
  const live = pulseAgeMs != null && pulseAgeMs < 5 * 60_000;

  const rankedSectors = (pulse?.sectorPerf ?? [])
    .filter((s) => s.changePercent != null)
    .sort((a, b) => (b.changePercent ?? 0) - (a.changePercent ?? 0));
  const leaders = rankedSectors.slice(0, 2);
  const laggards = rankedSectors.slice(-2).reverse();

  return (
    <div className={`rounded-xl border px-5 py-4 ${style.bar}`}>
      <div className="flex flex-col gap-3">
        {/* Row 1 — regime + breadth + freshness */}
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5">
          <div className="flex flex-wrap items-center gap-3">
            <span className="arrival-flash flex items-center gap-2 rounded-md px-1.5 py-0.5">
              <span className={`h-2 w-2 rounded-full ${style.dot}`} />
              <span className="text-sm font-semibold">{style.label} Market</span>
            </span>
            {breadth != null && (
              <span className="text-xs text-muted">{breadth}% of sectors advancing</span>
            )}
            {regime.dominantSectors.length > 0 && (
              <span className="text-xs text-muted" title="Sectors advancing most in today's session">
                Leading: <span className="text-foreground/80">{regime.dominantSectors.join(", ")}</span>
              </span>
            )}
          </div>
          <span className="font-mono text-label uppercase tracking-widest text-muted/60">
            {pulse
              ? live
                ? `Prices live · ${clockTime(pulse.asOf)}`
                : `Prices as of ${clockTime(pulse.asOf)}`
              : pulseFailed
                ? "Live prices unavailable — showing scan data"
                : "Fetching prices…"}
          </span>
        </div>

        {/* Row 2 — macro instrument strip */}
        {macro.length > 0 && (
          <div className="-mx-1 flex divide-x divide-border overflow-x-auto px-1 pb-0.5">
            {macro.map((s) => (
              <MacroCell key={s.ticker} signal={s} />
            ))}
          </div>
        )}

        {/* Row 3 — today's sector extremes, one line */}
        {(leaders.length > 0 || laggards.length > 0) && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border/60 pt-2.5 text-xs">
            <span className="text-label font-medium uppercase tracking-widest text-muted/60">
              Sectors today
            </span>
            {leaders.map((s) => (
              <span key={s.sector} className="font-mono text-positive">
                {s.sector} +{(s.changePercent ?? 0).toFixed(1)}%
              </span>
            ))}
            {laggards.map(
              (s) =>
                (s.changePercent ?? 0) < 0 && (
                  <span key={s.sector} className="font-mono text-negative">
                    {s.sector} {(s.changePercent ?? 0).toFixed(1)}%
                  </span>
                ),
            )}
          </div>
        )}
      </div>
    </div>
  );
}
