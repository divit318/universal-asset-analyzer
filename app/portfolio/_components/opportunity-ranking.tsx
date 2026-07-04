"use client";

import Link from "next/link";
import type { EnrichedPosition } from "@/lib/portfolio-analytics";
import { formatCurrency, formatPercent } from "@/lib/format";

function MiniBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  return (
    <div className="h-1.5 w-full bg-surface-2 rounded-full overflow-hidden">
      <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

function UpsideLabel({ pct }: { pct: number | null }) {
  if (pct == null) return <span className="text-muted text-xs">—</span>;
  const color = pct >= 15 ? "text-positive" : pct >= 0 ? "text-warning" : "text-negative";
  return (
    <span className={`font-mono text-xs font-semibold ${color}`}>
      {pct > 0 ? "+" : ""}{pct.toFixed(1)}%
    </span>
  );
}

export function OpportunityRanking({ positions }: { positions: EnrichedPosition[] }) {
  if (positions.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-surface px-5 py-6 text-center">
        <p className="text-sm text-muted">No positions to rank.</p>
      </div>
    );
  }

  // Sort: positions with scores first (by composite desc), then no-score by value desc
  const sorted = [...positions].sort((a, b) => {
    const as = a.score?.composite ?? null;
    const bs = b.score?.composite ?? null;
    if (as != null && bs != null) return bs - as;
    if (as != null) return -1;
    if (bs != null) return 1;
    return b.value - a.value;
  });

  const maxScore = 100;
  const maxUpside = Math.max(...sorted.map((p) => p.upsidePercent ?? 0), 1);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-widest text-muted px-1">
        <span>Position</span>
        <div className="flex items-center gap-6">
          <span>Score</span>
          <span>Upside</span>
          <span className="hidden sm:block">Today</span>
          <span>Value</span>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        {sorted.map((pos, rank) => {
          const composite = pos.score?.composite ?? null;
          const scoreColor = composite == null ? "bg-muted/40"
            : composite >= 70 ? "bg-positive"
            : composite >= 50 ? "bg-warning"
            : "bg-negative";

          const plColor = (pos.unrealizedPct ?? 0) >= 0 ? "text-positive" : "text-negative";
          const todayColor = (pos.todayChangePct ?? 0) >= 0 ? "text-positive" : "text-negative";

          return (
            <div
              key={pos.symbol}
              className="flex items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3 hover:bg-surface-2 transition-colors"
            >
              {/* Rank */}
              <span className="w-5 shrink-0 text-center font-mono text-xs text-muted">{rank + 1}</span>

              {/* Symbol + sector */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <Link
                    href={`/research?symbol=${pos.symbol}`}
                    className="font-mono font-semibold text-sm text-accent hover:underline"
                  >
                    {pos.symbol}
                  </Link>
                  {pos.dividendYield != null && pos.dividendYield > 1.5 && (
                    <span className="rounded border border-positive/30 bg-positive/8 px-1.5 py-0.5 text-[9px] font-semibold text-positive">
                      DIV
                    </span>
                  )}
                </div>
                <p className="text-[10px] text-muted truncate">{pos.sector ?? pos.name}</p>
              </div>

              {/* Score bar */}
              <div className="w-20 shrink-0">
                {composite != null ? (
                  <>
                    <div className="flex justify-between items-center mb-0.5">
                      <span className="font-mono text-xs font-semibold">{composite}</span>
                    </div>
                    <MiniBar value={composite} max={maxScore} color={scoreColor} />
                  </>
                ) : (
                  <span className="text-xs text-muted">—</span>
                )}
              </div>

              {/* Upside */}
              <div className="w-14 text-right shrink-0">
                <UpsideLabel pct={pos.upsidePercent ?? null} />
                {pos.upsidePercent != null && (
                  <MiniBar
                    value={Math.max(pos.upsidePercent, 0)}
                    max={Math.max(maxUpside, 1)}
                    color="bg-accent/50"
                  />
                )}
              </div>

              {/* Today */}
              <div className="w-14 text-right shrink-0 hidden sm:block">
                <span className={`font-mono text-xs ${todayColor}`}>
                  {pos.todayChangePct != null
                    ? `${pos.todayChangePct >= 0 ? "+" : ""}${pos.todayChangePct.toFixed(2)}%`
                    : "—"}
                </span>
              </div>

              {/* P&L + Value */}
              <div className="text-right shrink-0 min-w-[72px]">
                <p className="font-mono text-xs font-semibold">{formatCurrency(pos.value)}</p>
                <p className={`font-mono text-[10px] ${plColor}`}>
                  {pos.unrealizedPct != null ? `${pos.unrealizedPct >= 0 ? "+" : ""}${pos.unrealizedPct.toFixed(1)}%` : "—"}
                </p>
              </div>
            </div>
          );
        })}
      </div>

      <p className="text-[10px] text-muted px-1">
        Ranked by composite quality score. Score combines fundamentals, analyst sentiment, and momentum.
      </p>
    </div>
  );
}
