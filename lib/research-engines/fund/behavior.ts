/**
 * Regime behaviour — "when does this fund actually work?".
 *
 * Trailing returns say what happened; they don't say under what conditions.
 * This module answers the conditional question from the two price series the
 * Research Hub has ALREADY fetched for every symbol it renders: the asset's own
 * five years of daily history and the market benchmark's (lib/research-bundle.ts
 * fetches both for the chart). Nothing here fetches, and nothing here is a
 * simulation — it is measurement of what did happen, split by environment.
 *
 * The four readings, in the order a reader wants them:
 *
 *  1. Up/down capture — the single most decision-useful pair of numbers about a
 *     fund. "Captures 118% of the market's up months and 131% of its down
 *     months" tells you what a trailing return never can.
 *  2. Drawdown episodes — how it actually behaved through the market's worst
 *     stretches, dated, rather than a single max-drawdown statistic.
 *  3. Beta / correlation / volatility ratio — measured, not the provider's
 *     stale category-relative figures.
 *  4. A one-sentence reading of the above.
 *
 * Pure, synchronous, client-safe.
 */

import type { HistoryPoint } from "../../types";

/** Trading days needed before a statistic is reported at all. Below these the
 *  field comes back null — a capture ratio off three months is noise wearing a
 *  number's clothes. */
const MIN_DAYS_FOR_RISK = 120;
const MIN_MONTHS_FOR_CAPTURE = 18;
/** Peak-to-trough depth in the BENCHMARK that makes a stretch worth naming. */
const EPISODE_THRESHOLD_PCT = 8;

export interface DrawdownEpisode {
  /** ISO dates bounding the benchmark's peak-to-trough slide. */
  fromDate: string;
  toDate: string;
  /** Benchmark's peak-to-trough move, negative. */
  benchmarkPct: number;
  /** The fund's move over the exact same window, negative or positive. */
  fundPct: number;
  /** fundPct − benchmarkPct: positive means it held up better. */
  edgePct: number;
}

export interface RegimeProfile {
  /** Trading days both series share — the sample everything below is measured on. */
  alignedDays: number;
  benchmarkLabel: string;

  /** Share of the benchmark's gain captured in months it rose, as a %. */
  upCapturePct: number | null;
  /** Share of the benchmark's loss taken in months it fell, as a %. */
  downCapturePct: number | null;
  monthsSampled: number;

  /** Measured from daily returns over the aligned window. */
  beta: number | null;
  correlation: number | null;
  /** Fund annualized volatility ÷ benchmark's. >1 = a rougher ride. */
  volatilityRatio: number | null;
  fundVolatilityPct: number | null;
  benchmarkVolatilityPct: number | null;

  /** The benchmark's deepest slides, worst first, with the fund's behaviour through each. */
  episodes: DrawdownEpisode[];
  /** The fund's own worst peak-to-trough over the window. */
  fundMaxDrawdownPct: number | null;

  /** One sentence reading the numbers above. Null when too little data. */
  summary: string | null;
}

/* -------------------------------------------------------------------------- */
/* Series helpers                                                              */
/* -------------------------------------------------------------------------- */

/** Total-return close where the provider gives one, raw close otherwise. */
const closeOf = (p: HistoryPoint) => p.adjClose ?? p.close;

interface Aligned { dates: string[]; fund: number[]; bench: number[] }

/** Inner-join two daily series on date. Holiday calendars and listing gaps mean
 *  the two are never the same length; comparing them positionally (the obvious
 *  shortcut) silently offsets every statistic. */
function align(fund: HistoryPoint[], bench: HistoryPoint[]): Aligned {
  const benchByDate = new Map<string, number>();
  for (const p of bench) {
    const c = closeOf(p);
    if (Number.isFinite(c) && c > 0) benchByDate.set(p.date, c);
  }
  const dates: string[] = [];
  const f: number[] = [];
  const b: number[] = [];
  for (const p of fund) {
    const c = closeOf(p);
    const bc = benchByDate.get(p.date);
    if (!Number.isFinite(c) || c <= 0 || bc == null) continue;
    dates.push(p.date);
    f.push(c);
    b.push(bc);
  }
  return { dates, fund: f, bench: b };
}

const returnsOf = (closes: number[]) => {
  const out: number[] = [];
  for (let i = 1; i < closes.length; i++) out.push(closes[i] / closes[i - 1] - 1);
  return out;
};

const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);

function stdDev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
}

/** Month-end closes, so monthly returns are month-over-month rather than an
 *  arbitrary 21-day chunking that would straddle the month boundaries the
 *  up/down split is defined on. */
function monthlySeries(a: Aligned): { fund: number[]; bench: number[] } {
  const lastOfMonth = new Map<string, { f: number; b: number }>();
  for (let i = 0; i < a.dates.length; i++) {
    lastOfMonth.set(a.dates[i].slice(0, 7), { f: a.fund[i], b: a.bench[i] });
  }
  const keys = [...lastOfMonth.keys()].sort();
  const f = keys.map((k) => lastOfMonth.get(k)!.f);
  const b = keys.map((k) => lastOfMonth.get(k)!.b);
  return { fund: returnsOf(f), bench: returnsOf(b) };
}

/** Peak-to-trough slides in `closes` deeper than `thresholdPct`, worst first. */
function drawdownEpisodes(a: Aligned, thresholdPct: number): DrawdownEpisode[] {
  const episodes: DrawdownEpisode[] = [];
  let peakIdx = 0;
  let troughIdx = 0;
  let inEpisode = false;

  const close = (endIdx: number) => {
    const depth = (a.bench[troughIdx] / a.bench[peakIdx] - 1) * 100;
    if (depth <= -thresholdPct) {
      const fundPct = (a.fund[troughIdx] / a.fund[peakIdx] - 1) * 100;
      episodes.push({
        fromDate: a.dates[peakIdx],
        toDate: a.dates[troughIdx],
        benchmarkPct: depth,
        fundPct,
        edgePct: fundPct - depth,
      });
    }
    peakIdx = endIdx;
    troughIdx = endIdx;
    inEpisode = false;
  };

  for (let i = 1; i < a.bench.length; i++) {
    if (a.bench[i] >= a.bench[peakIdx]) {
      // New high: whatever slide preceded it is complete.
      if (inEpisode) close(i);
      else { peakIdx = i; troughIdx = i; }
      continue;
    }
    inEpisode = true;
    if (a.bench[i] < a.bench[troughIdx]) troughIdx = i;
  }
  // A slide still open at the end of the window is a real episode too.
  if (inEpisode) close(a.bench.length - 1);

  return episodes.sort((x, y) => x.benchmarkPct - y.benchmarkPct);
}

function maxDrawdownPct(closes: number[]): number | null {
  if (closes.length < 2) return null;
  let peak = closes[0];
  let worst = 0;
  for (const c of closes) {
    if (c > peak) peak = c;
    const dd = (c / peak - 1) * 100;
    if (dd < worst) worst = dd;
  }
  return worst;
}

/* -------------------------------------------------------------------------- */
/* The analysis                                                                */
/* -------------------------------------------------------------------------- */

export function analyzeRegimeBehavior(
  fundHistory: HistoryPoint[],
  benchmarkHistory: HistoryPoint[],
  benchmarkLabel: string,
): RegimeProfile {
  const a = align(fundHistory, benchmarkHistory);

  const empty: RegimeProfile = {
    alignedDays: a.dates.length,
    benchmarkLabel,
    upCapturePct: null, downCapturePct: null, monthsSampled: 0,
    beta: null, correlation: null, volatilityRatio: null,
    fundVolatilityPct: null, benchmarkVolatilityPct: null,
    episodes: [], fundMaxDrawdownPct: null, summary: null,
  };
  if (a.dates.length < MIN_DAYS_FOR_RISK) return empty;

  /* ── Daily risk statistics ───────────────────────────────────────────────── */
  const fr = returnsOf(a.fund);
  const br = returnsOf(a.bench);
  const fSd = stdDev(fr);
  const bSd = stdDev(br);
  const fMean = mean(fr);
  const bMean = mean(br);

  let cov = 0;
  for (let i = 0; i < fr.length; i++) cov += (fr[i] - fMean) * (br[i] - bMean);
  cov /= Math.max(1, fr.length - 1);

  const beta = bSd > 0 ? cov / (bSd * bSd) : null;
  const correlation = fSd > 0 && bSd > 0 ? cov / (fSd * bSd) : null;
  const ANNUALIZE = Math.sqrt(252);
  const fundVolatilityPct = fSd * ANNUALIZE * 100;
  const benchmarkVolatilityPct = bSd * ANNUALIZE * 100;
  const volatilityRatio = bSd > 0 ? fSd / bSd : null;

  /* ── Up/down capture, on monthly returns ─────────────────────────────────── */
  const m = monthlySeries(a);
  let upCapturePct: number | null = null;
  let downCapturePct: number | null = null;
  if (m.bench.length >= MIN_MONTHS_FOR_CAPTURE) {
    let upF = 0, upB = 0, downF = 0, downB = 0;
    for (let i = 0; i < m.bench.length; i++) {
      if (m.bench[i] > 0) { upB += m.bench[i]; upF += m.fund[i]; }
      else if (m.bench[i] < 0) { downB += m.bench[i]; downF += m.fund[i]; }
    }
    // Cumulative-capture convention: summed fund move ÷ summed benchmark move
    // over the qualifying months. Guarded so a benchmark with no down months in
    // the window reports null rather than dividing by ~0 into a huge number.
    if (upB > 0.001) upCapturePct = (upF / upB) * 100;
    if (downB < -0.001) downCapturePct = (downF / downB) * 100;
  }

  const episodes = drawdownEpisodes(a, EPISODE_THRESHOLD_PCT).slice(0, 3);

  /* ── Reading ─────────────────────────────────────────────────────────────── */
  let summary: string | null = null;
  if (upCapturePct != null && downCapturePct != null) {
    const amplifiesUp = upCapturePct > 105;
    const amplifiesDown = downCapturePct > 105;
    const cushionsDown = downCapturePct < 95;
    const lagsUp = upCapturePct < 95;

    if (amplifiesUp && amplifiesDown) {
      summary = `A leveraged read on ${benchmarkLabel}: it captured ${Math.round(upCapturePct)}% of the benchmark's gains in up months and ${Math.round(downCapturePct)}% of its losses in down months. It works when the market works, and hurts more when it doesn't.`;
    } else if (amplifiesUp && cushionsDown) {
      summary = `The rare shape: ${Math.round(upCapturePct)}% of the benchmark's up months captured against only ${Math.round(downCapturePct)}% of its down months over this window — more upside for less downside.`;
    } else if (lagsUp && cushionsDown) {
      summary = `A defensive profile: it gave up part of the rallies (${Math.round(upCapturePct)}% capture) to take less of the falls (${Math.round(downCapturePct)}%). It earns its keep in weak markets, not strong ones.`;
    } else if (lagsUp && amplifiesDown) {
      summary = `An unfavourable trade-off over this window — ${Math.round(upCapturePct)}% of the benchmark's gains but ${Math.round(downCapturePct)}% of its losses.`;
    } else {
      summary = `It has tracked ${benchmarkLabel} closely: ${Math.round(upCapturePct)}% up capture, ${Math.round(downCapturePct)}% down capture. Environment has mattered less here than the market's own direction.`;
    }

    const worst = episodes[0];
    if (worst) {
      summary += ` Through the benchmark's worst stretch in this window (${worst.fromDate} to ${worst.toDate}, ${worst.benchmarkPct.toFixed(0)}%), it ${worst.edgePct >= 1 ? `held up better at ${worst.fundPct.toFixed(0)}%` : worst.edgePct <= -1 ? `fell further, ${worst.fundPct.toFixed(0)}%` : `moved with it, ${worst.fundPct.toFixed(0)}%`}.`;
    }
  }

  return {
    alignedDays: a.dates.length,
    benchmarkLabel,
    upCapturePct,
    downCapturePct,
    monthsSampled: m.bench.length,
    beta,
    correlation,
    volatilityRatio,
    fundVolatilityPct,
    benchmarkVolatilityPct,
    episodes,
    fundMaxDrawdownPct: maxDrawdownPct(a.fund),
    summary,
  };
}
