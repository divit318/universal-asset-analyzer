/**
 * Thematic Research Engine — Industries & Commodities Discovery Framework
 *
 * Implements the 10-stage framework from YLP Finance Masterclass Part 10.5.
 * Input: a thematic trend name (e.g. "AI Compute", "Energy Storage")
 * Output: a fully scored ThematicReport with company tier mapping, bottleneck
 * analysis, supply/demand cycle, policy overlay, and India leapfrog scoring.
 *
 * Data sources:
 *   - Claude (runPrompt) — qualitative scoring stages 1, 3, 5, 6, 7, 9
 *   - Yahoo Finance (yfinance tickers) — commodity price proxies for supply/demand
 *   - Existing screener DB (getFreshFundamentals) — Tier 1–6 company matching
 *   - NSE FII flow (macro_loader) — capital cycle signal
 */

import { runPrompt } from "./ai";
import { pickModel } from "./ai/router";
import { getFreshFundamentals } from "./db";
import { fetchMarketNews } from "./news";
import { extractJson } from "./json-extract";
import type { StockFundamentals, NewsItem } from "./types";

/* ─────────────────────────── Public types ──────────────────────────── */

export type ThematicStage =
  | "init"
  | "future_state"
  | "dependency_chain"
  | "bottleneck"
  | "supply_demand"
  | "commodity"
  | "policy"
  | "global_structural_advantage"
  | "company_mapping"
  | "company_quality"
  | "opportunity_score"
  | "done"
  | "error";

export interface ThematicProgressEvent {
  stage: ThematicStage;
  message: string;
  data?: unknown;
}

export interface FutureStateScore {
  inevitabilityScore: number;        // 0–10
  timeHorizon: string;               // e.g. "3–7 years"
  drivingForces: string[];           // top 3 drivers
  rationale: string;
}

export interface DependencyNode {
  tier: 1 | 2 | 3 | 4 | 5 | 6;
  tierLabel: string;                 // "Infrastructure" etc.
  description: string;              // what this tier does
  exampleCompanies: string[];       // generic examples (not from screener)
  isBottleneck: boolean;
}

export interface BottleneckScore {
  score: number;                     // 0–10
  bottleneckTier: number;
  bottleneckDescription: string;
  scarceFactors: string[];           // why it's hard to replicate
  substituteRisk: "low" | "medium" | "high";
  substituteRationale: string;
  expansionDifficulty: string;       // long approval cycles, geopolitical, etc.
}

export interface CommodityProxy {
  ticker: string;
  name: string;
  price: number | null;
  priceChange1M: number | null;      // % 1-month change
  priceChange3M: number | null;      // % 3-month change
  priceChange1Y: number | null;      // % 1-year change
  trend: "rising" | "falling" | "flat";
}

export interface SupplyDemandScore {
  score: number;                     // 0–10
  demandTrajectory: "accelerating" | "growing" | "stable" | "declining";
  supplyTrajectory: "constrained" | "tight" | "balanced" | "oversupplied";
  capitalCyclePhase: "early" | "mid" | "late" | "downturn";
  commodityProxies: CommodityProxy[];
  demandDrivers: string[];
  supplyConstraints: string[];
  investmentSignal: "strong" | "moderate" | "weak" | "avoid";
}

export interface CommodityFrameworkScore {
  score: number;                     // 0–10
  primaryCommodities: string[];
  demandCatalysts: string[];
  supplyRisks: string[];
  substitutionRisk: "low" | "medium" | "high";
  recyclingEconomics: string;
  reserveConcentration: string;      // e.g. "Congo controls 60% of cobalt"
}

export interface PolicyScore {
  score: number;                     // 0–10
  relevantPolicies: PolicyItem[];
  capitalFlowDirection: string;      // where is policy forcing capital
  geopoliticalFactors: string[];
  indiaSpecificPolicies: string[];
}

export interface PolicyItem {
  country: string;
  policy: string;
  impact: "highly positive" | "positive" | "neutral" | "negative";
  estimatedCapitalUSD: string | null;
}

export interface RegionStructuralAdvantage {
  region: string;                    // e.g. "United States", "China", "India"
  advantages: string[];
  disadvantages: string[];
}

export interface GlobalStructuralAdvantageScore {
  score: number;                     // 0–10 — how clear-cut/durable the global advantage dynamics are
  currentLeader: string;             // region name
  fastestImproving: string;          // region name
  regions: RegionStructuralAdvantage[];
  longTermImplications: string;      // synthesis of what this means for long-term investors
}

export interface TierCompany {
  tier: 1 | 2 | 3 | 4 | 5 | 6;
  tierLabel: string;
  symbol: string;
  name: string;
  sector: string | null;
  industry: string | null;
  roic: number | null;
  grossMargin: number | null;
  revenueGrowthYoY: number | null;
  debtToEquity: number | null;
  isIndia: boolean;
  relevanceRationale: string;
  qualityScore: number | null;       // 0–100 from screener
  strategicImportance: "critical" | "high" | "medium" | "low";
  moatType: "cost" | "scale" | "technology" | "distribution" | "regulation" | "none";
}

export interface OpportunityScore {
  themeScore: number;                // 0–100 weighted
  themeBreakdown: {
    inevitability: number;
    bottleneck: number;
    capitalCycle: number;
    demandGrowth: number;
    policy: number;
    substitutionResistance: number;
    structuralAdvantage: number;
  };
  topCompanies: TierCompany[];       // top 5 by quality × relevance
  verdict: "exceptional" | "strong" | "moderate" | "weak" | "avoid";
  verdictRationale: string;
  analystChecklist: AnalystChecklistItem[];
}

export interface AnalystChecklistItem {
  question: string;
  answer: string;
  signal: "positive" | "neutral" | "negative";
}

export interface ThematicReport {
  theme: string;
  generatedAt: string;
  model: string;
  futureState: FutureStateScore;
  dependencyChain: DependencyNode[];
  bottleneck: BottleneckScore;
  supplyDemand: SupplyDemandScore;
  commodityFramework: CommodityFrameworkScore;
  policy: PolicyScore;
  structuralAdvantage: GlobalStructuralAdvantageScore;
  tierCompanies: TierCompany[];
  opportunity: OpportunityScore;
  newsItems: NewsItem[];
}

export interface ThematicReportInput {
  theme: string;                     // e.g. "AI Compute Infrastructure"
}

/* ─────────────────────── Commodity proxy tickers ───────────────────── */

// Map theme keywords → yfinance proxy ETF/commodity tickers
const THEME_COMMODITY_MAP: Record<string, { ticker: string; name: string }[]> = {
  default: [
    { ticker: "GLD",    name: "Gold (GLD ETF)" },
    { ticker: "USO",    name: "Crude Oil (USO ETF)" },
  ],
  "ai":          [{ ticker: "SMH", name: "Semiconductors (SMH ETF)" }, { ticker: "NVDA", name: "NVIDIA" }],
  "compute":     [{ ticker: "SMH", name: "Semiconductors (SMH ETF)" }, { ticker: "AMAT", name: "Applied Materials" }],
  "semiconductor": [{ ticker: "SMH", name: "Semiconductors" }, { ticker: "SOXX", name: "SOX Index (SOXX)" }],
  "energy":      [{ ticker: "USO", name: "Crude Oil" }, { ticker: "UNG", name: "Natural Gas" }, { ticker: "XLE", name: "Energy ETF" }],
  "solar":       [{ ticker: "TAN", name: "Solar ETF" }, { ticker: "FSLR", name: "First Solar" }],
  "battery":     [{ ticker: "LIT", name: "Lithium & Battery Tech (LIT)" }, { ticker: "LITH.L", name: "Lithium miners" }],
  "lithium":     [{ ticker: "LIT", name: "Lithium ETF" }, { ticker: "ALB", name: "Albemarle" }],
  "copper":      [{ ticker: "CPER", name: "Copper ETF" }, { ticker: "FCX", name: "Freeport-McMoRan" }],
  "electrification": [{ ticker: "LIT", name: "Lithium" }, { ticker: "CPER", name: "Copper" }, { ticker: "TAN", name: "Solar" }],
  "uranium":     [{ ticker: "URA", name: "Uranium ETF" }, { ticker: "CCJ", name: "Cameco" }],
  "nuclear":     [{ ticker: "URA", name: "Uranium ETF" }, { ticker: "NLR", name: "Nuclear ETF" }],
  "defense":     [{ ticker: "ITA", name: "Aerospace & Defense ETF" }, { ticker: "LMT", name: "Lockheed Martin" }],
  "water":       [{ ticker: "PHO", name: "Water ETF" }, { ticker: "AWK", name: "American Water Works" }],
  "robotics":    [{ ticker: "ROBO", name: "Robotics ETF" }, { ticker: "IRBO", name: "iShares Robotics ETF" }],
  "infrastructure": [{ ticker: "PAVE", name: "Infrastructure ETF" }, { ticker: "GLD", name: "Gold (store of value)" }],
  "data center": [{ ticker: "EQIX", name: "Equinix" }, { ticker: "DLR", name: "Digital Realty" }],
  "rare earth":  [{ ticker: "REMX", name: "Rare Earth ETF" }, { ticker: "MP", name: "MP Materials" }],
  "steel":       [{ ticker: "SLX", name: "Steel ETF" }, { ticker: "NUE", name: "Nucor" }],
  "fertilizer":  [{ ticker: "MOO", name: "Agri ETF" }, { ticker: "MOS", name: "Mosaic" }],
};

function pickCommodityProxies(theme: string): { ticker: string; name: string }[] {
  const t = theme.toLowerCase();
  const results: { ticker: string; name: string }[] = [];
  const seen = new Set<string>();
  for (const [keyword, tickers] of Object.entries(THEME_COMMODITY_MAP)) {
    if (keyword === "default") continue;
    if (t.includes(keyword)) {
      for (const item of tickers) {
        if (!seen.has(item.ticker)) { seen.add(item.ticker); results.push(item); }
      }
    }
  }
  if (results.length === 0) {
    for (const item of THEME_COMMODITY_MAP.default) {
      if (!seen.has(item.ticker)) { seen.add(item.ticker); results.push(item); }
    }
  }
  return results.slice(0, 4);
}

/* ────────────────── Yahoo Finance price fetching ───────────────────── */

interface PriceData { price: number; history: number[] }

async function fetchYahooPrice(ticker: string): Promise<PriceData | null> {
  try {
    const YahooFinance = (await import("yahoo-finance2")).default;
    const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

    const [quote, hist] = await Promise.allSettled([
      yf.quote(ticker),
      yf.chart(ticker, { period1: new Date(Date.now() - 400 * 86400 * 1000).toISOString().slice(0, 10), interval: "1d" }),
    ]);

    const price = quote.status === "fulfilled"
      ? ((quote.value as { regularMarketPrice?: number }).regularMarketPrice ?? null)
      : null;

    if (!price) return null;

    const closes: number[] = [];
    if (hist.status === "fulfilled") {
      const quotes = (hist.value as { quotes?: { close?: number | null }[] }).quotes ?? [];
      for (const q of quotes) {
        if (typeof q.close === "number" && q.close > 0) closes.push(q.close);
      }
    }

    return { price, history: closes };
  } catch {
    return null;
  }
}

function pctChange(history: number[], daysBack: number): number | null {
  if (history.length < daysBack + 1) return null;
  const recent = history[history.length - 1];
  const past = history[history.length - 1 - Math.min(daysBack, history.length - 1)];
  if (!past || past === 0) return null;
  return ((recent - past) / past) * 100;
}

async function fetchCommodityProxies(proxies: { ticker: string; name: string }[]): Promise<CommodityProxy[]> {
  const results = await Promise.allSettled(
    proxies.map(async (p) => {
      const data = await fetchYahooPrice(p.ticker);
      if (!data) return { ticker: p.ticker, name: p.name, price: null, priceChange1M: null, priceChange3M: null, priceChange1Y: null, trend: "flat" as const };
      const c1m = pctChange(data.history, 22);
      const c3m = pctChange(data.history, 63);
      const c1y = pctChange(data.history, 252);
      const trend: "rising" | "falling" | "flat" =
        c3m != null ? (c3m > 5 ? "rising" : c3m < -5 ? "falling" : "flat") : "flat";
      return { ticker: p.ticker, name: p.name, price: data.price, priceChange1M: c1m, priceChange3M: c3m, priceChange1Y: c1y, trend };
    }),
  );
  return results.map((r) => (r.status === "fulfilled" ? r.value : { ticker: "", name: "", price: null, priceChange1M: null, priceChange3M: null, priceChange1Y: null, trend: "flat" as const }));
}

/* ───────────────────── AI scoring stages ───────────────────────────── */

async function scoreFutureState(theme: string): Promise<FutureStateScore> {
  const prompt = `You are an elite thematic research analyst. Evaluate the following investment theme for future state inevitability.

THEME: "${theme}"

Score this theme 0–10 on inevitability. 10 = absolutely certain this becomes mainstream (like smartphones in 2010), 0 = highly speculative/unlikely.

Consider:
- Is this driven by physics/biology/demographics (irreversible) or by policy/preference (reversible)?
- What are the 3 strongest forcing functions?
- What time horizon (years) is realistic for mainstream adoption?
- What would have to be true to prevent this from happening?

Return JSON only:
{
  "inevitabilityScore": <0-10>,
  "timeHorizon": "<e.g. 3-7 years>",
  "drivingForces": ["<force1>", "<force2>", "<force3>"],
  "rationale": "<2-3 sentences on why this score>"
}`;

  try {
    const raw = await runPrompt("thematic-analysis", prompt, { maxTokens: 600, json: true });
    return extractJson<FutureStateScore>(raw);
  } catch {
    return { inevitabilityScore: 5, timeHorizon: "unknown", drivingForces: [], rationale: "AI analysis unavailable." };
  }
}

async function buildDependencyChain(theme: string): Promise<DependencyNode[]> {
  const prompt = `You are a supply chain and thematic research expert. For the theme "${theme}", map the full dependency chain.

The dependency chain has exactly 6 tiers:
- Tier 1: Direct beneficiaries / end products (the "obvious winners")
- Tier 2: Infrastructure required to deliver the end product
- Tier 3: Equipment and tools to build that infrastructure
- Tier 4: Raw materials / commodities consumed
- Tier 5: Maintenance, services, and consumables
- Tier 6: Recycling, waste, end-of-life processing

For each tier, identify:
1. What this tier provides/does in the context of "${theme}"
2. 2-3 specific real-world company examples (not tickers)
3. Whether this tier is a bottleneck (scarce, hard to replicate, controls the value chain)

Return JSON only — an array of exactly 6 objects:
[
  {
    "tier": 1,
    "tierLabel": "<e.g. AI Model Producers>",
    "description": "<what this tier does, 1-2 sentences>",
    "exampleCompanies": ["<company1>", "<company2>"],
    "isBottleneck": false
  },
  ...
]`;

  try {
    const raw = await runPrompt("thematic-analysis", prompt, { maxTokens: 1200, json: true });
    return (extractJson<DependencyNode[]>(raw)).slice(0, 6);
  } catch {
    return [];
  }
}

async function scoreBottleneck(theme: string, chain: DependencyNode[]): Promise<BottleneckScore> {
  const chainSummary = chain.map((n) => `Tier ${n.tier} (${n.tierLabel}): ${n.description}. Bottleneck: ${n.isBottleneck}`).join("\n");

  const prompt = `You are a commodity and supply chain analyst. Identify and score the bottleneck in the "${theme}" value chain.

DEPENDENCY CHAIN:
${chainSummary}

A bottleneck is a tier that:
- Is scarce (limited supply, long permitting, concentrated reserves)
- Is difficult or slow to replicate (years to build, regulatory hurdles)
- Is not easily substituted
- Controls the throughput of the entire value chain

Score the bottleneck 0–10 (10 = extreme bottleneck like TSMC for chips, 0 = no real constraint).

Return JSON only:
{
  "score": <0-10>,
  "bottleneckTier": <1-6>,
  "bottleneckDescription": "<what exactly is the bottleneck and why>",
  "scarceFactors": ["<factor1>", "<factor2>", "<factor3>"],
  "substituteRisk": "low" | "medium" | "high",
  "substituteRationale": "<why substitutes do/don't work>",
  "expansionDifficulty": "<e.g. 'Uranium enrichment requires 7-10 years and $10B+ capex with geopolitical constraints'>"
}`;

  try {
    const raw = await runPrompt("thematic-analysis", prompt, { maxTokens: 800, json: true });
    return extractJson<BottleneckScore>(raw);
  } catch {
    return { score: 5, bottleneckTier: 4, bottleneckDescription: "Analysis unavailable.", scarceFactors: [], substituteRisk: "medium", substituteRationale: "", expansionDifficulty: "" };
  }
}

async function scoreSupplyDemand(
  theme: string,
  proxies: CommodityProxy[],
): Promise<Omit<SupplyDemandScore, "commodityProxies">> {
  const proxyContext = proxies
    .filter((p) => p.price !== null)
    .map((p) => `${p.name}: price $${p.price?.toFixed(2)}, 1M ${p.priceChange1M != null ? p.priceChange1M.toFixed(1) + "%" : "n/a"}, 3M ${p.priceChange3M != null ? p.priceChange3M.toFixed(1) + "%" : "n/a"}, 1Y ${p.priceChange1Y != null ? p.priceChange1Y.toFixed(1) + "%" : "n/a"}, trend: ${p.trend}`)
    .join("\n");

  const prompt = `You are a commodity and capital cycle analyst. Assess the supply-demand balance for the theme "${theme}".

COMMODITY/EQUITY PROXIES (live market data):
${proxyContext || "No live proxy data available."}

Assess:
1. Demand trajectory (accelerating / growing / stable / declining)
2. Supply trajectory (constrained / tight / balanced / oversupplied)
3. Capital cycle phase (early = not yet invested; mid = investment underway; late = overcapacity risk; downturn = demand fell)
4. Investment signal based on capital cycle theory: best entry is EARLY (demand rising, supply not yet responding)
5. Top 3 demand drivers
6. Top 3 supply constraints
7. Score 0–10: 10 = ideal setup (demand accelerating + supply constrained + early cycle), 0 = worst setup

Return JSON only:
{
  "score": <0-10>,
  "demandTrajectory": "accelerating" | "growing" | "stable" | "declining",
  "supplyTrajectory": "constrained" | "tight" | "balanced" | "oversupplied",
  "capitalCyclePhase": "early" | "mid" | "late" | "downturn",
  "demandDrivers": ["<driver1>", "<driver2>", "<driver3>"],
  "supplyConstraints": ["<constraint1>", "<constraint2>", "<constraint3>"],
  "investmentSignal": "strong" | "moderate" | "weak" | "avoid"
}`;

  try {
    const raw = await runPrompt("thematic-analysis", prompt, { maxTokens: 700, json: true });
    return extractJson<Omit<SupplyDemandScore, "commodityProxies">>(raw);
  } catch {
    return { score: 5, demandTrajectory: "growing", supplyTrajectory: "balanced", capitalCyclePhase: "mid", demandDrivers: [], supplyConstraints: [], investmentSignal: "moderate" };
  }
}

async function scoreCommodityFramework(theme: string): Promise<CommodityFrameworkScore> {
  const prompt = `You are a commodity research analyst covering materials, mining, and natural resources. Analyse the commodity intensity of the theme "${theme}".

Assess:
1. Which 2-4 specific commodities are central to this theme
2. Demand catalysts driving commodity consumption
3. Supply risks (reserve concentration, permitting, environmental, geopolitical)
4. Substitution risk — can alternative materials replace these? How easily?
5. Recycling economics — does recycling create meaningful secondary supply?
6. Reserve concentration — where are reserves geographically concentrated?
7. Score 0–10 for commodity investment attractiveness: 10 = highly attractive (concentrated supply, no substitute, growing demand, poor recycling)

Return JSON only:
{
  "score": <0-10>,
  "primaryCommodities": ["<commodity1>", "<commodity2>"],
  "demandCatalysts": ["<catalyst1>", "<catalyst2>", "<catalyst3>"],
  "supplyRisks": ["<risk1>", "<risk2>", "<risk3>"],
  "substitutionRisk": "low" | "medium" | "high",
  "recyclingEconomics": "<1-2 sentences on recycling viability and current recovery rates>",
  "reserveConcentration": "<1-2 sentences on where reserves are concentrated and geopolitical implications>"
}`;

  try {
    const raw = await runPrompt("thematic-analysis", prompt, { maxTokens: 800, json: true });
    return extractJson<CommodityFrameworkScore>(raw);
  } catch {
    return { score: 5, primaryCommodities: [], demandCatalysts: [], supplyRisks: [], substitutionRisk: "medium", recyclingEconomics: "Analysis unavailable.", reserveConcentration: "Analysis unavailable." };
  }
}

async function scorePolicy(theme: string, liveNewsContext = ""): Promise<PolicyScore> {
  const newsSection = liveNewsContext
    ? `\nLIVE NEWS (scan of Yahoo Finance, Google News, Economic Times, Moneycontrol, NSE announcements):\n${liveNewsContext}\n`
    : "";
  const prompt = `You are a policy and geopolitical analyst. Evaluate government policy support for the theme "${theme}".${newsSection}

Assess:
1. 3-5 specific government policies, subsidies, or mandates globally supporting this theme
2. Direction of capital flows forced by these policies
3. Geopolitical factors (trade wars, resource nationalism, strategic alliances)
4. India-specific government schemes, PLI schemes, national missions, or regulations relevant to this theme
5. Score 0–10: 10 = strong tailwind (multiple governments spending trillions, mandatory timelines), 0 = no policy support

Return JSON only:
{
  "score": <0-10>,
  "relevantPolicies": [
    {
      "country": "<country>",
      "policy": "<specific policy name or description>",
      "impact": "highly positive" | "positive" | "neutral" | "negative",
      "estimatedCapitalUSD": "<e.g. '$500B IRA provisions' or null>"
    }
  ],
  "capitalFlowDirection": "<where is policy forcing capital — 1-2 sentences>",
  "geopoliticalFactors": ["<factor1>", "<factor2>"],
  "indiaSpecificPolicies": ["<policy1>", "<policy2>"]
}`;

  try {
    const raw = await runPrompt("thematic-analysis", prompt, { maxTokens: 1000, json: true });
    return extractJson<PolicyScore>(raw);
  } catch {
    return { score: 5, relevantPolicies: [], capitalFlowDirection: "Analysis unavailable.", geopoliticalFactors: [], indiaSpecificPolicies: [] };
  }
}

async function scoreGlobalStructuralAdvantage(theme: string): Promise<GlobalStructuralAdvantageScore> {
  const prompt = `You are a global macro investment analyst. Compare structural advantages across major regions for the theme "${theme}".

Candidate regions (assess only those genuinely relevant to this theme — omit the rest rather than forcing an entry):
United States, China, India, Europe, Japan, South Korea, Taiwan, Southeast Asia, Middle East, Latin America.

For each relevant region, identify its structural advantages (capital, talent, policy support, natural resources, supply-chain position, domestic market size, manufacturing base, etc.) and disadvantages (regulatory friction, talent gaps, capital constraints, infrastructure gaps, geopolitical exposure, etc.) for this theme specifically.

Then determine:
1. Which region currently leads in this theme, and why.
2. Which region is improving its position fastest (closing the gap), and why.
3. What this means for long-term investors over a 5-10 year horizon — which regions/companies benefit as this dynamic plays out.

Return JSON only:
{
  "score": <0-10 — how clear-cut and durable the global structural-advantage dynamics are for this theme>,
  "currentLeader": "<region name>",
  "fastestImproving": "<region name>",
  "regions": [
    { "region": "<region name>", "advantages": ["<advantage1>", "<advantage2>"], "disadvantages": ["<disadvantage1>", "<disadvantage2>"] }
  ],
  "longTermImplications": "<3-5 sentence synthesis of long-term investment implications>"
}

Include 3-6 regions, ranked by relevance to this theme.`;

  try {
    const raw = await runPrompt("thematic-analysis", prompt, { maxTokens: 1200, json: true });
    return extractJson<GlobalStructuralAdvantageScore>(raw);
  } catch {
    return {
      score: 5,
      currentLeader: "Unknown",
      fastestImproving: "Unknown",
      regions: [],
      longTermImplications: "Analysis unavailable.",
    };
  }
}

/* ──────────────────── Company mapping from screener DB ─────────────── */

async function mapCompaniesToTiers(
  theme: string,
  chain: DependencyNode[],
  dbCompanies: StockFundamentals[],
): Promise<TierCompany[]> {
  if (dbCompanies.length === 0) return [];

  // Build a compact listing of all companies to send to Claude
  const companyList = dbCompanies.slice(0, 300).map((c) =>
    `${c.symbol} | ${c.name} | ${c.sector ?? "n/a"} | ${c.industry ?? "n/a"}`
  ).join("\n");

  const chainSummary = chain.map((n) => `Tier ${n.tier} (${n.tierLabel}): ${n.description}`).join("\n");

  const prompt = `You are a thematic equity analyst. Given the dependency chain for "${theme}" and a list of companies, identify which companies belong to which tier.

DEPENDENCY CHAIN:
${chainSummary}

COMPANIES (symbol | name | sector | industry):
${companyList}

Select the 15–25 most relevant companies across all tiers. For each company:
1. Assign it to the most appropriate tier (1-6)
2. Rate its strategic importance: critical / high / medium / low
3. Identify the moat type: cost / scale / technology / distribution / regulation / none
4. Write a 1-sentence rationale for why it belongs in this tier

Return JSON only — an array:
[
  {
    "symbol": "<TICKER>",
    "tier": <1-6>,
    "strategicImportance": "critical" | "high" | "medium" | "low",
    "moatType": "cost" | "scale" | "technology" | "distribution" | "regulation" | "none",
    "relevanceRationale": "<1 sentence>"
  }
]`;

  try {
    const raw = await runPrompt("thematic-analysis", prompt, { maxTokens: 2000, json: true });
    const mappings = extractJson<{
      symbol: string;
      tier: 1 | 2 | 3 | 4 | 5 | 6;
      strategicImportance: "critical" | "high" | "medium" | "low";
      moatType: TierCompany["moatType"];
      relevanceRationale: string;
    }[]>(raw);

    const symMap = new Map(dbCompanies.map((c) => [c.symbol, c]));
    const tierLabels: Record<number, string> = {};
    for (const n of chain) tierLabels[n.tier] = n.tierLabel;

    const result: TierCompany[] = [];
    for (const m of mappings) {
      const fund = symMap.get(m.symbol);
      if (!fund) continue;
      result.push({
        tier: m.tier,
        tierLabel: tierLabels[m.tier] ?? `Tier ${m.tier}`,
        symbol: fund.symbol,
        name: fund.name,
        sector: fund.sector ?? null,
        industry: fund.industry ?? null,
        roic: fund.roic ?? null,
        grossMargin: fund.grossMargin ?? null,
        revenueGrowthYoY: fund.revenueGrowthYoY ?? null,
        debtToEquity: fund.debtToEquity ?? null,
        isIndia: fund.symbol.endsWith(".NS") || fund.symbol.endsWith(".BO"),
        relevanceRationale: m.relevanceRationale,
        qualityScore: null,
        strategicImportance: m.strategicImportance,
        moatType: m.moatType,
      });
    }
    return result;
  } catch {
    return [];
  }
}

/* ───────────────────── Opportunity score assembly ──────────────────── */

function computeOpportunityScore(
  futureState: FutureStateScore,
  bottleneck: BottleneckScore,
  supplyDemand: SupplyDemandScore,
  commodity: CommodityFrameworkScore,
  policy: PolicyScore,
  structuralAdvantage: GlobalStructuralAdvantageScore,
  tierCompanies: TierCompany[],
): OpportunityScore {
  // Weights from Part 10.5
  const inevitability = (futureState.inevitabilityScore / 10) * 100;
  const bottleneckNorm = (bottleneck.score / 10) * 100;
  const capitalCycleNorm = (supplyDemand.score / 10) * 100;
  const demandGrowthNorm = (commodity.score / 10) * 100;
  const policyNorm = (policy.score / 10) * 100;
  const subResistanceNorm = bottleneck.substituteRisk === "low" ? 100 : bottleneck.substituteRisk === "medium" ? 60 : 30;
  const structuralAdvantageNorm = (structuralAdvantage.score / 10) * 100;

  const themeScore = Math.round(
    inevitability * 0.20 +
    bottleneckNorm * 0.20 +
    capitalCycleNorm * 0.20 +
    demandGrowthNorm * 0.15 +
    policyNorm * 0.10 +
    subResistanceNorm * 0.10 +
    structuralAdvantageNorm * 0.05,
  );

  const verdict: OpportunityScore["verdict"] =
    themeScore >= 80 ? "exceptional" :
    themeScore >= 65 ? "strong" :
    themeScore >= 50 ? "moderate" :
    themeScore >= 35 ? "weak" : "avoid";

  const verdictRationale =
    `Theme scores ${themeScore}/100 (${verdict.toUpperCase()}). ` +
    `Inevitability: ${inevitability.toFixed(0)}/100, Bottleneck: ${bottleneckNorm.toFixed(0)}/100, ` +
    `Capital cycle: ${capitalCycleNorm.toFixed(0)}/100, Policy: ${policyNorm.toFixed(0)}/100.`;

  // Top 5 companies: prioritise critical/high strategic importance + lowest D/E + highest ROIC
  const topCompanies = [...tierCompanies]
    .sort((a, b) => {
      const impScore = { critical: 4, high: 3, medium: 2, low: 1 };
      const aScore = (impScore[a.strategicImportance] ?? 0) * 3 + (a.roic ?? 0) * 0.05 - (a.debtToEquity ?? 3) * 0.1;
      const bScore = (impScore[b.strategicImportance] ?? 0) * 3 + (b.roic ?? 0) * 0.05 - (b.debtToEquity ?? 3) * 0.1;
      return bScore - aScore;
    })
    .slice(0, 5);

  const checklist: AnalystChecklistItem[] = [
    {
      question: "What future state is becoming inevitable?",
      answer: `${futureState.drivingForces.join("; ")}. Score: ${futureState.inevitabilityScore}/10.`,
      signal: futureState.inevitabilityScore >= 7 ? "positive" : futureState.inevitabilityScore >= 5 ? "neutral" : "negative",
    },
    {
      question: "What cannot this future function without?",
      answer: supplyDemand.supplyConstraints.join("; ") || "See supply constraints.",
      signal: supplyDemand.supplyTrajectory === "constrained" ? "positive" : "neutral",
    },
    {
      question: "Who controls the bottleneck?",
      answer: bottleneck.bottleneckDescription,
      signal: bottleneck.score >= 7 ? "positive" : bottleneck.score >= 5 ? "neutral" : "negative",
    },
    {
      question: "Can the bottleneck be substituted?",
      answer: bottleneck.substituteRationale || `Substitute risk: ${bottleneck.substituteRisk}`,
      signal: bottleneck.substituteRisk === "low" ? "positive" : bottleneck.substituteRisk === "medium" ? "neutral" : "negative",
    },
    {
      question: "Is demand rising faster than supply can respond?",
      answer: `Demand: ${supplyDemand.demandTrajectory}, Supply: ${supplyDemand.supplyTrajectory}, Cycle phase: ${supplyDemand.capitalCyclePhase}`,
      signal: supplyDemand.investmentSignal === "strong" ? "positive" : supplyDemand.investmentSignal === "avoid" ? "negative" : "neutral",
    },
    {
      question: "Is policy forcing capital into this theme?",
      answer: policy.capitalFlowDirection,
      signal: policy.score >= 7 ? "positive" : policy.score >= 5 ? "neutral" : "negative",
    },
    {
      question: "Which region holds the structural advantage, and is it shifting?",
      answer: `${structuralAdvantage.currentLeader} currently leads; ${structuralAdvantage.fastestImproving} is closing the gap fastest. ${structuralAdvantage.longTermImplications}`,
      signal: structuralAdvantage.score >= 7 ? "positive" : structuralAdvantage.score >= 5 ? "neutral" : "negative",
    },
    {
      question: "Are reserve/supply concentrations creating geopolitical risk?",
      answer: commodity.reserveConcentration,
      signal: "neutral",
    },
    {
      question: "Is recycling creating a meaningful substitute supply stream?",
      answer: commodity.recyclingEconomics,
      signal: "neutral",
    },
    {
      question: "Is the market underestimating the dependency?",
      answer: `${topCompanies.length} companies identified across tiers; ${tierCompanies.filter((c) => c.strategicImportance === "critical").length} critical-tier companies in screener universe.`,
      signal: tierCompanies.filter((c) => c.tier >= 3 && c.strategicImportance === "critical").length > 0 ? "positive" : "neutral",
    },
  ];

  return {
    themeScore,
    themeBreakdown: {
      inevitability: Math.round(inevitability),
      bottleneck: Math.round(bottleneckNorm),
      capitalCycle: Math.round(capitalCycleNorm),
      demandGrowth: Math.round(demandGrowthNorm),
      policy: Math.round(policyNorm),
      substitutionResistance: Math.round(subResistanceNorm),
      structuralAdvantage: Math.round(structuralAdvantageNorm),
    },
    topCompanies,
    verdict,
    verdictRationale,
    analystChecklist: checklist,
  };
}

/* ─────────────────────── Main orchestrator ─────────────────────────── */

export async function runThematicEngine(
  input: ThematicReportInput,
  onProgress?: (event: ThematicProgressEvent) => void,
): Promise<ThematicReport> {
  const emit = (stage: ThematicStage, message: string, data?: unknown) => {
    onProgress?.({ stage, message, data });
  };

  const { theme } = input;

  emit("future_state", `Scoring inevitability of "${theme}"…`);
  const futureState = await scoreFutureState(theme);
  emit("future_state", `Inevitability: ${futureState.inevitabilityScore}/10`, futureState);

  emit("dependency_chain", "Mapping dependency chain across 6 tiers…");
  const chain = await buildDependencyChain(theme);
  emit("dependency_chain", `${chain.length} tiers mapped`, chain);

  emit("bottleneck", "Identifying and scoring the bottleneck…");
  const bottleneck = await scoreBottleneck(theme, chain);
  emit("bottleneck", `Bottleneck score: ${bottleneck.score}/10 (Tier ${bottleneck.bottleneckTier})`, bottleneck);

  emit("supply_demand", "Fetching commodity proxies and scoring supply/demand cycle…");
  const proxyDefs = pickCommodityProxies(theme);
  const [proxies, sdScoreRaw] = await Promise.all([
    fetchCommodityProxies(proxyDefs),
    scoreSupplyDemand(theme, [] as CommodityProxy[]),
  ]);
  // Re-run supply/demand with live proxy data
  const sdScoreWithData = await scoreSupplyDemand(theme, proxies);
  const supplyDemand: SupplyDemandScore = { ...sdScoreWithData, commodityProxies: proxies };
  void sdScoreRaw; // discard the first run
  emit("supply_demand", `Demand: ${supplyDemand.demandTrajectory}, Supply: ${supplyDemand.supplyTrajectory}, Cycle: ${supplyDemand.capitalCyclePhase}`, supplyDemand);

  emit("commodity", "Running commodity framework analysis…");
  const commodityFramework = await scoreCommodityFramework(theme);
  emit("commodity", `Commodity score: ${commodityFramework.score}/10`, commodityFramework);

  emit("policy", "Scanning news sources and evaluating policy/geopolitical overlay…");
  // Fetch live news for this theme from all sources: Yahoo Finance, Google News, ET, NSE, Moneycontrol, NewsAPI
  const newsItems = await fetchMarketNews({ query: theme, india: true, global: true, limit: 40 }).catch(() => [] as NewsItem[]);
  const newsSummary = newsItems.slice(0, 20).map((n) => `• [${n.source}] ${n.headline}`).join("\n");
  const policy = await scorePolicy(theme, newsSummary);
  emit("policy", `Policy score: ${policy.score}/10 (${newsItems.length} news articles scanned)`, policy);

  emit("global_structural_advantage", "Comparing structural advantages across regions…");
  const structuralAdvantage = await scoreGlobalStructuralAdvantage(theme);
  emit(
    "global_structural_advantage",
    `Structural advantage score: ${structuralAdvantage.score}/10 (leader: ${structuralAdvantage.currentLeader})`,
    structuralAdvantage,
  );

  emit("company_mapping", "Loading screener universe and mapping companies to tiers…");
  const { rows: dbRows } = getFreshFundamentals(7 * 24 * 60 * 60 * 1000); // 7-day cache
  const tierCompanies = await mapCompaniesToTiers(theme, chain, dbRows);
  emit("company_mapping", `${tierCompanies.length} companies mapped across ${new Set(tierCompanies.map((c) => c.tier)).size} tiers`, tierCompanies);

  emit("opportunity_score", "Computing final opportunity score…");
  const opportunity = computeOpportunityScore(futureState, bottleneck, supplyDemand, commodityFramework, policy, structuralAdvantage, tierCompanies);
  emit("opportunity_score", `Theme score: ${opportunity.themeScore}/100 (${opportunity.verdict.toUpperCase()})`, opportunity);

  const report: ThematicReport = {
    theme,
    generatedAt: new Date().toISOString(),
    model: (await pickModel("thematic-analysis")) ?? "unavailable",
    futureState,
    dependencyChain: chain,
    bottleneck,
    supplyDemand,
    commodityFramework,
    policy,
    structuralAdvantage,
    tierCompanies,
    opportunity,
    newsItems,
  };

  emit("done", "Thematic report complete", report);
  return report;
}
