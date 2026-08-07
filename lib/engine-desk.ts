/**
 * Quant Engine desk — shared types and vocabulary.
 *
 * The wire shape of `engine/dashboard.py`'s brief, plus the one place the
 * engine's own vocabulary (signal tiers, HMM regimes, factor definitions) is
 * defined. Deliberately pure and dependency-free: imported by the desk's client
 * components and by its API routes, so it must never reach `lib/db.ts` or any
 * server-only module (see CLAUDE.md's note on the client-bundle break that
 * caused).
 *
 * Note this is *not* `lib/recommendation.ts`'s job. That module maps a 0-100
 * composite score to a recommendation band and is the single source of truth for
 * Research/Screener. The engine emits a discrete signal tier directly from its
 * own z-score composite, so it needs labels and tones for tiers, not bands.
 */

/* -------------------------------------------------------------------------- */
/* Signal tiers                                                               */
/* -------------------------------------------------------------------------- */

export type EngineSignal = "STRONG_BUY" | "BUY" | "HOLD" | "SELL" | "STRONG_SELL";

export const SIGNAL_ORDER: EngineSignal[] = ["STRONG_BUY", "BUY", "HOLD", "SELL", "STRONG_SELL"];

export const SIGNAL_LABEL: Record<string, string> = {
  STRONG_BUY: "Strong Buy",
  BUY: "Buy",
  HOLD: "Hold",
  SELL: "Sell",
  STRONG_SELL: "Strong Sell",
};

/** Text + border/background tone per tier. Was duplicated across the engine page
 *  and the (now folded-in) standalone backtest page. */
export const SIGNAL_TONE: Record<string, { text: string; chip: string; bar: string }> = {
  /* STRONG tiers keep their own emerald/red identity in dark; the light:
     variants deepen them to AA — emerald-400 measured 1.95:1 on white
     (2026-08-08 light-mode audit). */
  STRONG_BUY:  { text: "text-emerald-400 light:text-emerald-700", chip: "border-emerald-400/30 bg-emerald-400/10 light:border-emerald-700/40", bar: "bg-emerald-400 light:bg-emerald-600" },
  BUY:         { text: "text-positive",    chip: "border-positive/30 bg-positive/10",       bar: "bg-positive" },
  HOLD:        { text: "text-muted",       chip: "border-border bg-surface-2",              bar: "bg-border" },
  SELL:        { text: "text-negative",    chip: "border-negative/30 bg-negative/10",       bar: "bg-negative" },
  STRONG_SELL: { text: "text-red-500 light:text-red-700", chip: "border-red-500/30 bg-red-500/10 light:border-red-700/40", bar: "bg-red-500" },
};

export function signalTone(signal: string) {
  return SIGNAL_TONE[signal] ?? SIGNAL_TONE.HOLD;
}

/* -------------------------------------------------------------------------- */
/* Regimes                                                                    */
/* -------------------------------------------------------------------------- */

export type RegimeLabel = "Bull" | "Bear" | "Range" | "Crash" | "Recovery";

export const REGIME_ORDER: RegimeLabel[] = ["Bull", "Recovery", "Range", "Bear", "Crash"];

/** Raw hex, because these also feed inline SVG/gradient styles where a Tailwind
 *  class can't be used. Mirrors the chart palette in app/_components/chart-theme.ts.
 *  Theme-paired (2026-08-08 light-mode audit): the dark set is the original;
 *  the light set deepens each hue for a white canvas ("Bull" as text measured
 *  2.10:1). Client components resolve via regimeColor(label, theme). */
export const REGIME_COLOR: Record<string, string> = {
  Bull: "#22c55e",
  Recovery: "#3b82f6",
  Range: "#f59e0b",
  Bear: "#ef4444",
  Crash: "#dc2626",
};

export const REGIME_COLOR_LIGHT: Record<string, string> = {
  Bull: "#15803d",
  Recovery: "#2563eb",
  Range: "#b45309",
  Bear: "#b91c1c",
  Crash: "#7f1d1d",
};

export function regimeColor(label: string, theme: "light" | "dark"): string | undefined {
  return theme === "light" ? REGIME_COLOR_LIGHT[label] : REGIME_COLOR[label];
}

/* -------------------------------------------------------------------------- */
/* Factors                                                                    */
/* -------------------------------------------------------------------------- */

export interface FactorMeta {
  label: string;
  /** What the factor measures, in one sentence. */
  desc: string;
  /** The actual arithmetic — the engine shows its working rather than asserting a score. */
  formula: string;
}

/** Keyed by the weight/plain name (`momentum`), not the scorecard column
 *  (`momentum_score`) — `scoreKey()` bridges the two. */
export const FACTOR_META: Record<string, FactorMeta> = {
  momentum: {
    label: "Momentum",
    desc: "Jegadeesh-Titman 12-1 month. Skips the most recent month to avoid short-term reversal.",
    formula: "ret(252d) − ret(21d) → cross-sectional z-score",
  },
  quality: {
    label: "Quality",
    desc: "QMJ composite (Asness 2019). Profitability 40% · Safety 30% · Growth 20% · Payout 10%.",
    formula: "z(ROE, ROIC, margins, leverage, CAGR) → within-group avg → z-score",
  },
  value: {
    label: "Value",
    desc: "Every metric converted to yield space before averaging, so PE and EV/EBITDA scales can't fight.",
    formula: "mean(1/PE, 1/EV_EBITDA, FCF_yield, div_yield) → z-score",
  },
  low_vol: {
    label: "Low Vol",
    desc: "Low-volatility factor. Negative of 63-day realized annualised vol — lower vol scores higher.",
    formula: "−σ(log_ret, 63d) × √252 → cross-sectional z-score",
  },
  revision: {
    label: "Revision",
    desc: "Earnings revision momentum from analyst beat rate and EPS growth YoY.",
    formula: "(beat_pct − 50)/50 + tanh(eps_growth/50) → cross-sectional z-score",
  },
  regime: {
    label: "Regime",
    desc: "HMM posterior probability-weighted expected return across the five states.",
    formula: "Σ P(state) × annualised_μ(state) / max_μ → normalised to [−3, 3]",
  },
  mc_upside: {
    label: "MC Upside",
    desc: "Upside to the median of a 50,000-path Monte Carlo DCF.",
    formula: "(intrinsic_p50 − price) / price",
  },
  forecast: {
    label: "Forecast",
    desc: "LightGBM quantile regression P(return > 0), calibrated via a Gaussian IQR fit.",
    formula: "(prob_up − 0.5) × 2 → [−1, 1]",
  },
};

/** Factors that carry an IC-derived weight in the composite (excludes `forecast`,
 *  which enters as its own term rather than a weighted z-score). */
export const WEIGHTED_FACTORS = ["momentum", "quality", "value", "low_vol", "revision", "regime", "mc_upside"] as const;
export type WeightedFactor = (typeof WEIGHTED_FACTORS)[number];

/** `momentum` → `momentum_score`, the scorecard column holding that factor's z. */
export function scoreKey(factor: string): string {
  return factor === "mc_upside" ? "mc_upside" : `${factor}_score`;
}

/* -------------------------------------------------------------------------- */
/* Wire types — engine/dashboard.py                                           */
/* -------------------------------------------------------------------------- */

export interface ForecastBand {
  p10: number | null;
  p50: number | null;
  p90: number | null;
  prob_up: number | null;
}

export interface ScorecardRow {
  symbol: string;
  date?: string;
  name?: string | null;
  sector?: string | null;
  momentum_score: number;
  quality_score: number;
  value_score: number;
  low_vol_score: number;
  revision_score: number;
  regime_score: number;
  forecast_score: number;
  mc_upside: number;
  kelly_fraction: number;
  composite_score: number;
  signal: string;
  confidence: number;
}

/** A conviction-book entry: a scorecard row plus its probability band. */
export interface ConvictionRow extends ScorecardRow {
  forecast: ForecastBand | null;
}

export interface RegimeBrief {
  label: RegimeLabel | null;
  /** Share of scored names whose own HMM agrees with the modal label. */
  breadth_pct: number;
  confidence: number | null;
  probabilities: Record<string, number | null>;
  expected_annual_return: number | null;
  explanation: string;
  stance: string;
  mu: Record<string, number>;
  days_in_regime: number;
  history: { date: string; label: string; breadth_pct: number }[];
  n_symbols: number;
}

export interface FactorWeights {
  current: Record<string, number | string | null>;
  /** "ic" once the engine has persisted a run's derived weights; "default" before then. */
  source: "ic" | "default";
  top_factor: string | null;
  shifts: { factor: string; from: number; to: number; delta: number }[];
  history: Record<string, number | string | null>[];
  n_runs: number;
}

export interface SectorBreadth {
  sector: string;
  n: number;
  n_bullish: number;
  n_bearish: number;
  net_tilt_pct: number;
  dispersion: number | null;
  best_symbol: string;
  best_composite: number | null;
}

export interface Breadth {
  n_total: number;
  n_bullish: number;
  n_bearish: number;
  n_neutral: number;
  pct_bullish: number;
  pct_bearish: number;
  pct_positive_momentum: number;
  signal_distribution: { signal: string; count: number }[];
  composite_percentiles: Partial<Record<"p10" | "p50" | "p90", number | null>>;
  sectors: SectorBreadth[];
}

export interface MoverRow {
  symbol: string;
  name: string | null;
  delta: number;
  composite_score: number;
  prev_composite_score: number;
  signal: string;
  prev_signal: string;
  tier_changed: boolean;
}

export interface SignalChange {
  symbol: string;
  name: string | null;
  signal: string;
  composite_score: number;
}

export interface Movers {
  upgrades: MoverRow[];
  downgrades: MoverRow[];
  signals_added: SignalChange[];
  signals_removed: SignalChange[];
  n_compared: number;
}

export interface EngineDashboard {
  empty: false;
  generated_at: string;
  latest_date: string;
  prev_date: string | null;
  n_symbols: number;
  regime: RegimeBrief | null;
  factor_weights: FactorWeights;
  breadth: Breadth;
  movers: Movers;
  conviction: { longs: ConvictionRow[]; shorts: ConvictionRow[]; has_forecasts: boolean };
}

export interface EngineDashboardEmpty {
  empty: true;
  reason: string;
}

/** What `/api/engine/dashboard` returns. `stale` marks a brief served from the
 *  precomputed snapshot while a run is in flight; `degraded` marks one the route
 *  could not produce inside its budget. */
export type DashboardResponse =
  | (EngineDashboard & { stale?: boolean; degraded?: false })
  | (EngineDashboardEmpty & { stale?: boolean; degraded?: boolean });

export function isDashboardEmpty(d: DashboardResponse): d is EngineDashboardEmpty & { degraded?: boolean } {
  return d.empty === true;
}

/* -------------------------------------------------------------------------- */
/* Error vocabulary                                                           */
/* -------------------------------------------------------------------------- */

/** A user-facing account of an engine failure: one plain-language line, plus the
 *  raw output (a Python traceback, usually) demoted to collapsible detail. */
export interface EngineErrorDescription {
  summary: string;
  /** Raw technical output for a "technical details" disclosure. Null when the
   *  message is already short and human-readable on its own. */
  detail: string | null;
}

/**
 * Turn whatever an engine subprocess left in stderr into something a person can
 * act on. The engine's failure modes surface as raw Python tracebacks, spawn
 * errors, or timeout prose — only the last of those is fit to show directly.
 * Everything here is best-effort string inspection: an unrecognised message
 * falls through as its own first line with the rest as detail, never dropped.
 */
export function describeEngineError(raw: string | null | undefined): EngineErrorDescription {
  const text = (raw ?? "").trim();
  if (!text) return { summary: "Something went wrong in the engine.", detail: null };

  const moduleMatch = text.match(/ModuleNotFoundError: No module named '([^']+)'/);
  if (moduleMatch) {
    return {
      summary:
        `The engine's Python environment is missing the "${moduleMatch[1]}" package. ` +
        "From the project root, run: python3 -m venv .venv && .venv/bin/pip install -r requirements.txt",
      detail: text,
    };
  }

  if (/spawn .*python.* (ENOENT|EACCES)/i.test(text) || (/ENOENT/.test(text) && /python/i.test(text))) {
    return {
      summary:
        "No usable Python interpreter was found for the engine. Create the project environment with: python3 -m venv .venv && .venv/bin/pip install -r requirements.txt",
      detail: text,
    };
  }

  const trace = text.indexOf("Traceback (most recent call last)");
  if (trace !== -1) {
    // The last non-empty line of a traceback is the exception itself — the only
    // line of the dump that belongs in a sentence.
    const lines = text.slice(trace).split("\n").map((l) => l.trim()).filter(Boolean);
    const last = lines[lines.length - 1] ?? "unknown error";
    return { summary: `The engine's Python process failed: ${last}`, detail: text };
  }

  // Short single-line messages (timeouts, route-authored prose) are already the
  // summary; anything long or multi-line keeps its first line and demotes the rest.
  const [first = ""] = text.split("\n");
  if (text === first && first.length <= 200) return { summary: first, detail: null };
  return {
    summary: first.length > 200 ? `${first.slice(0, 197)}…` : first,
    detail: text,
  };
}
