import type { AnnualPoint, FinancialStatements } from "./types";
import { getFundamentalsTimeSeries } from "./yahoo";
import { lookupCik } from "./edgar";

const SEC_UA =
  process.env.SEC_USER_AGENT ?? "universal-asset-analyzer divit318@gmail.com";

// Candidate XBRL tags per concept, in no particular priority — the best series
// (the one reaching the latest fiscal year) is chosen at runtime.
const TAGS = {
  revenue: [
    "Revenues",
    "RevenueFromContractWithCustomerExcludingAssessedTax",
    "SalesRevenueNet",
    "RevenueFromContractWithCustomerIncludingAssessedTax",
    "SalesRevenueGoodsNet",
    "SalesRevenueServicesNet",
  ],
  grossProfit: [
    "GrossProfit",
    "GrossProfitLoss",
  ],
  operatingIncome: [
    "OperatingIncomeLoss",
    "IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest",
  ],
  netIncome: [
    "NetIncomeLoss",
    "NetIncomeLossAvailableToCommonStockholdersBasic",
    "ProfitLoss",
  ],
  opCashFlow: [
    "NetCashProvidedByUsedInOperatingActivities",
    "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations",
  ],
  capex: [
    "PaymentsToAcquirePropertyPlantAndEquipment",
    "PaymentsToAcquireProductiveAssets",
    "PurchaseOfPropertyPlantAndEquipment",
  ],
} as const;

interface ConceptUnit {
  start?: string;
  end?: string;
  val: number;
  fy?: number;
  fp?: string;
  form?: string;
}
interface Concept {
  units?: { USD?: ConceptUnit[] };
}

/** AnnualPoint carrying its period end date, so fiscal labels stay auditable. */
export interface AnnualPointWithEnd extends AnnualPoint {
  end?: string | null;
}

/** Extract annual (FY, 10-K, ~1yr period) values from a companyconcept payload. */
export function extractAnnual(concept: Concept): AnnualPointWithEnd[] {
  const usd = concept.units?.USD ?? [];
  const byFy = new Map<number, ConceptUnit>();
  for (const e of usd) {
    if (!String(e.form).startsWith("10-K") || e.fp !== "FY") continue;
    if (e.start && e.end) {
      const days =
        (new Date(e.end).getTime() - new Date(e.start).getTime()) / 86_400_000;
      if (days < 330 || days > 400) continue; // keep annual flows only (allow 52/53-week years)
    }
    if (e.fy == null) continue;
    const prev = byFy.get(e.fy);
    if (!prev || new Date(e.end ?? 0) > new Date(prev.end ?? 0)) {
      byFy.set(e.fy, e);
    }
  }
  return [...byFy.values()]
    .sort((a, b) => (a.fy ?? 0) - (b.fy ?? 0))
    .map((e) => ({ fy: e.fy as number, value: e.val, end: e.end ?? null }));
}

/** Pick the series that reaches the latest fiscal year (then the most points). */
export function pickBestSeries(candidates: AnnualPoint[][]): AnnualPoint[] {
  let best: AnnualPoint[] = [];
  let bestFy = -Infinity;
  for (const series of candidates) {
    if (series.length === 0) continue;
    const lastFy = series[series.length - 1].fy;
    if (lastFy > bestFy || (lastFy === bestFy && series.length > best.length)) {
      best = series;
      bestFy = lastFy;
    }
  }
  return best;
}

/** Compound annual growth rate across a series. Null if not computable. */
export function cagr(points: AnnualPoint[]): number | null {
  if (points.length < 2) return null;
  const first = points[0];
  const last = points[points.length - 1];
  const years = last.fy - first.fy;
  if (years <= 0 || first.value <= 0 || last.value <= 0) return null;
  return Math.pow(last.value / first.value, 1 / years) - 1;
}

function toMap(points: AnnualPointWithEnd[]): Map<number, AnnualPointWithEnd> {
  return new Map(points.map((p) => [p.fy, p]));
}

/** Build margins, FCF, and CAGRs from raw annual series. Pure / testable. */
export function deriveStatements(
  symbol: string,
  raw: {
    revenue: AnnualPointWithEnd[];
    grossProfit: AnnualPointWithEnd[];
    operatingIncome: AnnualPointWithEnd[];
    netIncome: AnnualPointWithEnd[];
    opCashFlow: AnnualPointWithEnd[];
    capex: AnnualPointWithEnd[];
    /** Optional: pre-computed FCF; overrides opCashFlow − capex when provided. */
    freeCashFlowOverride?: AnnualPointWithEnd[];
  },
  maxYears = 5,
): FinancialStatements {
  const fiscalYears = raw.revenue.map((p) => p.fy).slice(-maxYears);
  const rev = toMap(raw.revenue);
  const gp = toMap(raw.grossProfit);
  const oi = toMap(raw.operatingIncome);
  const ni = toMap(raw.netIncome);
  const ocf = toMap(raw.opCashFlow);
  const cx = toMap(raw.capex);

  const series = (m: Map<number, AnnualPointWithEnd>): AnnualPointWithEnd[] =>
    fiscalYears
      .filter((fy) => m.has(fy))
      .map((fy) => ({ fy, value: m.get(fy)!.value, end: m.get(fy)!.end ?? null }));

  const margin = (num: Map<number, AnnualPointWithEnd>): AnnualPointWithEnd[] =>
    fiscalYears
      .filter((fy) => num.has(fy) && rev.has(fy) && rev.get(fy)!.value !== 0)
      .map((fy) => ({ fy, value: num.get(fy)!.value / rev.get(fy)!.value, end: rev.get(fy)!.end ?? null }));

  const freeCashFlow: AnnualPointWithEnd[] = raw.freeCashFlowOverride
    ? raw.freeCashFlowOverride.filter((p) => fiscalYears.includes(p.fy))
    : fiscalYears
        .filter((fy) => ocf.has(fy) && cx.has(fy))
        .map((fy) => ({ fy, value: ocf.get(fy)!.value - cx.get(fy)!.value, end: ocf.get(fy)!.end ?? null }));

  const revenue = series(rev);

  return {
    symbol,
    fiscalYears,
    revenue,
    grossProfit: series(gp),
    operatingIncome: series(oi),
    netIncome: series(ni),
    freeCashFlow,
    grossMargin: margin(gp),
    operatingMargin: margin(oi),
    netMargin: margin(ni),
    revenueCagr: cagr(revenue),
    fcfCagr: cagr(freeCashFlow),
  };
}

async function fetchConcept(cik: string, tag: string): Promise<AnnualPoint[]> {
  const res = await fetch(
    `https://data.sec.gov/api/xbrl/companyconcept/CIK${cik}/us-gaap/${tag}.json`,
    // Deadline, not just error handling: SEC throttling holds sockets open
    // rather than 429ing, and this was the last SEC fetch without one.
    { headers: { "User-Agent": SEC_UA }, signal: AbortSignal.timeout(30_000) },
  );
  if (!res.ok) return [];
  return extractAnnual((await res.json()) as Concept);
}

async function bestConcept(cik: string, tags: readonly string[]): Promise<AnnualPoint[]> {
  const series = await Promise.all(tags.map((t) => fetchConcept(cik, t)));
  return pickBestSeries(series);
}

/** Fetch and derive a company's annual financial statements from SEC EDGAR. */
export async function getFinancialStatements(
  symbol: string,
): Promise<FinancialStatements> {
  const entry = await lookupCik(symbol);
  if (!entry) {
    throw new Error(`No SEC filer found for "${symbol}" (US-listed only)`);
  }

  const [revenue, grossProfit, operatingIncome, netIncome, opCashFlow, capex] =
    await Promise.all([
      bestConcept(entry.cik, TAGS.revenue),
      bestConcept(entry.cik, TAGS.grossProfit),
      bestConcept(entry.cik, TAGS.operatingIncome),
      bestConcept(entry.cik, TAGS.netIncome),
      bestConcept(entry.cik, TAGS.opCashFlow),
      bestConcept(entry.cik, TAGS.capex),
    ]);

  if (revenue.length === 0) {
    throw new Error(`No annual statement data available for "${symbol}"`);
  }

  return deriveStatements(symbol, {
    revenue,
    grossProfit,
    operatingIncome,
    netIncome,
    opCashFlow,
    capex,
  });
}

/**
 * Fetch annual financial statements from Yahoo Finance's fundamentalsTimeSeries.
 * Works for all markets (US and international). Returns up to 6 fiscal years.
 * Used as primary source or fallback when SEC EDGAR returns insufficient history.
 */
export async function getFinancialStatementsYahoo(
  symbol: string,
): Promise<FinancialStatements | null> {
  try {
    const ts = await getFundamentalsTimeSeries(symbol);
    if (!ts.length) return null;

    const toPoints = (field: string): AnnualPointWithEnd[] =>
      ts
        .flatMap((r): AnnualPointWithEnd[] => {
          const v = typeof r[field] === "number" ? (r[field] as number) : null;
          const rawDate = r["date"];
          const end =
            rawDate instanceof Date
              ? rawDate.toISOString().slice(0, 10)
              : typeof rawDate === "string"
              ? rawDate
              : null;
          // FY label = calendar year of the period end. The end date is carried
          // alongside so a non-December fiscal year renders with its actual end
          // month instead of silently reading as a calendar year.
          const fy = end ? new Date(end).getUTCFullYear() : null;
          return v != null && fy != null && Number.isFinite(fy) ? [{ fy, value: v, end }] : [];
        })
        .sort((a, b) => a.fy - b.fy);

    const revenue = toPoints("totalRevenue");
    if (!revenue.length) return null;

    return deriveStatements(
      symbol,
      {
        revenue,
        grossProfit: toPoints("grossProfit"),
        operatingIncome: toPoints("operatingIncome"),
        netIncome: toPoints("netIncome"),
        opCashFlow: [],
        capex: [],
        freeCashFlowOverride: toPoints("freeCashFlow"),
      },
      7, // allow up to 7 years from Yahoo time series
    );
  } catch {
    return null;
  }
}
