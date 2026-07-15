"use client";

/**
 * Module 5 — Market Intelligence.
 *
 * The cross-asset tape plus regime, breadth, and the sentiment gauge.
 *
 * The gauge is labelled "UAA Sentiment", not "Fear & Greed", and its tooltip
 * names the three components that produced it. CNN's index has no free API;
 * borrowing its name for a number computed from different inputs would be a
 * fabrication, and this project does not ship those. The label is the honesty.
 */

import { getHomeModule } from "@/lib/home/registry";
import { toneClass } from "@/lib/format";
import type { MarketGroup, MarketTicker, SentimentGauge } from "@/lib/home/contracts";
import { ModuleShell } from "../module-shell";
import { useHome, useHomeSlice } from "../home-provider";

const definition = getHomeModule("market-intelligence");

const REGIME_TONE: Record<string, string> = {
  "risk-on": "text-positive",
  "risk-off": "text-negative",
  neutral: "text-muted",
};

const SENTIMENT_TONE: Record<SentimentGauge["label"], string> = {
  "Extreme Fear": "text-negative",
  Fear: "text-negative",
  Neutral: "text-muted",
  Greed: "text-positive",
  "Extreme Greed": "text-positive",
};

/** Rates and the VIX are quoted as levels; everything else as a price. */
function priceOf(t: MarketTicker): string {
  if (t.price == null) return "—";
  return t.price >= 1000 ? t.price.toLocaleString(undefined, { maximumFractionDigits: 0 }) : t.price.toFixed(2);
}

function TickerCell({ t }: { t: MarketTicker }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="truncate text-xs text-muted">{t.label}</span>
      <span className="font-mono text-sm font-semibold tabular-nums text-foreground">{priceOf(t)}</span>
      <span className={`font-mono text-xs tabular-nums ${toneClass(t.changePct)}`}>
        {t.changePct == null ? "—" : `${t.changePct >= 0 ? "+" : ""}${t.changePct.toFixed(2)}%`}
      </span>
    </div>
  );
}

function Group({ group }: { group: MarketGroup }) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-micro font-semibold uppercase tracking-wide text-muted">{group.label}</h3>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {group.tickers.map((t) => (
          <TickerCell key={t.symbol} t={t} />
        ))}
      </div>
    </div>
  );
}

function Gauge({ s }: { s: SentimentGauge }) {
  const components = s.components
    .filter((c) => c.value != null)
    .map((c) => c.name)
    .join(", ");

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline gap-2">
        <span className="text-micro font-semibold uppercase tracking-wide text-muted">UAA Sentiment</span>
        {s.confidence !== "high" ? (
          <span className="text-micro text-warning">{s.confidence} confidence</span>
        ) : null}
      </div>

      <div className="flex items-baseline gap-2">
        <span className="font-mono text-2xl font-semibold tabular-nums text-foreground">{s.score}</span>
        <span className={`text-sm font-semibold ${SENTIMENT_TONE[s.label]}`}>{s.label}</span>
      </div>

      {/* The track is the scale; the marker is the score. */}
      <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-surface-3">
        <div
          className="absolute top-0 h-full w-1 rounded-full bg-foreground"
          style={{ left: `calc(${Math.max(0, Math.min(100, s.score))}% - 2px)` }}
        />
      </div>

      <p className="text-xs leading-5 text-muted">
        Our own gauge — not CNN&apos;s Fear &amp; Greed Index. Computed from {components || "no available inputs"}.
      </p>
    </div>
  );
}

export function MarketIntelligenceModule() {
  const state = useHomeSlice("marketIntelligence");
  const { refreshDigest } = useHome();

  return (
    <ModuleShell
      definition={definition}
      state={state}
      minHeight={220}
      onRefresh={refreshDigest}
      isEmpty={(d) => d.groups.length === 0}
      emptyMessage="Market data is unavailable right now."
    >
      {(d) => (
        <div className="flex flex-col gap-5">
          {(d.regime || d.sentiment || d.breadthPct != null) && (
            <div className="grid gap-5 border-b border-border pb-5 sm:grid-cols-3">
              {d.regime ? (
                <div className="flex flex-col gap-1">
                  <span className="text-micro font-semibold uppercase tracking-wide text-muted">Regime</span>
                  <span className={`text-sm font-semibold capitalize ${REGIME_TONE[d.regime.trend] ?? "text-muted"}`}>
                    {d.regime.trend.replace("-", " ")}
                  </span>
                  <p className="text-xs leading-5 text-muted">{d.regime.summary}</p>
                </div>
              ) : null}

              {d.breadthPct != null ? (
                <div className="flex flex-col gap-1">
                  <span className="text-micro font-semibold uppercase tracking-wide text-muted">Breadth</span>
                  <span className="font-mono text-2xl font-semibold tabular-nums text-foreground">{d.breadthPct}%</span>
                  <p className="text-xs text-muted">of sectors advancing</p>
                </div>
              ) : null}

              {d.sentiment ? <Gauge s={d.sentiment} /> : null}
            </div>
          )}

          <div className="flex flex-col gap-5">
            {d.groups.map((g) => (
              <Group key={g.id} group={g} />
            ))}
          </div>

          {/* Rotation you're actually exposed to. A leadership change in a sector
              you don't hold is trivia; one you do hold is a reason to look. */}
          {d.sectorAttention.length > 0 && (
            <div className="flex flex-col gap-2 border-t border-border pt-4">
              <h3 className="text-micro font-semibold uppercase tracking-wide text-muted">
                Rotation in sectors you hold
              </h3>
              <ul className="flex flex-col gap-1.5">
                {d.sectorAttention.map((c) => {
                  const improved = c.toRank < c.fromRank;
                  return (
                    <li key={c.sector} className="flex items-center justify-between gap-3 text-xs">
                      <span className="truncate text-foreground/85">{c.sector}</span>
                      <span className="flex shrink-0 items-center gap-2">
                        {c.portfolioWeightPct != null ? (
                          <span className="font-mono tabular-nums text-muted">
                            {c.portfolioWeightPct.toFixed(0)}% of book
                          </span>
                        ) : null}
                        <span className={`font-mono tabular-nums ${improved ? "text-positive" : "text-negative"}`}>
                          #{c.fromRank} → #{c.toRank}
                        </span>
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
      )}
    </ModuleShell>
  );
}
