/**
 * India-specific fund scoring — the SEBI-category-aware buckets that
 * computeFundScore (lib/fund-scoring.ts) uses for Indian mutual funds and
 * ETFs. Indian funds must not be judged by the US framework (Phase 2 audit,
 * docs/india-strategy/PHASE2_LOCALIZATION_AUDIT.md): the Indian norm is
 * CATEGORY-relative evaluation under SEBI's 2017 scheme categorization —
 * a small-cap fund, a liquid fund and an index fund answer different
 * questions — plus rolling returns rather than point-to-point, TER judged
 * against SEBI's slab caps and the direct/regular gap, and tracking
 * difference for passive funds.
 *
 * Only bucket CONSTRUCTION lives here. The blend, recommendation mapping and
 * rationale stay in computeFundScore, so a 0-100 composite and 5-tier call
 * mean the same thing for every fund in the app (same precedent as
 * lib/india-snapshot.ts vs lib/scoring.ts for equities).
 *
 * Benchmarks are Yahoo price-return indices (^NSEI, ^CRSLDX, NIFTYMIDCAP150.NS,
 * NIFTYSMLCAP250.NS — availability verified live 2026-09). SEBI mandates TRI
 * benchmarks, which Yahoo does not carry, so every benchmark label says "(PRI)"
 * and relative readings are flattered by roughly the ~1-1.5pp/yr dividend
 * yield — stated rather than hidden.
 *
 * Pure and deterministic; all data arrives as arguments.
 */

import type { FundProfileData, HistoryPoint } from "./types";
import { mk, bucket } from "./score-math";

type BucketPart = ReturnType<typeof bucket>;

const pct1 = (v: number) => `${v.toFixed(1)}%`;

/* -------------------------------------------------------------------------- */
/* Category helpers                                                            */
/* -------------------------------------------------------------------------- */

type AmfiCat = NonNullable<FundProfileData["amfiCategory"]>;

const isPassive = (c: AmfiCat) => /index fund|etf/i.test(c.category);
const isSectoral = (c: AmfiCat) => /sectoral|thematic/i.test(c.category);
const isFocused = (c: AmfiCat) => /focused/i.test(c.category);
const isSmallCap = (c: AmfiCat) => /small cap/i.test(c.category);
const isMidCap = (c: AmfiCat) => /^mid cap/i.test(c.category);

/**
 * The Yahoo-listed index a category (or an index fund's own name) is honestly
 * comparable against. Null when no single index is defensible (debt, hybrid,
 * solution — their SEBI benchmarks are blended/duration indices Yahoo lacks).
 */
export function indiaCategoryBenchmark(
  fund: Pick<FundProfileData, "amfiCategory" | "amfiSchemeName">,
): { symbol: string; label: string } | null {
  const cat = fund.amfiCategory;
  if (!cat) return null;

  if (isPassive(cat)) {
    // An index fund tracks ITS index — detect it from the official scheme name.
    const name = (fund.amfiSchemeName ?? "").toLowerCase();
    if (/nifty\s*500/.test(name)) return { symbol: "^CRSLDX", label: "NIFTY 500 (PRI)" };
    if (/midcap\s*150/.test(name)) return { symbol: "NIFTYMIDCAP150.NS", label: "NIFTY Midcap 150 (PRI)" };
    if (/smallcap\s*250/.test(name)) return { symbol: "NIFTYSMLCAP250.NS", label: "NIFTY Smallcap 250 (PRI)" };
    if (/nifty\s*bank|bank\s*nifty/.test(name)) return { symbol: "^NSEBANK", label: "NIFTY Bank (PRI)" };
    if (/sensex/.test(name)) return { symbol: "^BSESN", label: "SENSEX (PRI)" };
    if (/nifty\s*50\b/.test(name)) return { symbol: "^NSEI", label: "NIFTY 50 (PRI)" };
    return null; // unknown underlying index — absolute fallback, never a wrong index
  }
  if (cat.group === "equity") {
    // SEBI tier-1 benchmarks per category (TRI variants mandated; PRI is what
    // Yahoo serves — labelled).
    if (/^large cap/i.test(cat.category)) return { symbol: "^NSEI", label: "NIFTY 50 (PRI)" };
    if (isMidCap(cat)) return { symbol: "NIFTYMIDCAP150.NS", label: "NIFTY Midcap 150 (PRI)" };
    if (isSmallCap(cat)) return { symbol: "NIFTYSMLCAP250.NS", label: "NIFTY Smallcap 250 (PRI)" };
    if (isSectoral(cat)) return null; // sector indices vary per theme — no honest default
    // Flexi/Multi/Large & Mid/ELSS/Value/Contra/Focused/Dividend Yield: the
    // full-market index is the standard reference.
    return { symbol: "^CRSLDX", label: "NIFTY 500 (PRI)" };
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* Pure series math                                                            */
/* -------------------------------------------------------------------------- */

const MS_PER_YEAR = 365.25 * 24 * 3600 * 1000;

/**
 * Rolling `years`-year CAGRs (percent p.a.) sampled roughly monthly across the
 * series — the Indian norm for fund performance, because point-to-point
 * returns are dominated by the choice of endpoints.
 */
export function rollingCagrs(history: HistoryPoint[], years = 3, stepBars = 21): number[] {
  const pts = history.filter((p) => p.close > 0 && Number.isFinite(p.close));
  if (pts.length < 60) return [];
  const times = pts.map((p) => new Date(p.date).getTime());
  const span = years * MS_PER_YEAR;
  const out: number[] = [];
  let start = 0;
  for (let end = 0; end < pts.length; end += stepBars) {
    const target = times[end] - span;
    while (start < end && times[start] < target) start++;
    if (start === 0 && times[0] > target) continue; // window would reach before the series
    const actualYears = (times[end] - times[start]) / MS_PER_YEAR;
    if (actualYears < years * 0.9) continue;
    out.push((Math.pow(pts[end].close / pts[start].close, 1 / actualYears) - 1) * 100);
    start = 0; // re-scan; series are ~1.2k bars, monthly-stepped — cheap and simple
  }
  return out;
}

export function medianOf(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Peak-to-trough max drawdown over the series, as a negative fraction. */
export function maxDrawdown(history: HistoryPoint[]): number | null {
  let peak = -Infinity;
  let worst = 0;
  let seen = 0;
  for (const p of history) {
    if (!(p.close > 0) || !Number.isFinite(p.close)) continue;
    seen++;
    if (p.close > peak) peak = p.close;
    else worst = Math.min(worst, p.close / peak - 1);
  }
  return seen >= 60 ? worst : null;
}

/** Date-aligned [fund, benchmark] close pairs (inner join, same as the beta module). */
function alignPairs(
  a: HistoryPoint[],
  b: HistoryPoint[],
): { fund: number; bench: number; time: number }[] {
  const bByDate = new Map<string, number>();
  for (const p of b) if (p.close > 0 && Number.isFinite(p.close)) bByDate.set(p.date, p.close);
  const out: { fund: number; bench: number; time: number }[] = [];
  for (const p of a) {
    const v = bByDate.get(p.date);
    if (v != null && p.close > 0 && Number.isFinite(p.close)) {
      out.push({ fund: p.close, bench: v, time: new Date(p.date).getTime() });
    }
  }
  return out;
}

/**
 * Fund CAGR minus benchmark CAGR over the trailing `years` window (aligned
 * endpoints), in percentage points p.a. — tracking difference for passive
 * funds, plain relative return for active ones.
 */
export function cagrDifferencePp(
  fund: HistoryPoint[],
  benchmark: HistoryPoint[],
  years: number,
): number | null {
  const pairs = alignPairs(fund, benchmark);
  if (pairs.length < 60) return null;
  const end = pairs[pairs.length - 1];
  let startIdx = 0;
  while (startIdx < pairs.length - 1 && pairs[startIdx].time < end.time - years * MS_PER_YEAR) {
    startIdx++;
  }
  const start = pairs[startIdx];
  const actualYears = (end.time - start.time) / MS_PER_YEAR;
  if (actualYears < years * 0.75) return null;
  const cagr = (e: number, s: number) => (Math.pow(e / s, 1 / actualYears) - 1) * 100;
  return cagr(end.fund, start.fund) - cagr(end.bench, start.bench);
}

/**
 * Downside capture: fund's average daily return on benchmark-down days over
 * the benchmark's — below 1.0 means the fund falls less than its market.
 */
export function downsideCapture(fund: HistoryPoint[], benchmark: HistoryPoint[]): number | null {
  const pairs = alignPairs(fund, benchmark);
  if (pairs.length < 120) return null;
  let fSum = 0;
  let bSum = 0;
  let n = 0;
  for (let i = 1; i < pairs.length; i++) {
    const bRet = pairs[i].bench / pairs[i - 1].bench - 1;
    if (bRet >= 0) continue;
    fSum += pairs[i].fund / pairs[i - 1].fund - 1;
    bSum += bRet;
    n++;
  }
  if (n < 30 || bSum === 0) return null;
  return fSum / n / (bSum / n);
}

/* -------------------------------------------------------------------------- */
/* Buckets                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Cost, judged against SEBI's TER regime rather than US fund economics:
 * regulatory caps run to 2.25% (equity, small AUM), a good direct equity plan
 * charges ~0.5-1%, index funds single-digit bps to ~50bps, and the
 * direct-vs-regular gap is ~0.6-0.9pp — so plan type moves the band.
 */
function indiaCostBucket(fund: FundProfileData, cat: AmfiCat): BucketPart {
  const terPct = fund.expenseRatio != null ? fund.expenseRatio * 100 : null;
  const turnoverPct = fund.turnoverPercent != null ? fund.turnoverPercent * 100 : null;
  const [worst, best] = isPassive(cat)
    ? [1.0, 0.05]
    : cat.group === "debt"
      ? [1.75, 0.15]
      : fund.amfiPlan === "direct"
        ? [2.0, 0.4]
        : fund.amfiPlan === "regular"
          ? [2.5, 0.8]
          : [2.25, 0.5];
  const planLabel = fund.amfiPlan ? `${fund.amfiPlan} plan` : "plan unknown";
  return bucket("Cost", [
    mk("Expense ratio (TER)", terPct, worst, best, 16, (v) => `${v.toFixed(2)}% TER (${planLabel})`),
    mk("Portfolio turnover", turnoverPct, 150, 5, 9, (v) => `${v.toFixed(0)}% annual turnover`),
  ]);
}

/**
 * Structure: concentration judged against the category's MANDATE. A focused
 * fund (SEBI cap: 30 stocks) and a sectoral/thematic fund are concentrated by
 * design and must not be penalized for it; passive and debt funds skip the
 * judgment entirely (null — the bucket isn't rendered).
 */
function indiaStructureBucket(fund: FundProfileData, cat: AmfiCat): BucketPart | null {
  if (isPassive(cat) || cat.group === "debt") return null;
  const top10 = fund.holdings
    .slice()
    .sort((a, b) => b.weightPercent - a.weightPercent)
    .slice(0, 10)
    .reduce((s, h) => s + h.weightPercent, 0);
  const hasHoldings = fund.holdings.length > 0;
  const topSectorWeight = fund.sectorWeights[0]?.weightPercent ?? null;

  if (isSectoral(cat)) {
    return bucket("Structure (thematic mandate)", [
      mk("Top-10 holdings concentration", hasHoldings ? top10 : null, 100, 25, 15, (v) =>
        `Top 10 = ${v.toFixed(0)}% of fund (sector concentration is the mandate)`,
      ),
    ]);
  }
  if (isFocused(cat)) {
    return bucket("Structure (focused mandate)", [
      mk("Top-10 holdings concentration", hasHoldings ? top10 : null, 100, 40, 15, (v) =>
        `Top 10 = ${v.toFixed(0)}% of fund (SEBI focused cap: 30 stocks)`,
      ),
      mk("Largest sector weight", topSectorWeight, 100, 25, 10, (v) =>
        `${fund.sectorWeights[0]?.sector ?? "Top sector"} = ${v.toFixed(0)}%`,
      ),
    ]);
  }
  return bucket("Diversification", [
    mk("Top-10 holdings concentration", hasHoldings ? top10 : null, 100, 15, 15, (v) => `Top 10 holdings = ${v.toFixed(0)}% of fund`),
    mk("Largest sector weight", topSectorWeight, 100, 15, 10, (v) => `${fund.sectorWeights[0]?.sector ?? "Top sector"} = ${v.toFixed(0)}%`),
  ]);
}

/**
 * Performance. Passive funds: tracking difference vs their own index (the
 * ONLY performance question for an index fund). Active funds: median rolling
 * 3-year CAGR (endpoint-independent), plus the benchmark-relative rolling
 * figure when a defensible index exists, else the consistency of rolling
 * windows. Bands per category group — an 8% CAGR is respectable for a debt
 * fund and poor for a small-cap fund.
 */
function indiaPerformanceBucket(
  fund: FundProfileData,
  cat: AmfiCat,
  history: HistoryPoint[],
  benchmark: HistoryPoint[] | undefined,
  benchLabel: string | null,
): BucketPart {
  if (isPassive(cat)) {
    if (benchmark?.length) {
      const td1 = cagrDifferencePp(history, benchmark, 1);
      const td3 = cagrDifferencePp(history, benchmark, 3);
      return bucket("Tracking", [
        // A well-run Indian index fund lags its PRI index by roughly the
        // dividend yield MINUS costs; vs PRI a good tracker can even sit
        // slightly positive. Materially negative = real tracking loss.
        mk("1y tracking difference", td1, -2.5, 0.5, 16, (v) => `1y: ${v >= 0 ? "+" : ""}${v.toFixed(2)}pp vs ${benchLabel}`),
        mk("3y tracking difference (p.a.)", td3, -2.0, 0.5, 9, (v) => `3y: ${v >= 0 ? "+" : ""}${v.toFixed(2)}pp p.a. vs ${benchLabel}`),
      ]);
    }
    // Unknown underlying index — absolute returns, honestly labelled; never
    // score a tracker against an index it doesn't track.
    return bucket("Performance", [
      mk("1-year return", fund.trailingReturns.oneYear, -20, 25, 16, (v) => `1-year: ${v >= 0 ? "+" : ""}${pct1(v)} (absolute — underlying index unidentified)`),
      mk("3-year return (annualized)", fund.trailingReturns.threeYear, -5, 18, 9, (v) => `3-year: ${v >= 0 ? "+" : ""}${pct1(v)} p.a. (absolute)`),
    ]);
  }

  const rolling = rollingCagrs(history, 3);
  const median = medianOf(rolling);
  const medianBand: [number, number] =
    cat.group === "debt" ? [3, 9] : cat.group === "hybrid" || cat.group === "solution" ? [2, 12] : [0, 18];

  if (median == null) {
    // < ~3 years of NAV history: trailing returns with the basis stated.
    return bucket("Performance", [
      mk("1-year return", fund.trailingReturns.oneYear, -20, 25, 16, (v) => `1-year: ${v >= 0 ? "+" : ""}${pct1(v)} (absolute — history too short for rolling returns)`),
      mk("3-year return (annualized)", fund.trailingReturns.threeYear, -5, 18, 9, (v) => `3-year: ${v >= 0 ? "+" : ""}${pct1(v)} p.a. (absolute)`),
    ]);
  }

  // Per-window rolling alpha needs exact series alignment per window; the
  // trailing 3y CAGR difference is the honest, cheap benchmark-relative
  // reading (the rolling MEDIAN above already removes endpoint luck from the
  // absolute figure).
  const rel3 = benchmark?.length ? cagrDifferencePp(history, benchmark, 3) : null;

  const relBand: [number, number] = cat.group === "debt" ? [-2, 2] : [-4, 4];
  const factors = [
    mk("Median rolling 3y return", median, ...medianBand, 16, (v) => `Rolling 3y median: ${v >= 0 ? "+" : ""}${pct1(v)} p.a. (${rolling.length} windows)`),
    rel3 != null && benchLabel
      ? mk("3y vs benchmark", rel3, ...relBand, 9, (v) =>
          `3y: ${v >= 0 ? "+" : ""}${v.toFixed(1)}pp p.a. vs ${benchLabel}`,
        )
      : mk(
          "Rolling-window consistency",
          rolling.length ? rolling.filter((r) => r > 0).length / rolling.length : null,
          cat.group === "debt" ? 0.9 : 0.5,
          1,
          9,
          (v) => `${(v * 100).toFixed(0)}% of rolling 3y windows positive`,
        ),
  ];
  return bucket(benchLabel && rel3 != null ? "Performance vs Benchmark" : "Performance (rolling)", factors);
}

/**
 * Risk, sized to the category: a -45% drawdown is unremarkable for a small-cap
 * fund across a cycle and disqualifying for a liquid fund. Downside capture vs
 * the category index when one exists; the vendor Sharpe otherwise.
 */
function indiaRiskBucket(
  fund: FundProfileData,
  cat: AmfiCat,
  history: HistoryPoint[],
  benchmark: HistoryPoint[] | undefined,
): BucketPart {
  const dd = maxDrawdown(history);
  const ddPct = dd != null ? dd * 100 : null;
  const ddBand: [number, number] =
    cat.group === "debt"
      ? [-10, -0.5]
      : cat.group === "hybrid" || cat.group === "solution"
        ? [-40, -15]
        : isSmallCap(cat)
          ? [-65, -30]
          : isMidCap(cat)
            ? [-60, -28]
            : [-55, -25];

  const capture = benchmark?.length ? downsideCapture(history, benchmark) : null;
  return bucket("Risk (category-sized)", [
    mk("Max drawdown", ddPct, ...ddBand, 15, (v) => `Max drawdown ${v.toFixed(0)}% over the loaded history`),
    capture != null
      ? mk("Downside capture", capture, 1.4, 0.7, 10, (v) => `Captures ${(v * 100).toFixed(0)}% of benchmark down-days`)
      : mk("Sharpe ratio", fund.risk?.sharpeRatio ?? null, -0.5, 2, 10, (v) => `Sharpe ${v.toFixed(2)}`),
  ]);
}

/* -------------------------------------------------------------------------- */
/* Entry                                                                       */
/* -------------------------------------------------------------------------- */

export interface IndiaFundBuckets {
  parts: BucketPart[];
  /** For the rationale: what the fund was judged as. */
  categoryLabel: string;
  benchmarkLabel: string | null;
}

/**
 * The category-aware bucket set for an Indian fund, or null when the fund has
 * no resolved AMFI category (the caller falls back to the generic path, which
 * already labels its absolute-basis honestly).
 */
export function indiaFundBuckets(
  fund: FundProfileData,
  history: HistoryPoint[],
  benchmarkHistory?: HistoryPoint[],
): IndiaFundBuckets | null {
  const cat = fund.amfiCategory;
  if (!cat || fund.currency !== "INR") return null;
  const bench = indiaCategoryBenchmark(fund);
  const benchLabel = bench?.label ?? null;
  const parts = [
    indiaCostBucket(fund, cat),
    indiaStructureBucket(fund, cat),
    indiaPerformanceBucket(fund, cat, history, benchmarkHistory, benchLabel),
    indiaRiskBucket(fund, cat, history, benchmarkHistory),
  ].filter((b): b is BucketPart => b != null);
  return {
    parts,
    categoryLabel: `${cat.category}${fund.amfiPlan ? `, ${fund.amfiPlan} plan` : ""}`,
    benchmarkLabel: benchLabel,
  };
}
