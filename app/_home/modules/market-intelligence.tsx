"use client";

/**
 * Market Pulse — a full-width strip of compact instrument cards.
 *
 * Replaces the old dense tape with the curated set an investor actually scans at
 * open: regime, breadth, sentiment, and the six cross-asset bellwethers (VIX,
 * 10Y, dollar, oil, gold, BTC). Each card carries a value, its move, a sparkline
 * (for the curated series lib/home/market-intel.ts fetches), and a one-line
 * implication derived from the level — not a fabricated headline.
 *
 * The sentiment gauge stays labelled "UAA Sentiment", never CNN's Fear & Greed:
 * borrowing that name for a number computed from different inputs would be a lie.
 */

import { getHomeModule } from "@/lib/home/registry";
import type { MarketGroup, MarketTicker, MarketIntelligence } from "@/lib/home/contracts";
import { Sparkline } from "../_viz/sparkline";
import { ModuleShell } from "../module-shell";
import { useHome, useHomeSlice } from "../home-provider";

const definition = getHomeModule("market-intelligence");

/** Finds a ticker anywhere on the tape by symbol. */
function findTicker(groups: MarketGroup[], symbol: string): MarketTicker | null {
  for (const g of groups) {
    const t = g.tickers.find((x) => x.symbol.toUpperCase() === symbol.toUpperCase());
    if (t) return t;
  }
  return null;
}

interface PulseCardModel {
  key: string;
  label: string;
  value: string;
  changePct: number | null;
  series: number[] | null;
  implication: string;
  /** Force a tone regardless of direction (e.g. VIX up = bad, so neutral spark). */
  toneOverride?: "positive" | "negative" | "neutral";
}

function PulseCard({ m }: { m: PulseCardModel }) {
  const changeTone = m.changePct == null ? "text-muted" : m.changePct >= 0 ? "text-positive" : "text-negative";
  return (
    <div className="flex flex-col gap-1.5 rounded-control border border-border/60 bg-surface-2/30 p-2.5 transition-colors hover:border-border">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted">{m.label}</span>
        {m.changePct != null ? (
          <span className={`font-mono text-[10px] tabular-nums ${changeTone}`}>
            {m.changePct >= 0 ? "+" : "−"}
            {Math.abs(m.changePct).toFixed(2)}%
          </span>
        ) : null}
      </div>
      <div className="flex items-end justify-between gap-1">
        <span className="font-mono text-base font-semibold tabular-nums text-foreground">{m.value}</span>
        {m.series ? <Sparkline data={m.series} tone={m.toneOverride} width={64} height={22} /> : null}
      </div>
      <p className="line-clamp-2 text-[10px] leading-tight text-muted">{m.implication}</p>
    </div>
  );
}

function fmtLevel(t: MarketTicker | null): string {
  if (!t || t.price == null) return "—";
  return t.price >= 1000 ? t.price.toLocaleString(undefined, { maximumFractionDigits: 0 }) : t.price.toFixed(2);
}

function vixImplication(level: number | null): string {
  if (level == null) return "Volatility data unavailable.";
  if (level < 14) return "Calm tape — low hedging demand.";
  if (level < 20) return "Normal volatility regime.";
  if (level < 30) return "Elevated stress — hedges bid.";
  return "Fear regime — sharp risk-off.";
}

function directional(change: number | null, up: string, down: string, flat: string): string {
  if (change == null) return flat;
  if (change > 0.05) return up;
  if (change < -0.05) return down;
  return flat;
}

function buildCards(d: MarketIntelligence): PulseCardModel[] {
  const g = d.groups;
  const vix = findTicker(g, "^VIX");
  const tnx = findTicker(g, "^TNX");
  const dxy = findTicker(g, "DX-Y.NYB");
  const oil = findTicker(g, "CL=F");
  const gold = findTicker(g, "GC=F");
  const btc = findTicker(g, "BTC-USD");

  const cards: PulseCardModel[] = [];

  if (d.regime) {
    cards.push({
      key: "regime",
      label: "Regime",
      value: d.regime.trend.replace("-", " "),
      changePct: null,
      series: null,
      implication: d.regime.summary,
    });
  }
  if (d.breadthPct != null) {
    cards.push({
      key: "breadth",
      label: "Breadth",
      value: `${d.breadthPct}%`,
      changePct: null,
      series: null,
      implication:
        d.breadthPct >= 55 ? "Broad participation — healthy tape." : d.breadthPct < 45 ? "Narrow — few names leading." : "Mixed participation.",
    });
  }
  if (d.sentiment) {
    cards.push({
      key: "sentiment",
      label: "UAA Sentiment",
      value: String(d.sentiment.score),
      changePct: null,
      series: null,
      implication: `${d.sentiment.label} — our gauge, not CNN's (${d.sentiment.confidence} confidence).`,
    });
  }
  if (vix) {
    cards.push({
      key: "vix",
      label: "Volatility",
      value: fmtLevel(vix),
      changePct: vix.changePct,
      series: vix.series ?? null,
      implication: vixImplication(vix.price),
      toneOverride: "neutral",
    });
  }
  if (tnx) {
    cards.push({
      key: "tnx",
      label: "Rates 10Y",
      value: `${fmtLevel(tnx)}%`,
      changePct: tnx.changePct,
      series: tnx.series ?? null,
      implication: directional(tnx.changePct, "Yields rising — duration under pressure.", "Yields easing — tailwind for bonds.", "Rates steady."),
      toneOverride: "neutral",
    });
  }
  if (dxy) {
    cards.push({
      key: "dxy",
      label: "Dollar (DXY)",
      value: fmtLevel(dxy),
      changePct: dxy.changePct,
      series: dxy.series ?? null,
      implication: directional(dxy.changePct, "Dollar firmer — headwind for EM & exporters.", "Dollar softer — supports commodities.", "Dollar steady."),
    });
  }
  if (oil) {
    cards.push({
      key: "oil",
      label: "Oil (WTI)",
      value: `$${fmtLevel(oil)}`,
      changePct: oil.changePct,
      series: oil.series ?? null,
      implication: directional(oil.changePct, "Crude bid — inflationary at the margin.", "Crude softer — disinflationary.", "Crude flat."),
    });
  }
  if (gold) {
    cards.push({
      key: "gold",
      label: "Gold",
      value: `$${fmtLevel(gold)}`,
      changePct: gold.changePct,
      series: gold.series ?? null,
      implication: directional(gold.changePct, "Gold bid — haven demand.", "Gold offered — risk appetite firm.", "Gold flat."),
    });
  }
  if (btc) {
    cards.push({
      key: "btc",
      label: "Bitcoin",
      value: `$${btc.price != null ? Math.round(btc.price).toLocaleString() : "—"}`,
      changePct: btc.changePct,
      series: btc.series ?? null,
      implication: directional(btc.changePct, "Risk appetite firm.", "Risk appetite fading.", "Crypto flat."),
    });
  }

  return cards;
}

export function MarketIntelligenceModule() {
  const state = useHomeSlice("marketIntelligence");
  const { refreshDigest } = useHome();

  return (
    <ModuleShell
      definition={definition}
      state={state}
      minHeight={160}
      onRefresh={refreshDigest}
      isEmpty={(d) => d.groups.length === 0 && !d.regime}
      emptyMessage="Market data is unavailable right now."
    >
      {(d) => {
        const cards = buildCards(d);
        return (
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-8">
              {cards.map((m) => (
                <PulseCard key={m.key} m={m} />
              ))}
            </div>

            {d.sectorAttention.length > 0 ? (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-border/50 pt-2.5">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-muted">Rotation you hold</span>
                {d.sectorAttention.slice(0, 4).map((c) => {
                  const improved = c.toRank < c.fromRank;
                  return (
                    <span key={c.sector} className="inline-flex items-center gap-1.5 text-[11px]">
                      <span className="text-foreground/85">{c.sector}</span>
                      <span className={`font-mono tabular-nums ${improved ? "text-positive" : "text-negative"}`}>
                        #{c.fromRank}→#{c.toRank}
                      </span>
                    </span>
                  );
                })}
              </div>
            ) : null}
          </div>
        );
      }}
    </ModuleShell>
  );
}
