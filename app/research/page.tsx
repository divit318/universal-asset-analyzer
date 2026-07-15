"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TrendingUp, TrendingDown, Clock3, Network, Link2, Bookmark } from "lucide-react";
import type {
  Filing,
  FundamentalsData,
  FundProfileData,
  HistoryPoint,
  ManualAsset,
  MovementExplanation,
  NewsItem,
  PeerComparison,
  Quote,
  ResearchData,
  ScoreResult,
  SectorRotationEntry,
  TimelineEvent,
} from "@/lib/types";
import type { InvestmentVerdict } from "@/app/api/ai/verdict/route";
import type { ChartQARelatedTarget } from "@/lib/ai-chart-qa";
import type { ScreenerInCompany, ScreenerInPeer } from "@/lib/screener-in";
import { detectMarket, MARKET_BADGE, MARKET_LABEL, type MarketRegion } from "@/lib/market";
import { detectAssetClass } from "@/lib/asset-class";
import { useResearchBundle } from "@/lib/platform/client/use-research-bundle";
import { useDataset, useDatasetValue } from "@/lib/platform/client/use-dataset";
import { useRecordActivity } from "@/app/_home/use-record-activity";
import {
  formatCompact,
  formatCurrency,
  formatDate,
  formatMarketCap,
  formatNumber,
  formatPercent,
} from "@/lib/format";

// Universal components
import { DownloadIcon } from "./_components/download-icon";
import { SymbolSearch } from "@/app/_components/symbol-search";
import { ResearchCopilot } from "./_components/copilot/research-copilot";
import type { AskAIPayload } from "./_components/pattern-analysis-panel";
import { RESEARCH_ACTIONS } from "@/lib/ai/actions";
import { ResearchNotes } from "./_components/research-notes";
import { DecisionHero } from "./_components/decision-hero";
import { MovementExplainerCard } from "@/app/_components/movement-explainer-card";
import { ConvictionBreakdown } from "./_components/conviction-breakdown";
import { WhySection } from "./_components/why-section";
import { InvestmentPersonalityBadge } from "./_components/investment-personality-badge";
import { ResearchConfidenceMeter } from "./_components/research-confidence-meter";
import { MacroContextLadder } from "./_components/macro-context-ladder";
import { WhyNowCard } from "./_components/why-now-card";
import { SectorContextCard } from "./_components/sector-context-card";
import { PortfolioDecisionCard } from "./_components/portfolio-decision-card";
import { WatchlistIntelligenceCard } from "./_components/watchlist-intelligence-card";
import { FinancialInsightCard } from "./_components/financial-insight-card";
import { PeerCompetitivePosition } from "./_components/peer-competitive-position";
import { ArrivalHighlight, useArrivalTarget } from "@/app/_components/arrival-highlight";
import { TimelinePreviewCard } from "./_components/timeline-preview-card";
import { GraphPreviewCard } from "./_components/graph-preview-card";
import { RelatedOpportunitiesCard } from "./_components/related-opportunities-card";

// Fundamentals sub-components (US / global equity)
import { ScoreCard } from "./_components/score-card";
import { RiskHeatmap } from "./_components/risk-heatmap";
import { AnalystCard } from "./_components/analyst-card";
import { InsiderTable } from "./_components/insider-table";
import { OwnershipCard } from "./_components/ownership-card";

// India-specific components (conditionally rendered)
import { computeIndiaSnapshot } from "@/lib/india-snapshot";
import { InvestmentSnapshot } from "./india/_components/investment-snapshot";
import { RatioSparklines } from "./india/_components/ratio-sparklines";
import { RankedPeers } from "./india/_components/ranked-peers";
import { AiSectionInsight } from "./india/_components/ai-section-insight";

// Fund-specific components (conditionally rendered) — Research Hub Phase 1
import { FundScoreCard } from "./fund/_components/fund-score-card";
import { HoldingsTable } from "@/app/_components/holdings-table";
import { FundProfileCard } from "./fund/_components/fund-profile-card";
import { AiFundInsight } from "./fund/_components/ai-fund-insight";

// Crypto-specific components (conditionally rendered) — Research Hub Phase 2
import { CryptoScoreCard } from "./crypto/_components/crypto-score-card";
import { RiskProfileCard } from "@/app/_components/risk-profile-card";
import { AiCryptoInsight } from "./crypto/_components/ai-crypto-insight";

// Commodity-specific components (conditionally rendered) — Research Hub Phase 3
import { CommodityScoreCard } from "./commodity/_components/commodity-score-card";
import { AiCommodityInsight } from "./commodity/_components/ai-commodity-insight";

// Forex-specific components (conditionally rendered) — Research Hub Phase 4
import { ForexScoreCard } from "./forex/_components/forex-score-card";
import { AiForexInsight } from "./forex/_components/ai-forex-insight";

// Derivatives module (Research Hub Phase 5) — additive on equity/fund
// underlyings, not a distinct detected asset class (see lib/derivatives-analysis.ts).
import { DerivativesSummaryCard } from "./derivatives/_components/derivatives-summary-card";
import { AiDerivativesInsight } from "./derivatives/_components/ai-derivatives-insight";
import type { DerivativesSummary } from "@/lib/derivatives-analysis";

// Macro-specific components (conditionally rendered) — Research Hub Phase 6.
// No score card: a yield curve has no BUY/SELL call (see lib/macro-analysis.ts).
import { YieldCurveCard } from "./macro/_components/yield-curve-card";
import { AiMacroInsight } from "./macro/_components/ai-macro-insight";
import type { MacroSummary } from "@/lib/macro-analysis";

import { useToast } from "@/app/_components/toast";
import { useIOSSafe } from "@/lib/ios-context";
import { PortfolioFitPanel } from "@/app/_components/portfolio-fit-panel";
import { PositionActionCard } from "./_components/position-action-card";
import { CollapsibleSection } from "@/app/_components/collapsible-section";
import { PageShell, PageHeader, Card, Button, Input, Tabs, type TabItem } from "@/app/_components/ui";

// The interactive price chart bundles the candlestick pattern engine — the
// single heaviest component on this page. Load it lazily so the researched
// symbol's text data paints without waiting on that chunk.
const InteractiveChart = dynamic(
  () => import("./_components/interactive-chart").then((m) => m.InteractiveChart),
  {
    ssr: false,
    loading: () => (
      <div className="h-[420px] w-full animate-pulse rounded-card border border-border bg-surface-2" />
    ),
  },
);

// Fixed-height placeholder for lazily-loaded recharts sections below —
// matches each real component's rendered height so mounting in doesn't
// shift layout or measure a 0x0 ResponsiveContainer.
function ChartSkeleton({ h }: { h: string }) {
  return <div className={`${h} w-full animate-pulse rounded-card border border-border bg-surface-2`} />;
}

// Five more recharts-bearing chains, deferred so recharts (and the
// India-only chart bundle) never load on the common US-stock path.
const EarningsCard = dynamic(
  () => import("./_components/earnings-card").then((m) => m.EarningsCard),
  { ssr: false, loading: () => <ChartSkeleton h="h-[380px]" /> },
);
const ValuationHistoryChart = dynamic(
  () => import("./_components/valuation-history-chart").then((m) => m.ValuationHistoryChart),
  { ssr: false, loading: () => <ChartSkeleton h="h-[320px]" /> },
);
const MarginTrendChart = dynamic(
  () => import("./_components/charts").then((m) => m.MarginTrendChart),
  { ssr: false, loading: () => <ChartSkeleton h="h-[296px]" /> },
);
const RevenueFcfChart = dynamic(
  () => import("./_components/charts").then((m) => m.RevenueFcfChart),
  { ssr: false, loading: () => <ChartSkeleton h="h-[296px]" /> },
);
const PeerRadarChart = dynamic(
  () => import("./_components/charts").then((m) => m.PeerRadarChart),
  { ssr: false, loading: () => <ChartSkeleton h="h-[296px]" /> },
);
const OwnershipTimeline = dynamic(
  () => import("./india/_components/ownership-timeline").then((m) => m.OwnershipTimeline),
  { ssr: false, loading: () => <ChartSkeleton h="h-[560px]" /> },
);
const AnnualRevenueChart = dynamic(
  () => import("./india/_components/financial-charts").then((m) => m.AnnualRevenueChart),
  { ssr: false, loading: () => <ChartSkeleton h="h-[320px]" /> },
);
const AnnualMarginChart = dynamic(
  () => import("./india/_components/financial-charts").then((m) => m.AnnualMarginChart),
  { ssr: false, loading: () => <ChartSkeleton h="h-[240px]" /> },
);
const QuarterlyRevenueChart = dynamic(
  () => import("./india/_components/financial-charts").then((m) => m.QuarterlyRevenueChart),
  { ssr: false, loading: () => <ChartSkeleton h="h-[280px]" /> },
);
const QuarterlyProfitChart = dynamic(
  () => import("./india/_components/financial-charts").then((m) => m.QuarterlyProfitChart),
  { ssr: false, loading: () => <ChartSkeleton h="h-[300px]" /> },
);
const QuarterlySummaryStats = dynamic(
  () => import("./india/_components/financial-charts").then((m) => m.QuarterlySummaryStats),
  { ssr: false, loading: () => <ChartSkeleton h="h-[100px]" /> },
);
const SectorAllocationChart = dynamic(
  () => import("./fund/_components/sector-allocation-chart").then((m) => m.SectorAllocationChart),
  { ssr: false, loading: () => <ChartSkeleton h="h-[240px]" /> },
);
const FundPerformanceCard = dynamic(
  () => import("./fund/_components/fund-performance-card").then((m) => m.FundPerformanceCard),
  { ssr: false, loading: () => <ChartSkeleton h="h-[200px]" /> },
);
const RelativeStrengthChart = dynamic(
  () => import("@/app/_components/relative-strength-chart").then((m) => m.RelativeStrengthChart),
  { ssr: false, loading: () => <ChartSkeleton h="h-[240px]" /> },
);

/* -------------------------------------------------------------------------- */
/* Types                                                                       */
/* -------------------------------------------------------------------------- */

type Tab = "conviction" | "analysis" | "financials" | "ownership" | "details";

interface IndiaDerivedData {
  promoterHolding: number | null;
  fiiHolding: number | null;
  diiHolding: number | null;
  evToEbitda: number | null;
  priceToSales: number | null;
  priceToBook: number | null;
  debtToEquity: number | null;
  interestCoverage: number | null;
  peers: ScreenerInPeer[];
}

interface IndiaData {
  company: ScreenerInCompany;
  quote: Quote | null;
  derived: IndiaDerivedData;
}

/* -------------------------------------------------------------------------- */
/* Shared constants                                                            */
/* -------------------------------------------------------------------------- */

// Two representative tickers per searchable asset class (Derivatives and
// Manual Assets aren't searched directly, so they're not represented here —
// see the asset-class cards below instead). Equities stays at one pick each
// from US, India, and Japan to show off global market coverage, rather than
// doubling up within a single geography.
const QUICK_SYMBOLS = [
  "AAPL",        // Equities — US
  "RELIANCE.NS", // Equities — India
  "7203.T",      // Equities — Japan
  "SPY",         // Funds
  "QQQ",         // Funds
  "BTC-USD",     // Crypto
  "ETH-USD",     // Crypto
  "GC=F",        // Commodities — Gold
  "CL=F",        // Commodities — Crude Oil
  "EURUSD=X",    // Forex
  "USDJPY=X",    // Forex
  "^TNX",        // Fixed Income & Macro — 10-Year
  "^TYX",        // Fixed Income & Macro — 30-Year
];

const FEATURE_CARDS = [
  { title: "Equities",              desc: "Global stocks across US, India, Japan, Europe & more. AI verdict, conviction breakdown, 5-year technical chart, SEC filings & insider activity, plus India-specific promoter/FII-DII ownership." },
  { title: "Funds",                 desc: "ETFs, mutual funds & closed-end funds: holdings, sector allocation, expense ratio, and performance vs. category." },
  { title: "Crypto",                desc: "Digital assets: momentum, relative strength vs. Bitcoin, risk-adjusted return, and drawdown." },
  { title: "Commodities",           desc: "Futures & commodity ETFs: momentum vs. a commodity index, and news-grounded supply/demand context." },
  { title: "Forex",                 desc: "Currency pairs: momentum vs. the Dollar Index, risk-adjusted return, and macro context." },
  { title: "Fixed Income & Macro",  desc: "US Treasury yield curve — shape, trend, and inversion risk — with news-grounded inflation/GDP/employment context." },
  { title: "Derivatives",           desc: "Options chain analysis on any equity or fund — implied volatility, term structure, open interest, and Greeks. Found under a stock's Details tab, not searched directly." },
  { title: "Manual Assets",         desc: "Real estate, private markets, alternatives & structured products — no ticker required. Computed metrics (cap rate, MOIC, payoff scenarios) plus AI insight. See below." },
];

/* -------------------------------------------------------------------------- */
/* Reusable section header                                                     */
/* -------------------------------------------------------------------------- */

function SectionDivider({ title }: { title: string }) {
  return (
    <div className="flex items-center gap-3">
      <h2 className="text-label font-semibold uppercase tracking-widest text-muted">{title}</h2>
      <div className="h-px flex-1 bg-border" />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Tab navigation                                                              */
/* -------------------------------------------------------------------------- */

const TABS: TabItem<Tab>[] = [
  { id: "conviction", label: "Conviction"  },
  { id: "analysis",   label: "Analysis"    },
  { id: "financials", label: "Financials"  },
  { id: "ownership",  label: "Ownership"   },
  { id: "details",    label: "Details"     },
];

function TabNav({ active, onChange }: { active: Tab; onChange: (t: Tab) => void }) {
  return <Tabs tabs={TABS} active={active} onChange={onChange} layoutId="research-tabs-underline" />;
}

/* -------------------------------------------------------------------------- */
/* Loading skeleton (shared)                                                   */
/* -------------------------------------------------------------------------- */

function LoadingSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <div className="h-20 animate-pulse rounded-xl bg-surface" />
      <div className="h-48 animate-pulse rounded-xl bg-surface" />
      <div className="h-32 animate-pulse rounded-xl bg-surface" />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Research workspace (the full data view)                                    */
/* -------------------------------------------------------------------------- */

function ResearchWorkspace({
  data,
  onSave,
  saved,
  onCopyLink,
}: {
  data: ResearchData;
  onSave: () => void;
  saved: boolean;
  onCopyLink: () => void;
}) {
  const { quote, history, filings, edgarError, benchmarks, news } = data;
  const market: MarketRegion = detectMarket(quote);
  const isEquity = !quote.assetType || quote.assetType === "EQUITY";
  const isIndia = market === "IN";
  const isFund = detectAssetClass(quote) === "fund";
  const isCrypto = detectAssetClass(quote) === "crypto";
  const isCommodity = detectAssetClass(quote) === "commodity";
  const isForex = detectAssetClass(quote) === "forex";
  const isMacro = detectAssetClass(quote) === "macro";
  const positive = quote.changePercent >= 0;

  // Tab state
  const [tab, setTab] = useState<Tab>("conviction");

  // AI verdict (auto-fetched, drives hero + analysis tab)
  const [verdict, setVerdict] = useState<InvestmentVerdict | null>(null);
  const [verdictLoading, setVerdictLoading] = useState(true);

  // Fundamentals, peers, and sector rotation are delivered by the orchestrated
  // research bundle and read straight from the platform store. They used to be
  // three more client fetches that could not even *start* until /api/research
  // had fully resolved — and /api/peers and /api/sector-rotation then re-fetched
  // the quote, history, and statements that /api/research had just fetched.
  //
  // Each subscribes to its own store key, so when peers finally lands (it fans
  // out across the whole sector and is always last) only the peer card
  // re-renders — not the chart, not the financials, not the AI panel.
  const fundamentalsEntry = useDatasetValue<FundamentalsData>("fundamentals", quote.symbol);
  const peersEntry = useDatasetValue<PeerComparison>("peers", quote.symbol);
  const sectorRotationStoreEntry = useDatasetValue<SectorRotationEntry | null>("sectorRotation", quote.symbol);

  const fundamentals = fundamentalsEntry.data;
  const peers = peersEntry.data;
  const sectorRotationEntry = sectorRotationStoreEntry.data ?? null;
  const fundsLoading = fundamentalsEntry.status === "loading";
  const fundsError = fundamentalsEntry.error;

  // Movement Explainer result, lifted up so WhyNowCard can reuse the top
  // driver without a second fetch.
  const [movementExplanation, setMovementExplanation] = useState<MovementExplanation | null>(null);

  // A question queued by the candlestick chart's "Ask AI" / "Technical
  // Analysis" quick actions — consumed once by ResearchCopilot's own
  // useEffect, which auto-sends it and clears this back to null.
  const [pendingCopilotAsk, setPendingCopilotAsk] = useState<AskAIPayload | null>(null);
  const copilotSectionRef = useRef<HTMLDivElement>(null);

  const handleChartAskAI = useCallback((payload: AskAIPayload) => {
    setTab("details");
    setPendingCopilotAsk(payload);
    requestAnimationFrame(() =>
      copilotSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
    );
  }, [setTab, setPendingCopilotAsk]);

  const handleOpenTechnical = useCallback(() => {
    const action = RESEARCH_ACTIONS.find((a) => a.id === "technical");
    if (!action) return;
    handleChartAskAI({ question: action.instruction, action: action.id, label: action.label });
  }, [handleChartAskAI]);

  // The fullscreen AI dock's "Related Context" navigation — "earnings"/"analysis"
  // just switch tabs (both already render at the top of their content, so no
  // scroll target is needed there); "copilot" reuses handleChartAskAI exactly,
  // since that's the same "ask a question and jump to the Details tab" mechanism.
  const handleChartNavigate = useCallback(
    (target: ChartQARelatedTarget, payload?: AskAIPayload) => {
      if (target === "copilot" && payload) {
        handleChartAskAI(payload);
        return;
      }
      setTab(target === "earnings" ? "financials" : "analysis");
    },
    [handleChartAskAI, setTab],
  );

  // Most recent Timeline milestone, populated once TimelinePreviewCard (Details
  // tab) has loaded — lets WhyNowCard cite it without a second fetch.
  const [nearestTimelineEvent, setNearestTimelineEvent] = useState<TimelineEvent | null>(null);

  // India / fund / crypto / commodity / forex / derivatives / macro data is
  // fetched below via `useDataset` — see the block after the verdict effect.

  const [downloading, setDownloading] = useState(false);

  // IOS — portfolio fit
  const ios = useIOSSafe();
  const portfolioFit = ios && fundamentals
    ? ios.getPortfolioFit({
        symbol: quote.symbol,
        sector: fundamentals.snapshot?.sector ?? null,
        marketCap: quote.marketCap,
        scoreResult: fundamentals.score ?? null,
        dividendYield: fundamentals.snapshot?.dividendYield != null
          ? fundamentals.snapshot.dividendYield * 100
          : null,
        geography: market as "US" | "IN" | "JP" | "HK" | "AU" | "EU" | "CRYPTO",
        isOnWatchlist: false,
      })
    : null;

  // Portfolio Decision Engine — reuses PortfolioReport.recommendations as-is
  // (already computed by lib/portfolio-analytics.ts's computeRecommendations()),
  // scoped to this symbol when it's an actual holding.
  const portfolioRecommendation = ios?.report?.recommendations.find((r) => r.symbol === quote.symbol) ?? null;

  // Current share count for PositionActionCard — read from the already-loaded
  // IOS report rather than a separate fetch. A component-local fetch here
  // used to compete for one of the browser's ~6 per-origin connection slots
  // against this page's much slower requests (AI verdict, movement
  // explanation), so under load it could stall indefinitely and the card
  // would silently never appear.
  const currentShares = ios?.report?.holdings.find((h) => h.symbol?.toUpperCase() === quote.symbol.toUpperCase())?.quantity ?? 0;

  // Portfolio context for AI — serialized for the copilot and verdict endpoint.
  // Only populated when the user has an actual portfolio (not generic/empty).
  const portfolioContextForAI = ios?.profile.hasPortfolio
    ? {
        hasPortfolio: true as const,
        objective: ios.profile.objective,
        holdingSymbols: ios.profile.holdingSymbols,
        sectorWeights: ios.profile.sectorWeights,
        missingSectors: ios.profile.missingSectors,
        overweightSectors: ios.profile.overweightSectors,
        fitScore: portfolioFit?.fitScore,
        fitTier: portfolioFit?.fitTier,
        fitReasons: portfolioFit?.reasons,
        isInPortfolio: portfolioFit?.isInPortfolio,
        suggestedAllocationPct: portfolioFit?.suggestedAllocationPct,
        suggestedAmount: portfolioFit?.suggestedAmount,
        concentrationWarning: portfolioFit?.concentrationWarning,
      }
    : undefined;

  // Track research behavior
  useEffect(() => {
    ios?.trackResearch(quote.symbol);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quote.symbol]);

  // Verdict fetch — re-runs when symbol changes OR when portfolio fit becomes
  // available (progressive enhancement: generic verdict → personalized verdict).
  const verdictPortfolioKey = portfolioFit && !portfolioFit.isGeneric ? portfolioFit.fitScore : null;
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    setVerdictLoading(true);
    setVerdict(null);
    /* eslint-enable react-hooks/set-state-in-effect */

    const params = new URLSearchParams({ symbol: quote.symbol });
    if (portfolioFit && !portfolioFit.isGeneric && ios?.profile.hasPortfolio) {
      params.set("fitScore", String(portfolioFit.fitScore));
      params.set("fitTier", portfolioFit.fitTier);
      if (portfolioFit.reasons.length > 0)
        params.set("reasons", portfolioFit.reasons.slice(0, 2).join("; "));
      params.set("isInPortfolio", String(portfolioFit.isInPortfolio));
      if (portfolioFit.suggestedAllocationPct != null)
        params.set("suggestedPct", portfolioFit.suggestedAllocationPct.toFixed(1));
      if (ios.profile.missingSectors.length > 0)
        params.set("missingSectors", ios.profile.missingSectors.slice(0, 4).join(", "));
      params.set("objective", ios.profile.objective);
    }

    void fetch(`/api/ai/verdict?${params}`)
      .then((r) => r.json() as Promise<InvestmentVerdict & { error?: string }>)
      .then((json) => {
        if (!json.error) setVerdict(json);
      })
      .catch(() => { /* AI is best-effort */ })
      .finally(() => setVerdictLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quote.symbol, verdictPortfolioKey]);

  // The asset-class-specific sections below all go through `useDataset`, which
  // gives each of them three things the hand-rolled `useEffect` + `fetch` +
  // three-`useState` pattern did not:
  //
  //   1. Cancellation. Every one of these previously had NO abort handling, so
  //      switching from one fund to another mid-flight let the first symbol's
  //      response land after the second's and silently overwrite it. That race
  //      was real and is now closed — the request is aborted on symbol change.
  //   2. Deduplication, shared with every other module asking for the same key.
  //   3. Its own store subscription, so when (say) the options chain finally
  //      resolves, only the derivatives card re-renders.
  //
  // `enabled` keeps the asset-class gating exactly as it was: a crypto symbol
  // still never fetches fund holdings.

  const indiaEntry = useDataset<IndiaData>(
    "india",
    quote.symbol,
    (signal) =>
      fetchJson<IndiaData>(
        `/api/screener-in?symbol=${encodeURIComponent(quote.symbol.replace(/\.(NS|BO)$/i, ""))}`,
        signal,
      ),
    { enabled: isIndia },
  );
  const india = indiaEntry.data;
  const indiaLoading = indiaEntry.status === "loading";

  const fundEntry = useDataset<{ fund: FundProfileData; score: ScoreResult }>(
    "fundProfile",
    quote.symbol,
    (signal) => fetchJson(`/api/fund?symbol=${encodeURIComponent(quote.symbol)}`, signal),
    { enabled: isFund },
  );
  const fund = fundEntry.data?.fund ?? null;
  const fundScore = fundEntry.data?.score ?? null;
  const fundLoading = fundEntry.status === "loading";

  const cryptoEntry = useDataset<{ score: ScoreResult; btcHistory: HistoryPoint[] }>(
    "crypto",
    quote.symbol,
    (signal) => fetchJson(`/api/crypto?symbol=${encodeURIComponent(quote.symbol)}`, signal),
    { enabled: isCrypto },
  );
  const cryptoScore = cryptoEntry.data?.score ?? null;
  const btcHistory = cryptoEntry.data?.btcHistory ?? [];
  const cryptoLoading = cryptoEntry.status === "loading";

  const commodityEntry = useDataset<{ score: ScoreResult; benchmarkHistory: HistoryPoint[] }>(
    "commodity",
    quote.symbol,
    (signal) => fetchJson(`/api/commodity?symbol=${encodeURIComponent(quote.symbol)}`, signal),
    { enabled: isCommodity },
  );
  const commodityScore = commodityEntry.data?.score ?? null;
  const commodityBenchmarkHistory = commodityEntry.data?.benchmarkHistory ?? [];
  const commodityLoading = commodityEntry.status === "loading";

  const forexEntry = useDataset<{ score: ScoreResult; benchmarkHistory: HistoryPoint[] }>(
    "forex",
    quote.symbol,
    (signal) => fetchJson(`/api/forex?symbol=${encodeURIComponent(quote.symbol)}`, signal),
    { enabled: isForex },
  );
  const forexScore = forexEntry.data?.score ?? null;
  const forexBenchmarkHistory = forexEntry.data?.benchmarkHistory ?? [];
  const forexLoading = forexEntry.status === "loading";

  // Additive module, not gated by a detected asset class. A symbol with no
  // listed options resolves to `summary: null`, which is a normal outcome.
  const derivativesEntry = useDataset<{ summary: DerivativesSummary | null }>(
    "options",
    quote.symbol,
    (signal) => fetchJson(`/api/derivatives?symbol=${encodeURIComponent(quote.symbol)}`, signal),
    { enabled: isEquity || isFund },
  );
  const derivativesSummary = derivativesEntry.data?.summary ?? null;
  const derivativesLoading = derivativesEntry.status === "loading";

  // Always the full 4-tenor curve, not just the searched tenor. Not symbol-
  // scoped: the yield curve is the same regardless of which tenor was searched,
  // so every macro symbol shares one cache entry and one request.
  const macroEntry = useDataset<{ summary: MacroSummary }>(
    "macro",
    null,
    (signal) => fetchJson("/api/macro", signal),
    { enabled: isMacro },
  );
  const macroSummary = macroEntry.data?.summary ?? null;
  const macroLoading = macroEntry.status === "loading";

  async function downloadReport() {
    setDownloading(true);
    try {
      const res = await fetch(`/api/report?symbol=${encodeURIComponent(quote.symbol)}`);
      if (!res.ok) throw new Error();
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${quote.symbol}_Research_${new Date().toISOString().slice(0, 10)}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch { /* non-critical */ } finally {
      setDownloading(false);
    }
  }

  const statsRow: [string, string][] = [
    ["Market cap",    formatMarketCap(quote.marketCap)],
    ["P/E ratio",     quote.peRatio != null ? formatNumber(quote.peRatio) : "—"],
    ["Day range",     `${formatCurrency(quote.dayLow, quote.currency)} – ${formatCurrency(quote.dayHigh, quote.currency)}`],
    ["52-week range", `${formatCurrency(quote.fiftyTwoWeekLow, quote.currency)} – ${formatCurrency(quote.fiftyTwoWeekHigh, quote.currency)}`],
    ["Volume",        quote.volume != null ? formatCompact(quote.volume) : "—"],
    ["Exchange",      quote.exchange ?? "—"],
  ];

  /* ── Convenience helpers ─────────────────────────────────── */
  const hasEarnings =
    !!fundamentals?.earnings &&
    ((fundamentals.earnings.history?.length ?? 0) > 0 ||
      fundamentals.earnings.nextDate != null ||
      fundamentals.earnings.trailingEps != null);

  const hasOwnership =
    !!fundamentals?.ownership &&
    (fundamentals.ownership.institutionsPctHeld != null ||
      fundamentals.ownership.insidersPctHeld != null ||
      (fundamentals.ownership.topHolders?.length ?? 0) > 0);

  const hasStatements = !!fundamentals?.statements;
  const valuation = fundamentals?.valuation ?? [];
  const hasIndia = !!india && !indiaLoading;

  /* ── India shorthand ─────────────────────────────────────── */
  const indiaCompany = india?.company;
  const indiaDerived = india?.derived;
  const indiaQuote = india?.quote ?? null;
  const hasIndiaFinancials = (indiaCompany?.annualPL?.length ?? 0) > 0 || (indiaCompany?.quarterlyPL?.length ?? 0) > 0;
  const hasIndiaOwnership = (indiaCompany?.shareholding?.length ?? 0) > 0;

  // The single conviction score for Indian stocks (screener.in). Yahoo's
  // composite is deliberately not shown for NSE/BSE names — its fundamentals
  // coverage is unreliable and produced a second, contradictory headline score.
  const indiaSnapshot = useMemo(
    () => (indiaCompany && indiaDerived ? computeIndiaSnapshot(indiaCompany, indiaDerived) : null),
    [indiaCompany, indiaDerived],
  );

  /* ========================================================== */
  return (
    <div className="flex flex-col gap-5">

      {/* ── 1. Company masthead — identity, price, actions & key stats ── */}
      <div data-arrival-target="price" className="overflow-hidden rounded-card border border-border bg-surface shadow-card">
        <div className="flex flex-wrap items-start justify-between gap-4 p-5">
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2.5">
              <span className="font-mono text-xl font-semibold tracking-tight">{quote.symbol}</span>
              <span className="text-sm text-muted">{quote.name}</span>
              <span className={`rounded-full border px-2 py-0.5 text-micro font-semibold uppercase tracking-widest ${MARKET_BADGE[market]}`}>
                {MARKET_LABEL[market]}
              </span>
              {quote.assetType && (
                <span className="text-micro font-medium uppercase tracking-widest text-faint">{quote.assetType.toLowerCase()}</span>
              )}
            </div>
            <div className="flex items-baseline gap-3">
              <span className="text-4xl font-semibold tabular-nums tracking-tight">
                {formatCurrency(quote.price, quote.currency)}
              </span>
              <span className={`inline-flex items-center gap-1 text-sm font-medium tabular-nums ${positive ? "text-positive" : "text-negative"}`}>
                {positive ? <TrendingUp className="h-4 w-4" strokeWidth={2} /> : <TrendingDown className="h-4 w-4" strokeWidth={2} />}
                {formatCurrency(quote.change, quote.currency)} ({formatPercent(quote.changePercent)})
              </span>
            </div>
          </div>

          {/* Action row */}
          <div className="flex flex-wrap items-center gap-1.5">
            <Link
              href={`/intelligence?view=timeline&scope=symbol&id=${encodeURIComponent(quote.symbol)}`}
              className="inline-flex items-center gap-1.5 rounded-control px-2.5 py-2 text-sm text-muted outline-none transition-colors hover:bg-surface-2 hover:text-foreground focus-visible:ring-2 focus-visible:ring-brand/40"
            >
              <Clock3 className="h-4 w-4" strokeWidth={1.75} /> Timeline
            </Link>
            <Link
              href={`/intelligence?view=graph&scope=symbol&id=${encodeURIComponent(quote.symbol)}`}
              className="inline-flex items-center gap-1.5 rounded-control px-2.5 py-2 text-sm text-muted outline-none transition-colors hover:bg-surface-2 hover:text-foreground focus-visible:ring-2 focus-visible:ring-brand/40"
            >
              <Network className="h-4 w-4" strokeWidth={1.75} /> Graph
            </Link>
            <button
              onClick={onCopyLink}
              className="inline-flex items-center gap-1.5 rounded-control px-2.5 py-2 text-sm text-muted outline-none transition-colors hover:bg-surface-2 hover:text-foreground focus-visible:ring-2 focus-visible:ring-brand/40"
            >
              <Link2 className="h-4 w-4" strokeWidth={1.75} /> Copy link
            </button>
            <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />
            <button
              onClick={downloadReport}
              disabled={downloading}
              className="inline-flex items-center gap-1.5 rounded-control border border-brand/40 bg-brand-muted px-3 py-2 text-sm font-medium text-brand outline-none transition-colors hover:bg-brand/20 focus-visible:ring-2 focus-visible:ring-brand/40 disabled:opacity-50"
            >
              <DownloadIcon />
              {downloading ? "Generating…" : "Excel Report"}
            </button>
            <button
              onClick={onSave}
              disabled={saved}
              className={`inline-flex items-center gap-1.5 rounded-control border px-3 py-2 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-brand/40 disabled:opacity-60 ${
                saved ? "border-brand/40 bg-brand-muted text-brand" : "border-border hover:bg-surface-2"
              }`}
            >
              <Bookmark className="h-4 w-4" strokeWidth={1.75} fill={saved ? "currentColor" : "none"} />
              {saved ? "Saved" : "Watchlist"}
            </button>
          </div>
        </div>

        {/* Key stats strip — hairline-divided, tabular */}
        <dl className={`grid grid-cols-2 gap-px border-t border-border bg-border sm:grid-cols-3 ${statsRow.length % 6 === 0 ? "lg:grid-cols-6" : "lg:grid-cols-3"}`}>
          {statsRow.map(([label, value]) => (
            <div key={label} className="flex flex-col gap-1 bg-surface px-4 py-3">
              <dt className="text-micro font-semibold uppercase tracking-widest text-faint">{label}</dt>
              <dd className="font-mono text-sm tabular-nums text-foreground">{value}</dd>
            </div>
          ))}
        </dl>
      </div>

      {/* ── 2b. Identity strip: personality badge + research confidence ── */}
      {isEquity && (
        <div className="flex flex-wrap items-center gap-3">
          <InvestmentPersonalityBadge personality={fundamentals?.personality ?? null} loading={fundsLoading} />
          <div className="min-w-[220px] flex-1">
            <ResearchConfidenceMeter symbol={quote.symbol} />
          </div>
        </div>
      )}

      {/* ── 3. AI Decision Hero — the primary answer ────────────── */}
      {/* For Indian stocks the numeric confidence comes from the screener.in
          snapshot, never the Yahoo composite, so the hero and the Investment
          Snapshot below always agree. Funds use their own fund score instead
          of the (equity-only, always-null-for-funds) fundamentals score. */}
      <DecisionHero
        verdict={verdict}
        loading={verdictLoading}
        score={isIndia || isMacro ? null : isFund ? fundScore : isCrypto ? cryptoScore : isCommodity ? commodityScore : isForex ? forexScore : fundamentals?.score ?? null}
        confidenceOverride={isIndia ? indiaSnapshot?.composite ?? null : null}
      />

      {/* ── 3b. Why Now — biggest current catalysts, composed from data already on the page ── */}
      <WhyNowCard
        verdict={verdict}
        sectorEntry={sectorRotationEntry}
        topMovementDriver={movementExplanation?.drivers[0]?.description ?? null}
        nearestTimelineHeadline={nearestTimelineEvent?.title ?? null}
      />

      {/* ── 3c. Macro Context — secondary context, collapsed so the answer leads ── */}
      {isEquity && (
        <CollapsibleSection title="Macro context" subtitle="Market · sector · company regime">
          <MacroContextLadder
            sectorEntry={sectorRotationEntry}
            industry={fundamentals?.snapshot?.industry}
            recommendation={
              isIndia
                ? indiaSnapshot?.recommendation ?? null
                : fundamentals?.score?.recommendation ?? null
            }
          />
        </CollapsibleSection>
      )}

      {/* ── 4. Portfolio Fit + Portfolio Decision — personalised context for this user ── */}
      {ios?.profileReady && portfolioFit && (
        <div className="flex flex-col gap-3">
          <PortfolioFitPanel
            fit={portfolioFit}
            collapsible
            headline={
              portfolioFit.isGeneric
                ? undefined
                : portfolioFit.reasons[0] ?? undefined
            }
          />
          <PositionActionCard
            symbol={quote.symbol}
            price={quote.price}
            currency={quote.currency}
            portfolioValue={ios.profile.totalValue}
            currentShares={currentShares}
            fit={portfolioFit}
          />
          {portfolioRecommendation && <PortfolioDecisionCard recommendation={portfolioRecommendation} />}
        </div>
      )}

      {/* ── 4b. Sector Intelligence — this company's sector rank/rotation ── */}
      {isEquity && <SectorContextCard entry={sectorRotationEntry} />}

      {/* ── 5. Price chart — always visible above tabs ──────────── */}
      <InteractiveChart
        symbol={quote.symbol}
        history={history}
        benchmarks={benchmarks ?? { spy: [], sectorEtf: null, sector: [] }}
        news={news}
        onAskAI={handleChartAskAI}
        onOpenTechnical={handleOpenTechnical}
        onNavigate={handleChartNavigate}
      />

      {/* ── 5b. Explain Every Movement — auto-loads (single instance on this page) ── */}
      <MovementExplainerCard
        symbol={quote.symbol}
        sector={fundamentals?.snapshot?.sector}
        autoLoad
        onLoaded={setMovementExplanation}
      />

      {/* ── 5. Tab navigation ───────────────────────────────────── */}
      <TabNav active={tab} onChange={setTab} />

      {/* ── 6. Tab content ──────────────────────────────────────── */}

      {/* CONVICTION — score breakdown + investment assumptions */}
      {tab === "conviction" && (
        <div className="flex flex-col gap-6">
          {isIndia && hasIndia && indiaCompany && indiaDerived ? (
            // Indian stocks: screener.in is the single source of the conviction
            // score. The Yahoo composite is intentionally omitted here — showing
            // both produced two contradictory headline scores (e.g. 52 vs 67).
            <InvestmentSnapshot company={indiaCompany} derived={indiaDerived} />
          ) : isFund ? (
            fundLoading ? (
              <LoadingSkeleton />
            ) : fundScore ? (
              <FundScoreCard score={fundScore} />
            ) : (
              <div className="rounded-xl border border-border bg-surface p-6 text-center text-sm text-muted">
                Fund data unavailable for this symbol.
              </div>
            )
          ) : isCrypto ? (
            cryptoLoading ? (
              <LoadingSkeleton />
            ) : cryptoScore ? (
              <CryptoScoreCard score={cryptoScore} />
            ) : (
              <div className="rounded-xl border border-border bg-surface p-6 text-center text-sm text-muted">
                Crypto data unavailable for this symbol.
              </div>
            )
          ) : isCommodity ? (
            commodityLoading ? (
              <LoadingSkeleton />
            ) : commodityScore ? (
              <CommodityScoreCard score={commodityScore} />
            ) : (
              <div className="rounded-xl border border-border bg-surface p-6 text-center text-sm text-muted">
                Commodity data unavailable for this symbol.
              </div>
            )
          ) : isForex ? (
            forexLoading ? (
              <LoadingSkeleton />
            ) : forexScore ? (
              <ForexScoreCard score={forexScore} />
            ) : (
              <div className="rounded-xl border border-border bg-surface p-6 text-center text-sm text-muted">
                Forex data unavailable for this symbol.
              </div>
            )
          ) : isMacro ? (
            macroLoading ? (
              <LoadingSkeleton />
            ) : macroSummary ? (
              <YieldCurveCard summary={macroSummary} />
            ) : (
              <div className="rounded-xl border border-border bg-surface p-6 text-center text-sm text-muted">
                Yield curve data unavailable.
              </div>
            )
          ) : (
            <ConvictionBreakdown
              score={fundamentals?.score ?? null}
              loading={fundsLoading}
              verdict={verdict}
              risks={fundamentals?.risks}
              onViewRisks={() => setTab("details")}
            />
          )}
          {isIndia && indiaLoading && (
            <div className="flex items-center gap-3 rounded-xl border border-border bg-surface p-5 text-sm text-muted">
              <svg className="h-4 w-4 animate-spin shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
              </svg>
              Loading India research data…
            </div>
          )}
        </div>
      )}

      {/* ANALYSIS — why own/avoid, biggest risks, what changed */}
      {tab === "analysis" && (
        <div className="flex flex-col gap-6">
          <WhySection
            verdict={verdict}
            verdictLoading={verdictLoading}
            risks={fundamentals?.risks}
            news={news}
          />
          <WatchlistIntelligenceCard symbol={quote.symbol} />
          {isIndia && hasIndia && indiaCompany && (
            <AiSectionInsight
              section="valuation"
              company={indiaCompany}
              quote={indiaQuote}
              derived={indiaDerived!}
            />
          )}
          {isFund && fund && fundScore && (
            <AiFundInsight section="allocation" symbol={quote.symbol} name={quote.name} fund={fund} score={fundScore} />
          )}
          {isCrypto && cryptoScore && (
            <AiCryptoInsight
              section="momentum"
              symbol={quote.symbol}
              name={quote.name}
              price={quote.price}
              currency={quote.currency}
              changePercent={quote.changePercent}
              marketCap={quote.marketCap}
              score={cryptoScore}
            />
          )}
          {isCommodity && commodityScore && (
            <AiCommodityInsight
              section="supply-demand"
              symbol={quote.symbol}
              name={quote.name}
              price={quote.price}
              currency={quote.currency}
              changePercent={quote.changePercent}
              score={commodityScore}
              news={news}
            />
          )}
          {isForex && forexScore && (
            <AiForexInsight
              section="macro-context"
              symbol={quote.symbol}
              name={quote.name}
              price={quote.price}
              currency={quote.currency}
              changePercent={quote.changePercent}
              score={forexScore}
              news={news}
            />
          )}
          {isMacro && macroSummary && (
            <AiMacroInsight section="macro-context" resetKey={quote.symbol} summary={macroSummary} news={news} />
          )}
        </div>
      )}

      {/* FINANCIALS — earnings, score, charts */}
      {tab === "financials" && (
        <div className="flex flex-col gap-6">
          {isFund ? (
            fundLoading ? (
              <LoadingSkeleton />
            ) : fund && fundScore ? (
              <>
                <FundScoreCard score={fundScore} />
                <div className="grid gap-4 lg:grid-cols-2">
                  <HoldingsTable holdings={fund.holdings} />
                  <SectorAllocationChart sectorWeights={fund.sectorWeights} />
                </div>
                <FundPerformanceCard fund={fund} />
                <AiFundInsight section="cost" symbol={quote.symbol} name={quote.name} fund={fund} score={fundScore} />
              </>
            ) : (
              <div className="rounded-xl border border-border bg-surface p-6 text-center text-sm text-muted">
                Fund data unavailable for this symbol.
              </div>
            )
          ) : isCrypto ? (
            cryptoLoading ? (
              <LoadingSkeleton />
            ) : cryptoScore ? (
              <>
                <CryptoScoreCard score={cryptoScore} />
                <RelativeStrengthChart symbol={quote.symbol} history={history} benchmarkHistory={btcHistory} benchmarkLabel="BTC" />
                <RiskProfileCard score={cryptoScore} />
                <AiCryptoInsight
                  section="risk"
                  symbol={quote.symbol}
                  name={quote.name}
                  price={quote.price}
                  currency={quote.currency}
                  changePercent={quote.changePercent}
                  marketCap={quote.marketCap}
                  score={cryptoScore}
                />
              </>
            ) : (
              <div className="rounded-xl border border-border bg-surface p-6 text-center text-sm text-muted">
                Crypto data unavailable for this symbol.
              </div>
            )
          ) : isCommodity ? (
            commodityLoading ? (
              <LoadingSkeleton />
            ) : commodityScore ? (
              <>
                <CommodityScoreCard score={commodityScore} />
                <RelativeStrengthChart symbol={quote.symbol} history={history} benchmarkHistory={commodityBenchmarkHistory} benchmarkLabel="DBC" />
                <RiskProfileCard score={commodityScore} />
                <AiCommodityInsight
                  section="risk"
                  symbol={quote.symbol}
                  name={quote.name}
                  price={quote.price}
                  currency={quote.currency}
                  changePercent={quote.changePercent}
                  score={commodityScore}
                />
              </>
            ) : (
              <div className="rounded-xl border border-border bg-surface p-6 text-center text-sm text-muted">
                Commodity data unavailable for this symbol.
              </div>
            )
          ) : isForex ? (
            forexLoading ? (
              <LoadingSkeleton />
            ) : forexScore ? (
              <>
                <ForexScoreCard score={forexScore} />
                <RelativeStrengthChart symbol={quote.symbol} history={history} benchmarkHistory={forexBenchmarkHistory} benchmarkLabel="DXY" />
                <RiskProfileCard score={forexScore} />
                <AiForexInsight
                  section="risk"
                  symbol={quote.symbol}
                  name={quote.name}
                  price={quote.price}
                  currency={quote.currency}
                  changePercent={quote.changePercent}
                  score={forexScore}
                />
              </>
            ) : (
              <div className="rounded-xl border border-border bg-surface p-6 text-center text-sm text-muted">
                Forex data unavailable for this symbol.
              </div>
            )
          ) : isMacro ? (
            macroLoading ? (
              <LoadingSkeleton />
            ) : macroSummary ? (
              <>
                <YieldCurveCard summary={macroSummary} />
                <AiMacroInsight section="curve" resetKey={quote.symbol} summary={macroSummary} />
              </>
            ) : (
              <div className="rounded-xl border border-border bg-surface p-6 text-center text-sm text-muted">
                Yield curve data unavailable.
              </div>
            )
          ) : !isEquity ? (
            <div className="rounded-xl border border-border bg-surface p-6 text-center text-sm text-muted">
              Detailed financial analysis is available for equities.
            </div>
          ) : fundsLoading ? (
            <LoadingSkeleton />
          ) : fundsError ? (
            <div className="rounded-lg border border-negative/40 bg-negative/10 px-4 py-3 text-sm text-negative">
              {fundsError}
            </div>
          ) : fundamentals ? (
            <>
              {/* Sparse data warning */}
              {(() => {
                const KEY_KEYS = [
                  "trailingPE", "forwardPE", "returnOnEquity", "returnOnAssets",
                  "grossMargins", "operatingMargins", "profitMargins",
                  "revenueGrowth", "earningsGrowth", "freeCashflow",
                ] as const;
                const nullCount = KEY_KEYS.filter((k) => fundamentals.snapshot[k] == null).length;
                return nullCount >= 5 ? (
                  <div className="flex items-start gap-3 rounded-lg border border-warning/30 bg-warning/8 px-4 py-3 text-sm text-warning">
                    <svg className="mt-0.5 h-4 w-4 shrink-0" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M10 3L2 17h16L10 3z" />
                      <path d="M10 8v4M10 14h0" />
                    </svg>
                    Limited financial data available for this symbol. Some metrics show — because data has not been reported yet or is not covered by our sources.
                  </div>
                ) : null;
              })()}

              <ScoreCard score={fundamentals.score} momentum={fundamentals.momentum} />
              {hasEarnings && <EarningsCard earnings={fundamentals.earnings} />}

              {/* Financial charts grid */}
              <div className="grid gap-4 lg:grid-cols-2">
                {hasStatements && <MarginTrendChart statements={fundamentals.statements!} />}
                {hasStatements && <RevenueFcfChart statements={fundamentals.statements!} />}
                {valuation.length >= 2 && (
                  <ValuationHistoryChart valuation={valuation} snapshot={fundamentals.snapshot} />
                )}
                {peers && peers.peerCount > 0 ? (
                  <PeerRadarChart peers={peers} symbol={quote.symbol} />
                ) : (
                  <div className="flex h-[296px] items-center justify-center rounded-xl border border-border bg-surface text-sm text-muted">
                    {peers ? "Peer data unavailable" : "Loading peer comparison…"}
                  </div>
                )}
              </div>

              {!isIndia && peers && peers.peerCount > 0 && (
                <PeerCompetitivePosition peers={peers} symbol={quote.symbol} />
              )}

              {/* Financial Interpretation — AI insight on what changed and why */}
              {!isIndia && hasStatements && (
                <FinancialInsightCard
                  symbol={quote.symbol}
                  snapshot={fundamentals.snapshot}
                  statements={fundamentals.statements}
                  score={fundamentals.score}
                />
              )}

              {/* India financial overlays */}
              {isIndia && hasIndia && indiaCompany && hasIndiaFinancials && (
                <div className="flex flex-col gap-5">
                  <SectionDivider title="India Financial Trends (screener.in)" />
                  {(indiaCompany.quarterlyPL?.length ?? 0) >= 2 && (
                    <section className="flex flex-col gap-4">
                      <div>
                        <h3 className="text-sm font-semibold">Quarterly Performance</h3>
                        <p className="text-xs text-muted">Last 8 quarters — YoY: green ≥15%, amber moderate, red declining</p>
                      </div>
                      <QuarterlySummaryStats data={indiaCompany.quarterlyPL!} />
                      <div className="grid gap-4 lg:grid-cols-2">
                        <QuarterlyRevenueChart data={indiaCompany.quarterlyPL!} />
                        <QuarterlyProfitChart data={indiaCompany.quarterlyPL!} />
                      </div>
                    </section>
                  )}
                  {(indiaCompany.annualPL?.length ?? 0) >= 2 && (
                    <section className="flex flex-col gap-4">
                      <h3 className="text-sm font-semibold">Annual Financial History</h3>
                      <div className="grid gap-4 lg:grid-cols-2">
                        <AnnualRevenueChart data={indiaCompany.annualPL!} />
                        <AnnualMarginChart data={indiaCompany.annualPL!} />
                      </div>
                    </section>
                  )}
                  <section className="flex flex-col gap-3">
                    <div>
                      <h3 className="text-sm font-semibold">10-Year Ratio Trends</h3>
                      <p className="text-xs text-muted">Historical ratios with trend direction</p>
                    </div>
                    <RatioSparklines ratios={indiaCompany.ratios} />
                  </section>
                  <AiSectionInsight
                    section="financials"
                    company={indiaCompany}
                    quote={indiaQuote}
                    derived={indiaDerived!}
                  />
                </div>
              )}

              {isIndia && indiaLoading && (
                <p className="text-xs text-muted">Loading India financial data…</p>
              )}

              {fundamentals.statementsError && (
                <p className="text-xs text-muted">
                  Note: SEC statement data unavailable ({fundamentals.statementsError}).
                </p>
              )}
            </>
          ) : null}
        </div>
      )}

      {/* OWNERSHIP — holders, insider, India shareholding */}
      {tab === "ownership" && (
        <div className="flex flex-col gap-6">
          {fundsLoading ? (
            <LoadingSkeleton />
          ) : (
            <>
              {/* India shareholding — shown first for India stocks */}
              {isIndia && hasIndia && indiaCompany && hasIndiaOwnership && (
                <div className="flex flex-col gap-5">
                  <div>
                    <h3 className="text-sm font-semibold">Shareholding Pattern</h3>
                    <p className="text-xs text-muted">Quarterly — Promoters, FIIs, DIIs, Public</p>
                  </div>
                  <OwnershipTimeline
                    rows={indiaCompany.shareholding!}
                    periods={indiaCompany.shareholdingPeriods ?? []}
                  />
                  <AiSectionInsight
                    section="ownership"
                    company={indiaCompany}
                    quote={indiaQuote}
                    derived={indiaDerived!}
                  />
                  <SectionDivider title="Global Institutional Ownership" />
                </div>
              )}

              {isIndia && indiaLoading && (
                <div className="flex items-center gap-2 text-sm text-muted">
                  <svg className="h-4 w-4 animate-spin shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
                  </svg>
                  Loading shareholding data…
                </div>
              )}

              {/* Global institutional ownership + insider */}
              {hasOwnership && <OwnershipCard ownership={fundamentals!.ownership} />}
              <InsiderTable insider={fundamentals?.insider ?? { transactions: [], netValue: 0, buyCount: 0, sellCount: 0 }} />

              {/* Peers */}
              {!isIndia && peers && peers.peerCount > 0 && (
                <div className="flex flex-col gap-3">
                  <SectionDivider title="Peer Comparison" />
                  <PeerCompetitivePosition peers={peers} symbol={quote.symbol} />
                  <PeerRadarChart peers={peers} symbol={quote.symbol} />
                </div>
              )}

              {/* India peer table */}
              {isIndia && hasIndia && indiaDerived && indiaDerived.peers.length > 0 && (
                <div className="flex flex-col gap-4">
                  <SectionDivider title="Peer Comparison" />
                  <p className="text-xs text-muted">Rankings within peer set. Data from screener.in.</p>
                  <RankedPeers peers={indiaDerived.peers} currentSymbol={quote.symbol.replace(/\.(NS|BO)$/i, "")} />
                  <AiSectionInsight
                    section="peers"
                    company={indiaCompany!}
                    quote={indiaQuote}
                    derived={indiaDerived}
                  />
                </div>
              )}

              {!fundamentals && !fundsLoading && !hasOwnership && !isIndia && (
                <div className="rounded-xl border border-border bg-surface p-6 text-center text-sm text-muted">
                  Ownership data not available for this symbol.
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* DETAILS — analyst, risk heatmap, filings, copilot, notes */}
      {tab === "details" && (
        <div className="flex flex-col gap-6">
          {/* Investment Timeline, Knowledge Graph, Opportunity Map — compact previews */}
          <TimelinePreviewCard
            symbol={quote.symbol}
            onLoaded={(mostRecent) => setNearestTimelineEvent(mostRecent)}
          />
          <GraphPreviewCard symbol={quote.symbol} />
          <RelatedOpportunitiesCard symbol={quote.symbol} />

          {/* Fund profile (family, category, expense ratio, asset allocation) */}
          {isFund && fund && <FundProfileCard fund={fund} />}

          {/* Options chain (equity/fund underlyings with listed options — additive, not every symbol has one) */}
          {derivativesLoading ? (
            <div className="h-40 w-full animate-pulse rounded-card border border-border bg-surface-2" />
          ) : derivativesSummary ? (
            <div className="flex flex-col gap-4">
              <DerivativesSummaryCard summary={derivativesSummary} />
              <div className="grid gap-4 sm:grid-cols-2">
                <AiDerivativesInsight section="volatility" symbol={quote.symbol} underlyingName={quote.name} summary={derivativesSummary} />
                <AiDerivativesInsight section="positioning" symbol={quote.symbol} underlyingName={quote.name} summary={derivativesSummary} />
              </div>
            </div>
          ) : null}

          {/* Analyst consensus */}
          {fundamentals?.analyst && <AnalystCard analyst={fundamentals.analyst} />}

          {/* Risk heatmap */}
          {fundamentals?.risks && <RiskHeatmap risks={fundamentals.risks} />}

          {/* SEC Filings (US/global equity) */}
          {isEquity && (
            <section className="flex flex-col gap-3">
              <SectionDivider title="SEC Filings" />
              {edgarError ? (
                <p className="text-sm text-muted">EDGAR unavailable: {edgarError}</p>
              ) : filings.length === 0 ? (
                <p className="text-sm text-muted">No recent filings found.</p>
              ) : (
                <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
                  {filings.slice(0, 20).map((f) => (
                    <li
                      key={f.accessionNumber}
                      className="flex items-center justify-between gap-4 bg-surface px-4 py-3"
                    >
                      <div className="min-w-0">
                        <span className="font-mono text-sm text-brand">{f.form}</span>
                        <p className="truncate text-sm text-muted">{f.description}</p>
                      </div>
                      <div className="flex shrink-0 items-center gap-4">
                        <span className="text-xs text-muted">{formatDate(f.filedAt)}</span>
                        <a
                          href={f.documentUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm text-brand hover:underline"
                        >
                          View →
                        </a>
                      </div>
                    </li>
                  ))}
                  {filings.length > 20 && (
                    <li className="bg-surface px-4 py-3 text-center text-xs text-muted">
                      Showing 20 of {filings.length} filings
                    </li>
                  )}
                </ul>
              )}
            </section>
          )}

          {/* AI Copilot */}
          <div ref={copilotSectionRef}>
            <ResearchCopilot
              symbol={quote.symbol}
              name={quote.name}
              isEquity={isEquity}
              isFund={isFund}
              isCrypto={isCrypto}
              isCommodity={isCommodity}
              isForex={isForex}
              isMacro={isMacro}
              portfolioContext={portfolioContextForAI}
              pendingAsk={pendingCopilotAsk}
              onPendingAskHandled={() => setPendingCopilotAsk(null)}
            />
          </div>

          {/* User notes */}
          <ResearchNotes symbol={quote.symbol} />
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Empty state                                                                 */
/* -------------------------------------------------------------------------- */

function ManualAssetsPreview() {
  const [assets, setAssets] = useState<ManualAsset[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/manual-assets");
        const json = await res.json();
        setAssets(res.ok ? json.assets.slice(0, 4) : []);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) return null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-end gap-4">
        <p className="text-label font-semibold uppercase tracking-widest text-muted/60">Manual Assets</p>
        <div className="mb-0.5 h-px flex-1 bg-border" />
        <Link href="/research/manual" className="text-xs text-brand hover:underline">
          {assets.length > 0 ? "View all" : "+ Add one"}
        </Link>
      </div>
      {assets.length === 0 ? (
        <Card padding="md" className="flex items-center justify-between gap-3">
          <p className="text-xs text-muted">Real estate, private markets, alternatives, structured products — no ticker required.</p>
          <Link href="/research/manual">
            <Button size="sm" variant="secondary">+ Add Manual Asset</Button>
          </Link>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {assets.map((a) => (
            <Link key={a.id} href={`/research/manual/${a.id}`}>
              <Card padding="sm" interactive className="flex flex-col gap-1">
                <p className="truncate text-xs font-semibold">{a.name}</p>
                <p className="font-mono text-sm">{a.currentValue != null ? formatCurrency(a.currentValue) : "—"}</p>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function EmptyState({
  onSelect,
}: {
  onSelect: (sym: string) => void;
}) {
  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-3">
        <p className="text-label font-semibold uppercase tracking-widest text-muted/60">Popular</p>
        <div className="flex flex-wrap gap-2">
          {QUICK_SYMBOLS.map((sym) => (
            <button
              key={sym}
              onClick={() => onSelect(sym)}
              className="rounded-lg border border-border bg-surface px-4 py-2 font-mono text-sm transition-all hover:border-brand/40 hover:bg-surface-2 hover:text-brand"
            >
              {sym}
            </button>
          ))}
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURE_CARDS.map((f) => (
          <Card key={f.title} padding="md" className="flex flex-col gap-1">
            <p className="text-sm font-semibold text-foreground">{f.title}</p>
            <p className="text-xs leading-5 text-muted">{f.desc}</p>
          </Card>
        ))}
      </div>
      <ManualAssetsPreview />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Page root                                                                   */
/* -------------------------------------------------------------------------- */

type SearchMode = "ticker" | "real_estate" | "private_market";

const SEARCH_MODE_LABEL: Record<SearchMode, string> = {
  ticker: "Ticker",
  real_estate: "Real Estate",
  private_market: "Private Markets",
};

/**
 * The fetcher every `useDataset` on this page uses. Forwards the hook's
 * AbortSignal so a superseded request is actually torn down, and turns a non-OK
 * response into a rejection so it surfaces as that section's error rather than
 * as a silently-null card.
 */
async function fetchJson<T>(url: string, signal: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

const SEARCH_MODE_PLACEHOLDER: Record<SearchMode, string> = {
  ticker: "Search ticker or name — e.g. AAPL, Apple, Nvidia",
  real_estate: "Search an address — e.g. 123 Main St, Austin, TX 78701",
  private_market: "Search a company name — e.g. Databricks",
};

export default function ResearchPage() {
  return (
    <Suspense fallback={null}>
      <ResearchPageInner />
    </Suspense>
  );
}

function ResearchPageInner() {
  const router = useRouter();
  const [symbol, setSymbol] = useState("");
  /** The symbol currently being researched. Changing it cancels the previous plan. */
  const [activeSymbol, setActiveSymbol] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [searchMode, setSearchMode] = useState<SearchMode>("ticker");
  const [manualQuery, setManualQuery] = useState("");
  const toast = useToast();
  const highlightTarget = useArrivalTarget();

  // One orchestrated, streamed call replaces the old four-stage waterfall
  // (/api/research → then fundamentals + peers → then sector-rotation). Each
  // section lands in the platform store the instant the server resolves it, and
  // switching symbols aborts everything still in flight — so a slow response for
  // the previous ticker can no longer overwrite the new one.
  const bundle = useResearchBundle(activeSymbol);

  const quoteEntry = useDatasetValue<Quote>("quote", activeSymbol);
  const historyEntry = useDatasetValue<HistoryPoint[]>("history", activeSymbol);
  const spyEntry = useDatasetValue<HistoryPoint[]>("spyHistory", activeSymbol);
  const sectorEntry = useDatasetValue<{ etf: string | null; history: HistoryPoint[] }>("sectorHistory", activeSymbol);
  const filingsEntry = useDatasetValue<Filing[]>("filings", activeSymbol);
  const newsEntry = useDatasetValue<NewsItem[]>("news", activeSymbol);

  // Feeds the homepage's "Continue where you left off". Recorded only once the
  // quote resolves, so a mistyped ticker never lands in the user's history.
  useRecordActivity(
    activeSymbol && quoteEntry.data
      ? {
          kind: "research",
          ref: activeSymbol,
          label: `${activeSymbol} — ${quoteEntry.data.name}`,
          href: `/research?symbol=${encodeURIComponent(activeSymbol)}`,
        }
      : null,
  );

  // ResearchData is assembled from whatever has arrived so far. Sections that
  // are still in flight are simply absent, and fill in as they land.
  const data: ResearchData | null = useMemo(() => {
    if (!quoteEntry.data) return null;
    return {
      quote: quoteEntry.data,
      history: historyEntry.data ?? [],
      filings: filingsEntry.data ?? [],
      edgarError: filingsEntry.error,
      benchmarks: {
        spy: spyEntry.data ?? [],
        sectorEtf: sectorEntry.data?.etf ?? null,
        sector: sectorEntry.data?.history ?? [],
      },
      news: newsEntry.data ?? [],
    };
  }, [quoteEntry.data, historyEntry.data, filingsEntry.data, filingsEntry.error, spyEntry.data, sectorEntry.data, newsEntry.data]);

  // The page shell renders as soon as the quote and the price series exist
  // (~500ms) rather than waiting for the slowest section (~2.3s). Everything
  // else — filings, news, fundamentals, peers, sector rotation — streams into
  // the already-painted page. A failed history is `error`, not `loading`, so a
  // provider outage degrades to a chartless page instead of an infinite spinner.
  const shellReady = quoteEntry.data != null && historyEntry.status !== "loading";
  const loading = activeSymbol != null && !shellReady && bundle.error == null;
  const error = bundle.error;

  const submit = useCallback((raw: string) => {
    const sym = raw.trim().toUpperCase();
    if (!sym) return;
    setSaved(false);
    setActiveSymbol(sym);
  }, []);

  /**
   * Real Estate / Private Markets aren't ticker-searchable, so there's
   * nothing to fetch here on this page — this hands off to the Manual
   * Assets add flow with the query pre-filled and already searching (see
   * research/manual/page.tsx's `add`/`q` param handling), rather than
   * silently doing nothing or, worse, misfiring a ticker search against
   * text that was never meant to be one.
   */
  function submitManualSearch(mode: Exclude<SearchMode, "ticker">) {
    if (!manualQuery.trim()) return;
    router.push(`/research/manual?add=${mode}&q=${encodeURIComponent(manualQuery.trim())}`);
  }

  // Deep-link support and session restore.
  //
  // Only the *symbol* is persisted now, not a serialized copy of the data. The
  // page used to stash the whole ResearchData blob in sessionStorage — a third
  // private cache, with its own staleness, alongside the server cache and the
  // client store. Re-requesting instead is both simpler and more correct: the
  // platform's cache serves a revisited symbol in ~36ms, and the user can never
  // be shown a price that has been sitting in sessionStorage since yesterday.
  useEffect(() => {
    const param = new URLSearchParams(window.location.search).get("symbol");
    const restored = param ?? sessionStorage.getItem("uaa_research_symbol");
    if (!restored) return;
    /* eslint-disable react-hooks/set-state-in-effect */
    setSymbol(restored.toUpperCase());
    submit(restored);
    /* eslint-enable react-hooks/set-state-in-effect */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!activeSymbol) return;
    try {
      sessionStorage.setItem("uaa_research_symbol", activeSymbol);
    } catch {
      /* private browsing / quota — non-fatal */
    }
  }, [activeSymbol]);

  // Update tab title
  useEffect(() => {
    if (data?.quote.symbol) {
      document.title = `${data.quote.symbol} · Research Hub · UAA`;
    } else {
      document.title = "Research Hub · UAA";
    }
    return () => { document.title = "Universal Asset Analyzer"; };
  }, [data?.quote.symbol]);

  async function addToWatchlist() {
    if (!data) return;
    try {
      const res = await fetch("/api/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol: data.quote.symbol, name: data.quote.name }),
      });
      if (res.ok) {
        setSaved(true);
        toast(`${data.quote.symbol} added to watchlist`);
      } else {
        toast("Failed to add to watchlist", "error");
      }
    } catch {
      toast("Failed to add to watchlist", "error");
    }
  }

  function copyLink() {
    const url = new URL(window.location.href);
    if (data?.quote.symbol) {
      url.search = `?symbol=${encodeURIComponent(data.quote.symbol)}`;
    }
    void navigator.clipboard.writeText(url.toString());
    toast("Link copied to clipboard");
  }

  return (
    <PageShell gap="gap-6" py="py-10">
      <ArrivalHighlight targetId={highlightTarget} />
      <PageHeader
        title="Research Hub"
        description="Universal investment research — equities, funds, crypto, commodities, forex, and macro across US, India, Japan, Europe & more via ticker search, plus derivatives, real estate, private markets, alternatives, and structured products."
      />

      {/* Search bar */}
      <div className="flex flex-col gap-2">
        <div className="flex gap-2">
          {(Object.keys(SEARCH_MODE_LABEL) as SearchMode[]).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setSearchMode(mode)}
              className={`rounded-control border px-3 py-1.5 text-xs font-medium transition-colors ${
                searchMode === mode
                  ? "border-brand bg-brand/10 text-brand"
                  : "border-border bg-surface text-muted hover:border-border-strong hover:text-foreground"
              }`}
            >
              {SEARCH_MODE_LABEL[mode]}
            </button>
          ))}
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (searchMode === "ticker") submit(symbol);
            else submitManualSearch(searchMode);
          }}
          className="flex gap-2"
        >
          {searchMode === "ticker" ? (
            <SymbolSearch
              value={symbol}
              onChange={setSymbol}
              onSelect={(sym) => submit(sym)}
              loading={loading}
            />
          ) : (
            <Input value={manualQuery} onChange={(e) => setManualQuery(e.target.value)} placeholder={SEARCH_MODE_PLACEHOLDER[searchMode]} />
          )}
          <Button type="submit" variant="primary" disabled={searchMode === "ticker" && loading}>
            {searchMode === "ticker" ? (loading ? "Loading…" : "Research") : "Search"}
          </Button>
        </form>
        {searchMode !== "ticker" && (
          <p className="text-xs text-muted">
            {searchMode === "real_estate"
              ? "Opens Manual Assets with this address already searched via RentCast."
              : "Opens Manual Assets with this company already searched via SEC EDGAR."}
          </p>
        )}
      </div>

      {/* Error banner */}
      {error && (
        <div className="rounded-lg border border-negative/40 bg-negative/10 px-4 py-3 text-sm text-negative">
          {error}
        </div>
      )}

      {/* Loading skeleton */}
      {loading && (
        <div className="flex flex-col gap-4">
          <div className="h-24 animate-pulse rounded-xl bg-surface" />
          <div className="h-12 animate-pulse rounded-xl bg-surface" />
          <div className="h-36 animate-pulse rounded-xl bg-surface" />
          <div className="h-64 animate-pulse rounded-xl bg-surface" />
        </div>
      )}

      {/* Main workspace */}
      {data && !loading && (
        <ResearchWorkspace
          data={data}
          onSave={addToWatchlist}
          saved={saved}
          onCopyLink={copyLink}
        />
      )}

      {/* Empty state */}
      {!data && !loading && !error && (
        <EmptyState onSelect={(sym) => { setSymbol(sym); submit(sym); }} />
      )}
    </PageShell>
  );
}
