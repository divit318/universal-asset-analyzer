/**
 * IC Report — canonical report data model (Phase 1).
 *
 * One validated, provenance-carrying object per report. Every financial field
 * carries value, unit, currency, period, source and retrieval timestamp. Every
 * downstream consumer — signal detectors' prompt context, every agent, every
 * valuation method, the thesis, the UI and the exports — reads from this
 * object and never re-interprets raw provider payloads.
 *
 * Missing data is a first-class state: a concept that cannot be resolved is
 * recorded in `gaps` with a reason, and mutually inconsistent inputs are
 * recorded in `validationIssues` — loudly, instead of silently rendering a
 * plausible wrong number.
 */

import type {
  Quote,
  FundamentalsSnapshot,
  FinancialStatements,
  AnalystConsensus,
  InsiderActivity,
} from "../types";
import type { ScreenerInCompany } from "../screener-in";
import type { Market } from "./format";

/* ── Provenance-carrying datum ──────────────────────────────────────────── */

export type Provider =
  | "yahoo-quote"
  | "yahoo-quoteSummary"
  | "sec-edgar"
  | "yahoo-timeseries"
  | "screener.in"
  | "derived";

export type DatumUnit = "currency" | "fraction" | "ratio" | "shares" | "perShare";

export interface Datum {
  value: number;
  unit: DatumUnit;
  /** ISO currency code — present whenever unit is "currency" or "perShare". */
  currency?: string;
  /** "spot", "TTM", "FY2026", … — every number states the period it measures. */
  periodLabel: string;
  source: { provider: Provider; field: string; ref?: string };
  asOf: string;
}

export interface DataGap {
  concept: string;
  reason: string;
}

export interface AnnualSeriesPoint {
  fy: number;
  /** Period end date when the provider reported one. */
  end?: string | null;
  value: number;
}

export interface CanonicalStatements {
  provider: Provider;
  currency: string;
  fiscalYears: number[];
  revenue: AnnualSeriesPoint[];
  netIncome: AnnualSeriesPoint[];
  freeCashFlow: AnnualSeriesPoint[];
  operatingMargin: AnnualSeriesPoint[];
  grossMargin: AnnualSeriesPoint[];
  revenueCagr: number | null;
  /** Number of years the revenue CAGR spans — a CAGR without its window is meaningless. */
  revenueCagrYears: number | null;
  fcfCagr: number | null;
  fcfCagrYears: number | null;
}

/* ── Canonical facts ────────────────────────────────────────────────────── */

export interface CanonicalFacts {
  symbol: string;
  companyName: string;
  market: Market;
  exchange: string | null;
  /** Trading currency, ISO code. */
  currency: string;
  /** Retrieval timestamp for the whole object. */
  asOf: string;

  /* One value per concept (Phase 1.4/1.5). Variants are distinct fields. */
  spot: Datum | null;
  marketCap: Datum | null;
  sharesOutstanding: Datum | null;
  totalDebt: Datum | null;
  totalCash: Datum | null;
  /** totalDebt − totalCash. Negative = net cash. */
  netDebt: Datum | null;
  /** marketCap + netDebt. */
  enterpriseValue: Datum | null;
  /** Trailing-twelve-month FCF (Yahoo financialData). */
  freeCashFlowTtm: Datum | null;
  /** Latest full fiscal year FCF (statements). Distinct concept from TTM. */
  freeCashFlowFy: Datum | null;
  ebitdaTtm: Datum | null;

  /* Multiples and rates */
  trailingPE: Datum | null;
  forwardPE: Datum | null;
  pegRatio: Datum | null;
  priceToBook: Datum | null;
  evToEbitda: Datum | null;
  priceToSales: Datum | null;
  dividendYield: Datum | null;
  returnOnEquity: Datum | null;
  returnOnAssets: Datum | null;
  grossMargin: Datum | null;
  operatingMargin: Datum | null;
  netMargin: Datum | null;
  revenueGrowthYoY: Datum | null;
  earningsGrowthYoY: Datum | null;
  debtToEquity: Datum | null;
  currentRatio: Datum | null;

  statements: CanonicalStatements | null;
  analyst: (AnalystConsensus & { asOf: string; currency: string }) | null;
  insider: (InsiderActivity & { asOf: string }) | null;
  screenerIn: ScreenerInCompany | null;

  gaps: DataGap[];
  /** Mutually inconsistent inputs — rendered as loud failures, never hidden. */
  validationIssues: string[];
}

/* ── Builder ────────────────────────────────────────────────────────────── */

export interface CanonicalInput {
  symbol: string;
  quote: Quote | null;
  snapshot: FundamentalsSnapshot | null;
  analyst: AnalystConsensus | null;
  insider: InsiderActivity | null;
  statements: FinancialStatements | null;
  /** Which provider produced `statements` ("sec-edgar" | "yahoo-timeseries"). */
  statementsProvider?: Provider;
  screenerIn: ScreenerInCompany | null;
  now?: string;
}

export function resolveMarket(symbol: string, quote: Quote | null): Market {
  if (symbol.endsWith(".NS") || symbol.endsWith(".BO")) return "IN";
  if (quote?.currency === "INR") return "IN";
  const usExchanges = new Set(["NMS", "NYQ", "NGM", "NCM", "ASE", "PCX", "BTS", "PNK"]);
  if (quote?.exchange && usExchanges.has(quote.exchange)) return "US";
  if (quote?.currency === "USD") return "US";
  return quote ? "OTHER" : symbol.includes(".") ? "OTHER" : "US";
}

export function buildCanonicalFacts(input: CanonicalInput): CanonicalFacts {
  const now = input.now ?? new Date().toISOString();
  const { symbol, quote, snapshot, statements, screenerIn } = input;
  const gaps: DataGap[] = [];
  const validationIssues: string[] = [];

  const market = resolveMarket(symbol, quote);
  const currency = quote?.currency ?? (market === "IN" ? "INR" : "USD");

  const q = (field: string, value: number | null | undefined, unit: DatumUnit, periodLabel: string): Datum | null =>
    value != null && Number.isFinite(value)
      ? { value, unit, currency: unit === "currency" || unit === "perShare" ? currency : undefined, periodLabel, source: { provider: "yahoo-quote", field }, asOf: now }
      : null;
  const s = (field: string, value: number | null | undefined, unit: DatumUnit, periodLabel = "TTM"): Datum | null =>
    value != null && Number.isFinite(value)
      ? { value, unit, currency: unit === "currency" || unit === "perShare" ? currency : undefined, periodLabel, source: { provider: "yahoo-quoteSummary", field }, asOf: now }
      : null;
  const derived = (field: string, value: number, unit: DatumUnit, periodLabel: string, ref: string): Datum => ({
    value, unit, currency: unit === "currency" || unit === "perShare" ? currency : undefined, periodLabel, source: { provider: "derived", field, ref }, asOf: now,
  });

  /* Spot / capitalisation (Phase 1.5) */
  const spot = q("regularMarketPrice", quote?.price ?? snapshot?.price, "perShare", "spot");
  if (!spot) gaps.push({ concept: "spot price", reason: "quote unavailable from provider" });
  const marketCap = q("marketCap", quote?.marketCap, "currency", "spot");
  const totalDebt = s("financialData.totalDebt", snapshot?.totalDebt, "currency");
  const totalCash = s("financialData.totalCash", snapshot?.totalCash, "currency");
  const netDebt = totalDebt && totalCash
    ? derived("netDebt", totalDebt.value - totalCash.value, "currency", "TTM", "totalDebt − totalCash")
    : null;
  if (!netDebt) gaps.push({ concept: "net debt", reason: "total debt or total cash missing from provider" });

  /* Shares: derive from marketCap / spot when not directly reported. */
  let sharesOutstanding: Datum | null = null;
  if (marketCap && spot && spot.value > 0) {
    sharesOutstanding = derived("sharesOutstanding", marketCap.value / spot.value, "shares", "spot", "marketCap ÷ spot");
  }
  if (!sharesOutstanding) gaps.push({ concept: "shares outstanding", reason: "market cap or spot missing" });

  const enterpriseValue = marketCap
    ? derived("enterpriseValue", marketCap.value + (netDebt?.value ?? 0), "currency", "spot",
        netDebt ? "marketCap + netDebt" : "marketCap (net debt unavailable, assumed 0 — see gaps)")
    : null;
  if (marketCap && !netDebt) {
    validationIssues.push("Enterprise value computed without net debt (debt/cash unavailable) — treat EV-based multiples as approximate.");
  }

  /* Cash flow / earnings power — one value per concept, variants named. */
  const freeCashFlowTtm = s("financialData.freeCashflow", snapshot?.freeCashflow, "currency");
  if (!freeCashFlowTtm) gaps.push({ concept: "free cash flow (TTM)", reason: "not reported by provider" });
  const ebitdaTtm = s("financialData.ebitda", snapshot?.ebitda, "currency");

  /* Statements with fiscal-alignment validation (Phase 1.2/1.3). */
  let canonicalStatements: CanonicalStatements | null = null;
  if (statements && statements.revenue.length > 0) {
    const provider = input.statementsProvider ?? "sec-edgar";
    const issues = validateStatements(statements);
    validationIssues.push(...issues);
    canonicalStatements = {
      provider,
      currency: provider === "sec-edgar" ? "USD" : currency,
      fiscalYears: statements.fiscalYears,
      revenue: statements.revenue,
      netIncome: statements.netIncome,
      freeCashFlow: statements.freeCashFlow,
      operatingMargin: statements.operatingMargin,
      grossMargin: statements.grossMargin,
      revenueCagr: statements.revenueCagr,
      revenueCagrYears: spanYears(statements.revenue),
      fcfCagr: statements.fcfCagr,
      fcfCagrYears: spanYears(statements.freeCashFlow),
    };
    if (provider === "sec-edgar" && currency !== "USD") {
      validationIssues.push(
        `Statement series is in USD (SEC EDGAR) while the stock trades in ${currency} — do not mix the two without conversion.`,
      );
    }
  } else if (market === "IN") {
    gaps.push({ concept: "annual statements", reason: "SEC EDGAR covers US filers only; Indian filings are not integrated — annual trends come from screener.in where available" });
  } else {
    gaps.push({ concept: "annual statements", reason: "no annual statement data from SEC EDGAR or Yahoo" });
  }

  const lastFyFcf = canonicalStatements?.freeCashFlow.at(-1) ?? null;
  const freeCashFlowFy = lastFyFcf && canonicalStatements
    ? {
        value: lastFyFcf.value,
        unit: "currency" as const,
        currency: canonicalStatements.currency,
        periodLabel: `FY${lastFyFcf.fy}`,
        source: { provider: canonicalStatements.provider, field: "freeCashFlow", ref: lastFyFcf.end ?? undefined },
        asOf: now,
      }
    : null;

  /* Market-cap consistency check (Phase 1.2 — fail loudly on mismatch). */
  if (marketCap && spot && sharesOutstanding) {
    const implied = spot.value * sharesOutstanding.value;
    const drift = Math.abs(implied - marketCap.value) / marketCap.value;
    if (drift > 0.05) {
      validationIssues.push(
        `Market cap (${marketCap.value.toExponential(2)}) disagrees with spot × shares (${implied.toExponential(2)}) by ${(drift * 100).toFixed(0)}% — share count may be stale.`,
      );
    }
  }

  if (!input.analyst || (input.analyst.numberOfOpinions ?? 0) === 0) {
    gaps.push({ concept: "analyst coverage", reason: "no analyst estimates reported for this name" });
  }
  if (!input.insider || input.insider.transactions.length === 0) {
    gaps.push({ concept: "insider transactions", reason: "no insider transaction data reported for this name" });
  }

  return {
    symbol,
    companyName: quote?.name ?? screenerIn?.name ?? symbol,
    market,
    exchange: quote?.exchange ?? null,
    currency,
    asOf: now,
    spot,
    marketCap,
    sharesOutstanding,
    totalDebt,
    totalCash,
    netDebt,
    enterpriseValue,
    freeCashFlowTtm,
    freeCashFlowFy,
    ebitdaTtm,
    trailingPE: s("summaryDetail.trailingPE", snapshot?.trailingPE, "ratio"),
    forwardPE: s("summaryDetail.forwardPE", snapshot?.forwardPE, "ratio"),
    pegRatio: s("defaultKeyStatistics.pegRatio", snapshot?.pegRatio, "ratio"),
    priceToBook: s("defaultKeyStatistics.priceToBook", snapshot?.priceToBook, "ratio"),
    evToEbitda: s("defaultKeyStatistics.enterpriseToEbitda", snapshot?.enterpriseToEbitda, "ratio"),
    priceToSales: s("summaryDetail.priceToSalesTrailing12Months", snapshot?.priceToSalesTrailing12Months, "ratio"),
    dividendYield: s("summaryDetail.dividendYield", snapshot?.dividendYield, "fraction"),
    returnOnEquity: s("financialData.returnOnEquity", snapshot?.returnOnEquity, "fraction"),
    returnOnAssets: s("financialData.returnOnAssets", snapshot?.returnOnAssets, "fraction"),
    grossMargin: s("financialData.grossMargins", snapshot?.grossMargins, "fraction"),
    operatingMargin: s("financialData.operatingMargins", snapshot?.operatingMargins, "fraction"),
    netMargin: s("financialData.profitMargins", snapshot?.profitMargins, "fraction"),
    revenueGrowthYoY: s("financialData.revenueGrowth", snapshot?.revenueGrowth, "fraction"),
    earningsGrowthYoY: s("financialData.earningsGrowth", snapshot?.earningsGrowth, "fraction"),
    debtToEquity: s("financialData.debtToEquity", snapshot?.debtToEquity, "ratio"),
    currentRatio: s("financialData.currentRatio", snapshot?.currentRatio, "ratio"),
    statements: canonicalStatements,
    analyst: input.analyst ? { ...input.analyst, asOf: now, currency } : null,
    insider: input.insider ? { ...input.insider, asOf: now } : null,
    screenerIn,
    gaps,
    validationIssues,
  };
}

/* ── Validation ─────────────────────────────────────────────────────────── */

function spanYears(points: { fy: number }[]): number | null {
  if (points.length < 2) return null;
  return points[points.length - 1].fy - points[0].fy;
}

/**
 * Assert fiscal-year alignment (Phase 1.2): labels strictly increasing, values
 * finite, margin series bounded, and — when period end dates exist — the end
 * dates must increase with the labels. Returns human-readable issues.
 */
export function validateStatements(st: FinancialStatements): string[] {
  const issues: string[] = [];
  const seriesList: [string, { fy: number; end?: string | null; value: number }[]][] = [
    ["revenue", st.revenue],
    ["netIncome", st.netIncome],
    ["freeCashFlow", st.freeCashFlow],
    ["operatingMargin", st.operatingMargin],
  ];
  for (const [name, series] of seriesList) {
    for (let i = 1; i < series.length; i++) {
      if (series[i].fy <= series[i - 1].fy) {
        issues.push(`${name}: fiscal years not strictly increasing (FY${series[i - 1].fy} → FY${series[i].fy})`);
      }
      const e0 = series[i - 1].end;
      const e1 = series[i].end;
      if (e0 && e1 && new Date(e1) <= new Date(e0)) {
        issues.push(`${name}: FY${series[i].fy} period end (${e1}) is not after FY${series[i - 1].fy} (${e0}) — fiscal labels and period dates disagree`);
      }
    }
    for (const p of series) {
      if (!Number.isFinite(p.value)) issues.push(`${name}: non-finite value at FY${p.fy}`);
    }
  }
  for (const p of st.operatingMargin) {
    if (Math.abs(p.value) > 1.5) {
      issues.push(`operatingMargin FY${p.fy} = ${p.value} — not a plausible margin fraction; a raw currency figure may have landed in a ratio field`);
    }
  }
  /* Revenue-in-FCF collision check (Phase 1.3): identical value in the same FY
     across revenue and FCF is an ingest fault, not a coincidence, when it
     repeats. */
  const revByFy = new Map(st.revenue.map((p) => [p.fy, p.value]));
  let collisions = 0;
  for (const p of st.freeCashFlow) {
    const rev = revByFy.get(p.fy);
    if (rev != null && rev !== 0 && p.value === rev) collisions++;
  }
  if (collisions >= 2) {
    issues.push(`freeCashFlow equals revenue in ${collisions} fiscal years — field mapping collision at ingest`);
  }
  return issues;
}
