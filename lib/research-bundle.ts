/**
 * The research data plan — declared once, orchestrated by the platform.
 *
 * This replaces the four-stage waterfall the research page used to run:
 *
 *   BEFORE (4 serial stages, ~all of them blocking the next):
 *     1. /api/research: await getQuote()               ← blocks everything
 *     2. /api/research: Promise.all([history, spy, profile, filings, news])
 *     3. /api/research: await sectorEtfHistory         ← needs profile.sector
 *     4. …only NOW can the client start /api/fundamentals, /api/peers,
 *        /api/ai/verdict, and the rest — they all key off `quote`
 *     5. /api/sector-rotation waits on /api/fundamentals for the sector
 *
 *   AFTER (1 stage; only genuine dependencies are ordered):
 *     quote, history, benchmarkHistory, profile, filings, news, fundamentals
 *       → all start at t=0, concurrently
 *     sectorHistory  → waits on profile (it needs profile.sector to pick the ETF)
 *     peers          → waits on fundamentals (needs the sector)
 *     sectorRotation → waits on fundamentals (needs the sector)
 *
 * The two real dependency chains are preserved exactly. Nothing else waits on
 * anything. No dataset was dropped, no calculation skipped — the same work is
 * performed, just not one-at-a-time.
 */

import { getHistory, getQuote, getQuoteSummary, getSectorEtf } from "./yahoo";
import { benchmarkForSymbol, indiaSectorIndex } from "./benchmarks";
import { getRecentFilings } from "./edgar";
import { getIndianFilings, isIndianEquitySymbol } from "./india-news";
import { getCompanyNews } from "./news";
import { getPeerComparison } from "./peers";
import { buildFundamentalsData } from "./fundamentals-data";
import { sectorRotationEntryFor, getLatestSectorRotation } from "./sector-rotation";
import { runPlan, stepError, stepValue } from "./platform/orchestrator";
import type { PlanStep } from "./platform/types";
import type {
  Filing,
  FundamentalsData,
  HistoryPoint,
  NewsItem,
  PeerComparison,
  Quote,
  SectorRotationEntry,
} from "./types";

/** The full research payload. Any field may be null — a failed section degrades, it doesn't fail the page. */
export interface ResearchBundle {
  quote: Quote;
  history: HistoryPoint[];
  benchmarks: {
    /** Market benchmark history — SPY for US listings, NIFTY 50 for NSE/BSE. */
    market: HistoryPoint[];
    /** Display label for the market benchmark series ("S&P 500", "NIFTY 50"). */
    marketLabel: string;
    /** Sector benchmark series label (US: ETF ticker; India: NIFTY sector index). */
    sectorEtf: string | null;
    sector: HistoryPoint[];
  };
  filings: Filing[];
  edgarError: string | null;
  news: NewsItem[];
  fundamentals: FundamentalsData | null;
  fundamentalsError: string | null;
  peers: PeerComparison | null;
  sectorRotation: SectorRotationEntry | null;
  /** Per-section timing + status, for the perf overlay and honest error messaging. */
  diagnostics: {
    durationMs: number;
    partial: boolean;
    steps: Record<string, { status: string; durationMs: number; error: string | null }>;
  };
}

const HISTORY_DAYS = 1825; // 5 years — unchanged from the previous implementation.

/**
 * Build the step graph. Exported separately from `buildResearchBundle` so other
 * modules (compare, portfolio) can compose the same steps into their own plans
 * instead of re-deriving them.
 */
export function researchPlan(symbol: string, opts: { isEquity: boolean }): PlanStep[] {
  const steps: PlanStep[] = [
    // The quote is the one hard requirement: without it there is no asset.
    // It is `required`, but it does NOT block anything else — everything below
    // starts at the same instant.
    { id: "quote", required: true, retries: 1, run: () => getQuote(symbol) },

    {
      id: "history",
      run: async () => {
        const h = await getHistory(symbol, HISTORY_DAYS);
        // Yahoo's chart API returns near-empty history for many .BO (BSE)
        // listings — observed live: RELIANCE.BO = 2 bars vs 1,238 for .NS.
        // Virtually every researched BSE name is dual-listed; the NSE series
        // is the same security, so fall back rather than render a dead chart.
        if (/\.BO$/i.test(symbol) && h.length < 30) {
          const ns = await getHistory(symbol.replace(/\.BO$/i, ".NS"), HISTORY_DAYS).catch(() => [] as HistoryPoint[]);
          if (ns.length > h.length) return ns;
        }
        return h;
      },
    },
    // Market benchmark is market-aware: NIFTY 50 for NSE/BSE listings, SPY for
    // US — an Indian stock must never be silently compared to the S&P 500.
    { id: "benchmarkHistory", run: () => getHistory(benchmarkForSymbol(symbol).symbol, HISTORY_DAYS) },
    {
      id: "profile",
      run: () => getQuoteSummary(symbol, ["assetProfile"]),
    },

    // A REAL dependency: we cannot know which sector benchmark to use until
    // the profile tells us the sector. This is the kind of ordering that
    // must be preserved — parallelising it wouldn't be faster, it'd be wrong.
    {
      id: "sectorHistory",
      dependsOn: ["profile"],
      timeoutMs: 8000,
      run: async (deps) => {
        const sector = readSector(deps.profile);
        if (isIndianEquitySymbol(symbol)) {
          const idx = indiaSectorIndex(sector);
          if (!idx) return { etf: null, history: [] as HistoryPoint[] };
          return { etf: idx.label, history: await getHistory(idx.symbol, HISTORY_DAYS) };
        }
        const etf = getSectorEtf(sector);
        if (!etf) return { etf: null, history: [] as HistoryPoint[] };
        return { etf, history: await getHistory(etf, HISTORY_DAYS) };
      },
    },

    // Indian listings file with the NSE, not the SEC — same Filing shape,
    // different exchange (lib/india-news.ts).
    {
      id: "filings",
      retries: 1,
      run: () => (isIndianEquitySymbol(symbol) ? getIndianFilings(symbol) : getRecentFilings(symbol)),
    },
    { id: "news", run: () => getCompanyNews(symbol, 8) },
  ];

  if (opts.isEquity) {
    steps.push(
      { id: "fundamentals", timeoutMs: 25_000, run: () => buildFundamentalsData(symbol) },

      // Both of these genuinely need the sector, which only fundamentals knows.
      // Indian listings skip the US peer engine: getPeerComparison benchmarks
      // against S&P 500 sector medians, which is a meaningless comparison for
      // an NSE name — its peer set comes from screener.in (RankedPeers).
      {
        id: "peers",
        dependsOn: ["fundamentals"],
        timeoutMs: 25_000,
        run: () => (isIndianEquitySymbol(symbol) ? Promise.resolve(null) : getPeerComparison(symbol)),
      },
      {
        id: "sectorRotation",
        dependsOn: ["fundamentals"],
        run: async (deps) => {
          const sector = (deps.fundamentals as FundamentalsData | null)?.snapshot?.sector;
          if (!sector) return null;
          // Null for non-US listings: the snapshot measures US SPDR ETFs.
          return sectorRotationEntryFor(symbol, getLatestSectorRotation(), sector);
        },
      },
    );
  }

  return steps;
}

/** Yahoo's assetProfile module, defensively unwrapped. */
function readSector(profile: unknown): string | null {
  if (profile == null || typeof profile !== "object") return null;
  const assetProfile = (profile as Record<string, unknown>).assetProfile;
  if (assetProfile == null || typeof assetProfile !== "object") return null;
  const sector = (assetProfile as Record<string, unknown>).sector;
  return typeof sector === "string" ? sector : null;
}

/**
 * Run the research plan and assemble the bundle.
 *
 * Rejects only when the quote fails (there is no page to render). Every other
 * failure surfaces as a null field plus an error string, so the UI can say
 * "News unavailable" in one card while the other eleven render normally.
 */
export async function buildResearchBundle(
  symbol: string,
  opts: { isEquity: boolean; signal?: AbortSignal },
): Promise<ResearchBundle> {
  const plan = await runPlan(researchPlan(symbol, { isEquity: opts.isEquity }), {
    concurrency: 8,
    signal: opts.signal,
  });

  const sectorStep = stepValue<{ etf: string | null; history: HistoryPoint[] }>(plan, "sectorHistory");

  const diagnostics: ResearchBundle["diagnostics"] = {
    durationMs: plan.durationMs,
    partial: plan.partial,
    steps: Object.fromEntries(
      Object.entries(plan.steps).map(([id, r]) => [
        id,
        { status: r.status, durationMs: r.durationMs, error: r.error },
      ]),
    ),
  };

  return {
    // `required: true` guarantees runPlan threw rather than reaching here with a null quote.
    quote: stepValue<Quote>(plan, "quote") as Quote,
    history: stepValue<HistoryPoint[]>(plan, "history") ?? [],
    benchmarks: {
      market: stepValue<HistoryPoint[]>(plan, "benchmarkHistory") ?? [],
      marketLabel: benchmarkForSymbol(symbol).label,
      sectorEtf: sectorStep?.etf ?? null,
      sector: sectorStep?.history ?? [],
    },
    filings: stepValue<Filing[]>(plan, "filings") ?? [],
    edgarError: stepError(plan, "filings"),
    news: stepValue<NewsItem[]>(plan, "news") ?? [],
    fundamentals: stepValue<FundamentalsData>(plan, "fundamentals"),
    fundamentalsError: stepError(plan, "fundamentals"),
    peers: stepValue<PeerComparison>(plan, "peers"),
    sectorRotation: stepValue<SectorRotationEntry>(plan, "sectorRotation"),
    diagnostics,
  };
}
