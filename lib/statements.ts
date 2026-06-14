import type { AnnualPoint, FinancialStatements } from "./types";
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
  ],
  grossProfit: ["GrossProfit"],
  operatingIncome: ["OperatingIncomeLoss"],
  netIncome: ["NetIncomeLoss"],
  opCashFlow: [
    "NetCashProvidedByUsedInOperatingActivities",
    "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations",
  ],
  capex: [
    "PaymentsToAcquirePropertyPlantAndEquipment",
    "PaymentsToAcquireProductiveAssets",
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

/** Extract annual (FY, 10-K, ~1yr period) values from a companyconcept payload. */
export function extractAnnual(concept: Concept): AnnualPoint[] {
  const usd = concept.units?.USD ?? [];
  const byFy = new Map<number, ConceptUnit>();
  for (const e of usd) {
    if (!String(e.form).startsWith("10-K") || e.fp !== "FY") continue;
    if (e.start && e.end) {
      const days =
        (new Date(e.end).getTime() - new Date(e.start).getTime()) / 86_400_000;
      if (days < 350 || days > 380) continue; // keep annual flows only
    }
    if (e.fy == null) continue;
    const prev = byFy.get(e.fy);
    if (!prev || new Date(e.end ?? 0) > new Date(prev.end ?? 0)) {
      byFy.set(e.fy, e);
    }
  }
  return [...byFy.values()]
    .sort((a, b) => (a.fy ?? 0) - (b.fy ?? 0))
    .map((e) => ({ fy: e.fy as number, value: e.val }));
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

function toMap(points: AnnualPoint[]): Map<number, number> {
  return new Map(points.map((p) => [p.fy, p.value]));
}

/** Build margins, FCF, and CAGRs from raw annual series. Pure / testable. */
export function deriveStatements(
  symbol: string,
  raw: {
    revenue: AnnualPoint[];
    grossProfit: AnnualPoint[];
    operatingIncome: AnnualPoint[];
    netIncome: AnnualPoint[];
    opCashFlow: AnnualPoint[];
    capex: AnnualPoint[];
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

  const series = (m: Map<number, number>): AnnualPoint[] =>
    fiscalYears.filter((fy) => m.has(fy)).map((fy) => ({ fy, value: m.get(fy)! }));

  const margin = (num: Map<number, number>): AnnualPoint[] =>
    fiscalYears
      .filter((fy) => num.has(fy) && rev.has(fy) && rev.get(fy)! !== 0)
      .map((fy) => ({ fy, value: num.get(fy)! / rev.get(fy)! }));

  const freeCashFlow: AnnualPoint[] = fiscalYears
    .filter((fy) => ocf.has(fy) && cx.has(fy))
    .map((fy) => ({ fy, value: ocf.get(fy)! - cx.get(fy)! }));

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
    { headers: { "User-Agent": SEC_UA } },
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
