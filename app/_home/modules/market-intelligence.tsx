"use client";

/**
 * Market Overview — global markets at a glance, in three bands:
 *
 *   1. Header: title, "Global markets at a glance · <live date/time>", refresh,
 *      and the one amber "See all" link to The Wire.
 *   2. Index strip: the five equity benchmarks (S&P 500 · NASDAQ · DOW ·
 *      FTSE 100 · NIKKEI 225), hairline-divided. Deliberately no VIX here —
 *      it owns a tile below, and the same number twice on one card is noise.
 *   3. Tile grid: eight equal-height tiles — the UAA sentiment gauge (the same
 *      `sentiment` slice the brief's fingerprint reads, so the two can never
 *      disagree) and seven instruments, each with a 30-day gradient sparkline.
 *
 * Every figure traces to the digest's one batched `getQuotes()` call
 * (lib/home/market-intel.ts); nothing here is hardcoded or synthesized. A
 * symbol the provider omits degrades to that tile's own error state; a missing
 * history degrades to a sparkline-sized skeleton. Day-changes render through
 * `MetricDelta` so they keep their as-of stamp (audit F-22).
 *
 * Bespoke chrome (like the hero) rather than ModuleShell: the design's header,
 * full-bleed dividers, and 32px gutters are not the shell's 16px card. Section
 * still owns the loading/empty/error state machine.
 */

import { Fragment, useId, useState, type ReactNode } from "react";
import Link from "next/link";
import { Activity, ChevronRight, Info, RefreshCw } from "lucide-react";
import { getHomeModule } from "@/lib/home/registry";
import type { MarketGroup, MarketIntelligence, MarketTicker, SentimentGauge } from "@/lib/home/contracts";
import { vixBand } from "@/lib/home/sentiment";
import { metricSessionState, type Metric } from "@/lib/metric";
import { Section, Skeleton } from "@/app/_components/ui";
import { useHydrated } from "../_atmosphere/use-hydrated";
import { fmtTodayDate } from "../_viz/format";
import { MetricDelta, shortSessionDate, shortTime } from "../_viz/stamped";
import { Sparkline } from "../_viz/sparkline";
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

/** Levels always render with thousands separators and two decimals. */
function fmtLevel(n: number): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** A ticker's day move as a stamped Metric, so it renders with its as-of. */
function tickerMetric(t: MarketTicker): Metric | null {
  if (t.changePct == null) return null;
  return { value: t.changePct, basis: "day", asOf: t.asOf ?? 0, source: "yahoo", sessionDate: t.sessionDate ?? null };
}

function directional(chg: number | null, up: string, down: string, flat: string): string {
  if (chg == null) return flat;
  if (chg > 0.05) return up;
  if (chg < -0.05) return down;
  return flat;
}

/**
 * One module-level session note instead of a per-figure date on every delta
 * (stamped.tsx's documented pattern). Only when every previous-session figure
 * describes the SAME session — mixed dates keep their own labels, and stale
 * figures keep theirs regardless (MetricDelta enforces that).
 */
function sharedSessionNote(groups: MarketGroup[]): string | null {
  const previous = new Set<string>();
  for (const g of groups) {
    for (const t of g.tickers) {
      const m = tickerMetric(t);
      if (!m) continue;
      if (metricSessionState(m) === "previous" && m.sessionDate) previous.add(m.sessionDate);
    }
  }
  return previous.size === 1 ? `Showing ${shortSessionDate([...previous][0])} close` : null;
}

/* ------------------------------------------------------------------ */
/* Band 2 — the index strip                                            */
/* ------------------------------------------------------------------ */

/** The five benchmarks. No VIX — it owns a tile in the grid below. */
const STRIP: { symbol: string; label: string }[] = [
  { symbol: "^GSPC", label: "S&P 500" },
  { symbol: "^IXIC", label: "NASDAQ" },
  { symbol: "^DJI", label: "DOW" },
  { symbol: "^FTSE", label: "FTSE 100" },
  { symbol: "^N225", label: "NIKKEI 225" },
];

function IndexStrip({ groups, suppressSessionLabel }: { groups: MarketGroup[]; suppressSessionLabel: boolean }) {
  return (
    <div className="-mx-8 border-b border-foreground/8">
      {/* Below md the strip scrolls within itself, hairlines intact, scrollbar
          hidden. At md+ it WRAPS instead: the scrollbar is hidden there too, so
          an overflowing row (five indices + per-figure session dates) clipped
          the last index mid-digit with no affordance (2026-08-10 audit). */}
      <div className="overflow-x-auto px-8 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div className="flex min-w-max items-center justify-between gap-3 py-5 min-[768px]:min-w-0 min-[768px]:flex-wrap min-[768px]:gap-y-3">
          {STRIP.map((s, i) => {
            const t = findTicker(groups, s.symbol);
            return (
              <Fragment key={s.symbol}>
                {i > 0 ? <span aria-hidden className="h-7 w-px shrink-0 bg-foreground/10" /> : null}
                <div className="flex shrink-0 items-baseline gap-2">
                  <span className="text-sm text-foreground/70">{s.label}</span>
                  <span className="font-mono text-[15px] font-semibold tabular-nums text-foreground">
                    {t?.price != null ? fmtLevel(t.price) : "—"}
                  </span>
                  <MetricDelta
                    metric={t ? tickerMetric(t) : null}
                    digits={2}
                    className="text-sm font-medium"
                    suppressSessionLabel={suppressSessionLabel}
                  />
                </div>
              </Fragment>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Band 3 — the tile grid                                              */
/* ------------------------------------------------------------------ */

/** Static, factual one-liners: what each metric measures. Never fetched. */
interface TileSpec {
  symbol: string;
  label: string;
  tooltip: string;
  fmt: (price: number) => string;
  /** Caption derived from the live reading — never a canned market call. */
  caption: (t: MarketTicker) => string;
}

const TILES: TileSpec[] = [
  {
    symbol: "^VIX",
    label: "VIX",
    tooltip: "The CBOE Volatility Index — the market's expected 30-day S&P 500 volatility, implied by options prices.",
    fmt: fmtLevel,
    // The ONE VIX interpretation, shared with the sentiment gauge's own
    // scoring anchors (lib/home/sentiment.ts vixBand). Two unshared threshold
    // tables here produced "Extreme Greed" beside "Normal volatility" for the
    // same quote (audit NI-05).
    caption: (t) => (t.price == null ? "Volatility reading unavailable." : `${vixBand(t.price).label} (fear index).`),
  },
  {
    // Yahoo's ^TNX quote is already the yield in percent (e.g. 4.67) — the
    // provider pre-divides CBOE's 10x index, so no further scaling here.
    symbol: "^TNX",
    label: "10Y U.S. Yield",
    tooltip: "The yield on the 10-year U.S. Treasury note — the benchmark for long-term borrowing costs.",
    fmt: (p) => `${fmtLevel(p)}%`,
    caption: (t) => directional(t.changePct, "Yields higher on the day.", "Yields lower on the day.", "Yields little changed on the day."),
  },
  {
    symbol: "CL=F",
    label: "Oil (WTI)",
    tooltip: "West Texas Intermediate crude oil futures — the U.S. oil price benchmark.",
    fmt: fmtLevel,
    caption: (t) => directional(t.changePct, "Energy prices trending higher.", "Energy prices trending lower.", "Energy prices little changed."),
  },
  {
    symbol: "GC=F",
    label: "Gold",
    tooltip: "Gold futures price per troy ounce (COMEX).",
    fmt: fmtLevel,
    caption: (t) => directional(t.changePct, "Gold pushing higher on the day.", "Gold pulling back on the day.", "Gold little changed on the day."),
  },
  {
    symbol: "DX-Y.NYB",
    label: "USD Index",
    tooltip: "The U.S. Dollar Index (DXY) — the dollar measured against a basket of six major currencies.",
    fmt: fmtLevel,
    caption: (t) => directional(t.changePct, "Dollar strengthens on the day.", "Dollar weakens on the day.", "Dollar little changed on the day."),
  },
  {
    symbol: "BTC-USD",
    label: "BTC / USD",
    tooltip: "The price of one bitcoin in U.S. dollars.",
    fmt: fmtLevel,
    caption: (t) => directional(t.changePct, "Bitcoin gains on the day.", "Bitcoin slips on the day.", "Bitcoin little changed on the day."),
  },
  {
    symbol: "BZ=F",
    label: "Brent Crude",
    tooltip: "Brent crude oil futures — the international oil price benchmark.",
    fmt: fmtLevel,
    caption: (t) => directional(t.changePct, "Brent crude moving higher.", "Brent crude moving lower.", "Brent crude little changed."),
  },
];

/** Info icon: a real, focusable button whose tooltip opens on hover AND focus. */
function InfoTip({ label, text }: { label: string; text: string }) {
  const id = useId();
  return (
    <span className="group/tip relative inline-flex">
      <button
        type="button"
        aria-label={`About ${label}`}
        aria-describedby={id}
        className="rounded-full text-foreground/40 outline-none transition-colors hover:text-foreground/70 focus-visible:ring-2 focus-visible:ring-brand/40"
      >
        <Info className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
      </button>
      <span
        id={id}
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 w-56 -translate-x-1/2 rounded-control border border-border bg-surface-3 px-2.5 py-1.5 text-xs font-normal normal-case leading-normal tracking-normal text-foreground opacity-0 shadow-popover transition-opacity group-focus-within/tip:opacity-100 group-hover/tip:opacity-100"
      >
        {text}
      </span>
    </span>
  );
}

/** Tile chrome: 10px radius, hairline border brightening on hover, no motion. */
function Tile({ label, tooltip, className = "", children }: { label: string; tooltip: string; className?: string; children: ReactNode }) {
  return (
    <div className={`flex flex-col rounded-[10px] border border-foreground/8 bg-surface-2 p-[18px] transition-colors hover:border-foreground/16 ${className}`}>
      <div className="flex items-center gap-1.5">
        <span className="text-[11px] font-semibold uppercase tracking-[0.09em] text-foreground/55">{label}</span>
        <InfoTip label={label} text={tooltip} />
      </div>
      {children}
    </div>
  );
}

/** Row C reserves two caption lines on every tile so the blocks align. */
const CAPTION = "mt-3 line-clamp-2 min-h-[42px] text-sm font-normal leading-normal text-foreground/60";

function QuoteTile({ spec, t, suppressSessionLabel }: { spec: TileSpec; t: MarketTicker | null; suppressSessionLabel: boolean }) {
  const ok = t != null && t.price != null;
  return (
    <Tile label={spec.label} tooltip={spec.tooltip}>
      <div className="mt-3 flex flex-1 items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1.5">
          <span className="font-mono text-[28px] font-semibold leading-none tracking-tight tabular-nums text-foreground">
            {ok ? spec.fmt(t.price as number) : "—"}
          </span>
          <MetricDelta metric={ok ? tickerMetric(t) : null} digits={2} className="text-sm font-medium" suppressSessionLabel={suppressSessionLabel} />
        </div>
        {ok ? (
          t.series && t.series.length >= 2 ? (
            // The window is NAMED (DESIGN §4 / audit DU): an unlabelled
            // sparkline is decoration; "30d" is what makes it read.
            <div className="flex shrink-0 flex-col items-end gap-0.5">
              <Sparkline data={t.series} gradient width={100} height={44} />
              <span className="font-mono text-[10px] leading-none tabular-nums text-muted">30d</span>
            </div>
          ) : (
            // No 30d history arrived (the data layer logged the TODO) — hold
            // the sparkline's exact box with a shimmer, never a fabricated line.
            <Skeleton width="w-[100px]" height="h-11" className="shrink-0" />
          )
        ) : null}
      </div>
      <p className={CAPTION}>{ok ? spec.caption(t) : "Live data for this instrument is unavailable right now."}</p>
    </Tile>
  );
}

/** Sentiment mood + volatility qualifier, both derived from live readings. */
function sentimentCaption(label: SentimentGauge["label"], vix: number | null): string {
  const mood =
    label === "Neutral"
      ? "Markets are balanced"
      : label === "Fear"
        ? "Markets are cautious"
        : label === "Extreme Fear"
          ? "Markets are fearful"
          : label === "Greed"
            ? "Markets are risk-on"
            : "Markets are euphoric";
  // Same vixBand the VIX tile's caption reads (audit NI-05): the gauge's mood
  // and its volatility qualifier must describe the level with one vocabulary.
  const vol =
    vix == null
      ? ""
      : {
          complacent: " with complacency-low volatility",
          low: " with low volatility",
          normal: " with normal volatility",
          elevated: " amid elevated volatility",
          stressed: " amid stressed volatility",
        }[vixBand(vix).id];
  return `${mood}${vol}.`;
}

function SentimentTile({ gauge, vix }: { gauge: SentimentGauge | null; vix: number | null }) {
  return (
    <Tile
      label="Market Sentiment"
      tooltip="UAA's own 0–100 sentiment gauge — a weighted blend of the VIX level, sector breadth, and S&P 500 momentum. Not CNN's Fear & Greed Index."
      // At the 3-column breakpoint eight tiles would leave two orphan cells;
      // this tile spans two columns there to square the grid (3×3 cells).
      className="min-[1100px]:col-span-2 min-[1400px]:col-span-1"
    >
      <div className="mt-3 flex flex-1 flex-col justify-center gap-3.5">
        {/* A word, not a number — sans, deliberately not monospace. */}
        <span className="text-[26px] font-semibold leading-none text-foreground">{gauge ? gauge.label.toUpperCase() : "—"}</span>
        {gauge ? (
          <div
            className="relative h-1.5 w-full rounded-full bg-gradient-to-r from-negative via-chart-5 to-positive"
            role="img"
            aria-label={`Sentiment score ${gauge.score} of 100 — ${gauge.label}`}
          >
            {/* Thumb position is the live 0–100 score — dynamic, so a style prop. */}
            <span
              className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border border-background bg-foreground"
              style={{ left: `${gauge.score}%` }}
            />
          </div>
        ) : (
          <Skeleton height="h-1.5" radius="rounded-full" />
        )}
      </div>
      <p className={CAPTION}>{gauge ? sentimentCaption(gauge.label, vix) : "Sentiment gauge unavailable — not enough market data."}</p>
    </Tile>
  );
}

function TileGrid({ d, sessionNote }: { d: MarketIntelligence; sessionNote: string | null }) {
  return (
    // All three column breakpoints use px-valued `min-[…]` variants: Tailwind
    // sorts arbitrary variants by value only within one unit, so mixing
    // `md:` (48rem) with `min-[1100px]:` emits the rem rule LAST and it wins
    // at every width ≥768 (verified live: 2 columns at 1500px).
    <div className="grid auto-rows-fr grid-cols-1 gap-4 pt-6 min-[768px]:grid-cols-2 min-[1100px]:grid-cols-3 min-[1400px]:grid-cols-4">
      <SentimentTile gauge={d.sentiment} vix={findTicker(d.groups, "^VIX")?.price ?? null} />
      {TILES.map((spec) => (
        <QuoteTile key={spec.symbol} spec={spec} t={findTicker(d.groups, spec.symbol)} suppressSessionLabel={!!sessionNote} />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* The card                                                            */
/* ------------------------------------------------------------------ */

export function MarketOverviewModule({ collapsible = false, defaultCollapsed = false }: { collapsible?: boolean; defaultCollapsed?: boolean }) {
  const state = useHomeSlice("marketIntelligence");
  const { digest, refreshDigest } = useHome();
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const hydrated = useHydrated();

  // Date from the same helper as the page <h1> (weekday always derived, never
  // hardcoded); time is the digest's own as-of — omitted until the digest
  // arrives rather than invented. Client-only to avoid the locale/timezone
  // hydration mismatch — see use-hydrated.ts.
  const generatedAt = digest.data?.generatedAt;
  const stamp = hydrated
    ? generatedAt
      ? `${fmtTodayDate("short")}, ${shortTime(Date.parse(generatedAt))}`
      : fmtTodayDate("short")
    : null;

  // One session note for the whole card (markets closed → every figure is the
  // prior close); per-figure date labels are suppressed only when it renders.
  const sessionNote = state.data ? sharedSessionNote(state.data.groups) : null;
  const subtitle = ["Global markets at a glance", stamp, sessionNote].filter(Boolean).join(" · ");

  return (
    <div className={`rounded-xl border border-foreground/8 bg-surface ${collapsed ? "" : ""}`}>
      {/* Band 1 — header, with a full-bleed divider under the whole band. */}
      <div className={`flex items-start justify-between gap-3 px-8 ${collapsed ? "py-5" : "border-b border-foreground/8 pb-5 pt-8"}`}>
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex items-center gap-2.5">
            {collapsible ? (
              <button
                type="button"
                onClick={() => setCollapsed((c) => !c)}
                aria-expanded={!collapsed}
                className="flex items-center gap-2.5 rounded-control outline-none transition-colors hover:text-brand focus-visible:ring-2 focus-visible:ring-brand/40"
              >
                <Activity className="h-5 w-5 shrink-0 text-foreground" strokeWidth={2} aria-hidden />
                <h2 className="text-[22px] font-semibold leading-none tracking-[-0.01em] text-foreground">Market Overview</h2>
              </button>
            ) : (
              <>
                <Activity className="h-5 w-5 shrink-0 text-foreground" strokeWidth={2} aria-hidden />
                <h2 className="text-[22px] font-semibold leading-none tracking-[-0.01em] text-foreground">Market Overview</h2>
              </>
            )}
          </div>
          <p className="text-sm text-foreground/60">{subtitle}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={refreshDigest}
            aria-label="Refresh Market Overview"
            className="rounded-control p-1.5 text-muted outline-none transition-colors hover:bg-surface-2 hover:text-foreground focus-visible:ring-2 focus-visible:ring-brand/40"
          >
            <RefreshCw className={`h-4 w-4 ${state.revalidating ? "animate-spin" : ""}`} strokeWidth={2} />
          </button>
          {/* The card's one amber element. */}
          <Link
            href={definition.navTarget?.href ?? "/wire"}
            className="inline-flex items-center gap-0.5 rounded-control text-sm font-medium text-brand outline-none transition-colors hover:text-brand-strong focus-visible:ring-2 focus-visible:ring-brand/40"
          >
            See all <ChevronRight className="h-4 w-4" strokeWidth={2} aria-hidden />
          </Link>
        </div>
      </div>

      {/* Collapsed, the card still earns its row: the index strip is the
          one-line tape summary the context shelf promises. */}
      <Section
        bare
        state={state}
        isEmpty={(d) => d.groups.length === 0}
        emptyMessage="Market data is unavailable right now."
        minHeight={collapsed ? 60 : 420}
        onRetry={refreshDigest}
        className={collapsed ? "border-t border-foreground/8 px-8" : "px-8 pb-8"}
      >
        {(d) => (
          <>
            <IndexStrip groups={d.groups} suppressSessionLabel={!!sessionNote} />
            {collapsed ? null : <TileGrid d={d} sessionNote={sessionNote} />}
          </>
        )}
      </Section>
    </div>
  );
}
