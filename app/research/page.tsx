"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TrendingUp, TrendingDown, Clock3, FileText, Network, Link2, Bookmark, Wallet } from "lucide-react";
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
import type { InvestmentProfile, PortfolioFitAnalysis } from "@/lib/ios/types";
import type { ChartQARelatedTarget } from "@/lib/ai-chart-qa";
import type { ScreenerInCompany, ScreenerInPeer } from "@/lib/screener-in";
import type { CorporateActions } from "@/lib/yahoo";
import type { NseResultsMeta } from "@/lib/india-news";
import { downloadBlob } from "@/lib/download";
import { detectMarket, MARKET_BADGE, MARKET_LABEL, type MarketRegion } from "@/lib/market";
import { benchmarkForSymbol } from "@/lib/benchmarks";
import { detectAssetClass, ASSET_CLASS_LABEL } from "@/lib/asset-class";
import { useResearchBundle } from "@/lib/platform/client/use-research-bundle";
import { useVerdictStream } from "@/lib/ai/client/use-verdict-stream";
import { useFocusSafe } from "@/lib/focus-context";
import { useDataset, useDatasetValue } from "@/lib/platform/client/use-dataset";
import { useRecordActivity } from "@/app/_home/use-record-activity";
import {
  formatCompact,
  formatCompactCurrency,
  formatCurrency,
  formatDate,
  formatPercent,
  formatRatio,
  statementsCurrency,
} from "@/lib/format";

// Universal components
import { DownloadIcon } from "./_components/download-icon";
import { SymbolSearch } from "@/app/_components/symbol-search";
import { LoadingMark } from "@/app/_components/loading-mark";
import { LoadingPanel, LoadingLine } from "@/app/_components/loading-panel";
import { Reveal } from "@/app/_components/reveal";
import { CountUp } from "@/app/_components/count-up";
import { useValueFlash } from "@/app/_components/use-value-flash";
import { useBootReady } from "@/app/_components/boot-context";
import { DataProvenance } from "@/app/_components/data-provenance";
import { ResearchCopilot } from "./_components/copilot/research-copilot";
import type { AskAIPayload } from "./_components/pattern-analysis-panel";
import { RESEARCH_ACTIONS } from "@/lib/ai/actions";
import { ResearchNotes } from "./_components/research-notes";
import { DecisionHero } from "./_components/decision-hero";
import { ValuationStrip } from "./_components/valuation-strip";
import { MovementExplainerCard } from "@/app/_components/movement-explainer-card";
import { ConvictionBreakdown } from "./_components/conviction-breakdown";
import { WhySection } from "./_components/why-section";
import { CompanyOrientation, readAssetProfile } from "./_components/company-orientation";
import { PriceAlertAction } from "./_components/price-alert-action";
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
import { YourExposureCard } from "./_components/your-exposure-card";
import { RelatedOpportunitiesCard } from "./_components/related-opportunities-card";
import { AddToPortfolioModal } from "@/app/_components/portfolio/add-to-portfolio-modal";

// Fundamentals sub-components (US / global equity)
import { AnalystCard } from "./_components/analyst-card";
import { InsiderTable } from "./_components/insider-table";
import { OwnershipCard } from "./_components/ownership-card";

// India-specific components (conditionally rendered)
import { computeIndiaSnapshot, type IndiaDerivedFundamentals } from "@/lib/india-snapshot";
import { InvestmentSnapshot } from "./india/_components/investment-snapshot";
import { RatioSparklines } from "./india/_components/ratio-sparklines";
import { RankedPeers } from "./india/_components/ranked-peers";
import { AiSectionInsight } from "./india/_components/ai-section-insight";

// Fund-specific components (conditionally rendered) — Research Hub Phase 1
import { FundScoreCard } from "./fund/_components/fund-score-card";
import { HoldingsTable } from "@/app/_components/holdings-table";
import { FundProfileCard } from "./fund/_components/fund-profile-card";
import { AiFundInsight } from "./fund/_components/ai-fund-insight";
// Fund intelligence layer — every one of these is computed in render from data
// already on the page (fund profile, price history, the IOS portfolio report).
// None of them fetches and none of them calls a model; see
// lib/research-engines/fund/ for the engines behind them.
import { FundOrientation } from "./fund/_components/fund-orientation";
import { ExposurePanel } from "./fund/_components/exposure-panel";
import { PortfolioImpactCard } from "./fund/_components/portfolio-impact-card";
import { VerdictTriggersCard } from "./fund/_components/verdict-triggers-card";
import { BehaviorCard } from "./fund/_components/behavior-card";
import { ThesisCaseCard } from "./fund/_components/thesis-case-card";
import { VehicleCard } from "./fund/_components/vehicle-card";
import { AlternativesCard } from "./fund/_components/alternatives-card";
import { deriveFundExposure } from "@/lib/research-engines/fund/exposure";

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
import { isDerivativesSummaryComplete, type DerivativesSummary } from "@/lib/derivatives-analysis";

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
    loading: () => <LoadingPanel height="h-[420px]" message="Loading price history…" markSize={26} />,
  },
);

// Fixed-height placeholder for lazily-loaded recharts sections below —
// matches each real component's rendered height so mounting in doesn't
// shift layout or measure a 0x0 ResponsiveContainer.
function ChartSkeleton({ h }: { h: string }) {
  return <LoadingPanel height={h} />;
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
const EpsTrendChart = dynamic(
  () => import("./india/_components/financial-charts").then((m) => m.EpsTrendChart),
  { ssr: false, loading: () => <ChartSkeleton h="h-[240px]" /> },
);
const QuarterlyResultsCard = dynamic(
  () => import("./india/_components/india-statements").then((m) => m.QuarterlyResultsCard),
  { ssr: false, loading: () => <ChartSkeleton h="h-[380px]" /> },
);
const StatementTable = dynamic(
  () => import("./india/_components/india-statements").then((m) => m.StatementTable),
  { ssr: false, loading: () => <ChartSkeleton h="h-[320px]" /> },
);
const DocumentsActionsCard = dynamic(
  () => import("./india/_components/documents-actions").then((m) => m.DocumentsActionsCard),
  { ssr: false, loading: () => <ChartSkeleton h="h-[280px]" /> },
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

/**
 * The portfolio-personalization query params for the streamed verdict.
 *
 * Returns `{}` (not null) when there is nothing to personalize with, so the
 * request still runs — a generic verdict is the correct output for a user with
 * no portfolio, and gating on personalization would leave them with no verdict
 * at all.
 */
function buildVerdictParams(
  fit: PortfolioFitAnalysis | null | undefined,
  profile: InvestmentProfile | null,
): Record<string, string> {
  if (!fit || fit.isGeneric || !profile?.hasPortfolio) return {};

  const params: Record<string, string> = {
    fitScore: String(fit.fitScore),
    fitTier: fit.fitTier,
    isInPortfolio: String(fit.isInPortfolio),
    objective: profile.objective,
  };
  if (fit.reasons.length > 0) params.reasons = fit.reasons.slice(0, 2).join("; ");
  if (fit.suggestedAllocationPct != null) params.suggestedPct = fit.suggestedAllocationPct.toFixed(1);
  if (profile.missingSectors.length > 0)
    params.missingSectors = profile.missingSectors.slice(0, 4).join(", ");
  // The unified action (Research × Fit) — pinned in the prompt so the AI
  // narration cannot recommend a different action than the fit panel and the
  // position action card render.
  params.action = fit.action.kind;
  params.actionReason = fit.action.reason;
  return params;
}

/**
 * How long the verdict request will wait for its personalization inputs (the
 * IOS profile and the research score's dataset) before firing anyway with
 * whatever is known. Sized above the warm path (both settle inside ~1s) so it
 * normally never fires, and far below the pathological cold paths it exists to
 * cap (a cold portfolio-report build measured 24.7s on 2026-08-12).
 */
const VERDICT_GATE_DEADLINE_MS = 3_000;

interface IndiaDerivedData extends IndiaDerivedFundamentals {
  promoterHolding: number | null;
  fiiHolding: number | null;
  diiHolding: number | null;
  peers: ScreenerInPeer[];
}

interface IndiaData {
  company: ScreenerInCompany;
  quote: Quote | null;
  derived: IndiaDerivedData;
  corporateActions: CorporateActions | null;
  resultsMeta: NseResultsMeta | null;
  upcomingResults: { date: string; purpose: string } | null;
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
  return <LoadingPanel height="h-56" message="Loading analysis…" markSize={24} />;
}

/* -------------------------------------------------------------------------- */
/* Research workspace (the full data view)                                    */
/* -------------------------------------------------------------------------- */

function ResearchWorkspace({
  data,
  bundleStreaming,
  onSave,
  saved,
  onCopyLink,
  onTracked,
  initialAsk,
  onInitialAskHandled,
}: {
  data: ResearchData;
  /** True while the research bundle stream is still open. Once it closes, every
   * section entry has settled (success or error) — the deterministic fallback
   * for the verdict gate below. */
  bundleStreaming: boolean;
  onSave: () => void;
  saved: boolean;
  onCopyLink: () => void;
  /** A price alert saved from the header tracked the symbol on the watchlist. */
  onTracked: () => void;
  /** A question handed off by another surface (?ask= deep link — see
   * app/_components/ask-ai.ts). Auto-sent to the copilot once, on arrival. */
  initialAsk?: string | null;
  /** Called after `initialAsk` is consumed, so the owner can clear it and a
   * LATER handoff (even of the same text) is delivered rather than deduped. */
  onInitialAskHandled?: () => void;
}) {
  const { quote, history, filings, edgarError, benchmarks, news, quoteUpdatedAt, filingsUpdatedAt } = data;
  const toast = useToast();
  const [buyingOpen, setBuyingOpen] = useState(false);
  const market: MarketRegion = detectMarket(quote);
  const isEquity = !quote.assetType || quote.assetType === "EQUITY";
  const isIndia = market === "IN";
  const isFund = detectAssetClass(quote) === "fund";
  // screener.in covers listed Indian *companies* only. An Indian mutual fund
  // (Yahoo's Morningstar-style 0P… symbol) must never hit that path: the
  // search would fuzzy-match a random company and render its equity snapshot
  // on a fund page. Every India-specific module keys off this, not isIndia.
  const isIndiaEquity = isIndia && isEquity;
  // NAV-priced, not exchange-traded: one NAV per day, no intraday range, no
  // volume. Decides which stats the masthead strip can honestly show.
  const isMutualFund = quote.assetType === "MUTUALFUND";
  const isCrypto = detectAssetClass(quote) === "crypto";
  const isCommodity = detectAssetClass(quote) === "commodity";
  const isForex = detectAssetClass(quote) === "forex";
  const isMacro = detectAssetClass(quote) === "macro";
  const positive = quote.changePercent >= 0;

  // Tab state
  const [tab, setTab] = useState<Tab>("conviction");

  // AI verdict — streamed section by section (see the hook's header for why the
  // previous fetch-once-per-render-of-a-changing-key approach fired three
  // concurrent inferences). Wired up below `portfolioFit`, which it depends on.

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

  // The bundle's `profile` step (Yahoo assetProfile) — streamed to the store
  // since the bundle shipped but previously only consumed server-side for the
  // sector benchmark. It carries the sector/industry for the identity line and
  // the business description the orientation layer falls back to.
  const profileStoreEntry = useDatasetValue<unknown>("profile", quote.symbol);

  const fundamentals = fundamentalsEntry.data;
  const peers = peersEntry.data;
  const sectorRotationEntry = sectorRotationStoreEntry.data ?? null;
  const fundsLoading = fundamentalsEntry.status === "loading";
  const fundsError = fundamentalsEntry.error;

  // Sector/industry for the identity line + description fallback. The profile
  // step usually lands well before fundamentals; the snapshot covers the rare
  // symbol where assetProfile is empty but financialData knows the sector.
  const assetProfile = useMemo(() => readAssetProfile(profileStoreEntry.data), [profileStoreEntry.data]);
  const identitySector = assetProfile.sector ?? fundamentals?.snapshot?.sector ?? null;
  const identityIndustry = assetProfile.industry ?? fundamentals?.snapshot?.industry ?? null;

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

  // A question handed off by another surface (a notification's "Ask AI", a
  // screener row, the ?ask= deep link) — sent to the copilot via the same
  // mechanism the chart's own quick actions use, so the user arrives
  // mid-conversation instead of having to restate what they were looking at.
  // Consumed-and-cleared (not fired-once): the owner nulls it afterwards, so
  // a second handoff later in the same mounted workspace still delivers.
  useEffect(() => {
    if (!initialAsk?.trim()) return;
    // Deferred a tick: both calls set state, and this effect legitimately
    // consumes an external handoff rather than syncing derived state — the
    // timeout keeps the consume out of the render commit entirely.
    const t = setTimeout(() => {
      // `label` is what the chat renders as the user's message — for a handoff
      // the question IS the message, unabridged.
      handleChartAskAI({ question: initialAsk.trim(), label: initialAsk.trim() });
      onInitialAskHandled?.();
    }, 0);
    return () => clearTimeout(t);
  }, [initialAsk, handleChartAskAI, onInitialAskHandled]);

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

  // IOS + AI verdict are wired up BELOW the asset-class datasets: the fit
  // scorer inherits the canonical Research Score (asset-class-aware), so the
  // fund/crypto/commodity/forex/India scores must exist before fit is computed.

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
    { enabled: isIndiaEquity },
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

  // The fund's exposure read — what the holdings and category actually add up
  // to. Derived once here rather than inside each consumer, because the
  // masthead orientation line and the Conviction tab's expandable are two views
  // of ONE analysis and must never drift apart.
  const fundExposure = useMemo(
    () => (fund ? deriveFundExposure(fund, market === "US") : null),
    [fund, market],
  );

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

  /* ── India shorthand (needed here: the India snapshot is the canonical
        Research Score for NSE/BSE names, which the fit scorer inherits) ── */
  const hasIndia = !!india && !indiaLoading;
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

  /* ── THE canonical Research Score ─────────────────────────────────────────
     One standalone-quality number per asset, asset-class-aware: the same
     ScoreResult the hero badge and the Conviction tab render. Everything
     downstream — portfolio fit, the unified action, the allocation, the AI
     verdict — inherits this exact number rather than recomputing its own. */
  const researchScoreResult = isIndiaEquity || isMacro
    ? null
    : isFund ? fundScore : isCrypto ? cryptoScore : isCommodity ? commodityScore : isForex ? forexScore : fundamentals?.score ?? null;
  const researchComposite = isIndiaEquity
    ? indiaSnapshot?.composite ?? null
    : researchScoreResult?.composite ?? null;

  // IOS — portfolio fit. Inherits the Research Score above (fit = research
  // quality + portfolio effects — see lib/ios/fit-scorer.ts).
  const ios = useIOSSafe();
  const portfolioFit = ios && (fundamentals || researchScoreResult || indiaSnapshot)
    ? ios.getPortfolioFit({
        symbol: quote.symbol,
        sector: fundamentals?.snapshot?.sector ?? null,
        marketCap: quote.marketCap,
        researchScore: researchComposite,
        scoreResult: researchScoreResult ?? fundamentals?.score ?? null,
        dividendYield: fundamentals?.snapshot?.dividendYield != null
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

  /* ── AI verdict, streamed ────────────────────────────────────────────────────
     The personalization params are built once, memoized on their own values, and
     the request is gated on EVERY input that shapes them having settled. That
     gate is the whole fix: a verdict fired before the inputs settle is keyed on
     params that are about to change, which aborts the in-flight generation and
     starts another — pure spend, and a skeleton reset the user has to watch.

     Two inputs feed the params, so both must settle before the first fire:
       1. the IOS profile (ios.profileReady — the portfolio report has loaded
          or definitively failed);
       2. the canonical Research Score's own dataset (fundamentals for global
          equities, the class-specific dataset otherwise), because portfolioFit
          is only computed once one of them exists — firing earlier sends {} and
          then re-keys when the score lands.
     Both settle on success OR error — a symbol whose fundamentals fail still
     gets its (generic) verdict, deterministically.

     No memo is needed here: the hook keys the request on the *serialized* query
     string, so a fresh object with equal values is not a new request. */
  const entrySettled = (status: string) => status === "success" || status === "error";
  const scoreInputsSettled = isMacro
    ? true
    : isIndiaEquity
      ? entrySettled(indiaEntry.status)
      : isFund
        ? entrySettled(fundEntry.status)
        : isCrypto
          ? entrySettled(cryptoEntry.status)
          : isCommodity
            ? entrySettled(commodityEntry.status)
            : isForex
              ? entrySettled(forexEntry.status)
              // Fundamentals arrive via the bundle stream; a closed stream means
              // every section has settled even if this entry never got a value.
              : entrySettled(fundamentalsEntry.status) || !bundleStreaming;

  // The gate above is a WAIT, and every wait needs a ceiling. Its normal cost
  // is small (warm: the profile and fundamentals both settle inside ~1s), but
  // its worst case is not bounded by anything the user can see: a cold
  // portfolio-report build measured 24.7s (2026-08-12), and the verdict —
  // this page's flagship output — sat frozen behind it the whole time, waiting
  // for personalization params it could live without. Past the deadline the
  // request fires with whatever is known; if the profile settles later with
  // real fit params, the key change upgrades the verdict in place (the hook
  // keeps the on-screen sections while the personalized replacement streams).
  // That duplicate generation is deliberately accepted: it happens only on the
  // pathological cold paths, where the alternative was a ~30s empty skeleton.
  const [gateExpiredFor, setGateExpiredFor] = useState<string | null>(null);
  useEffect(() => {
    const t = window.setTimeout(() => setGateExpiredFor(quote.symbol), VERDICT_GATE_DEADLINE_MS);
    return () => window.clearTimeout(t);
  }, [quote.symbol]);
  const gateExpired = gateExpiredFor === quote.symbol;

  const verdictParams = buildVerdictParams(portfolioFit, ios?.profile ?? null);

  const verdictStream = useVerdictStream(quote.symbol, verdictParams, {
    // `ios == null` means there is no IOS provider at all — nothing to wait for.
    enabled: ((ios == null || ios.profileReady) && scoreInputsSettled) || gateExpired,
  });
  const verdict = verdictStream.verdict;

  async function downloadReport() {
    if (downloading) return;
    setDownloading(true);
    try {
      // The shared helper, not a hand-rolled blob dance — and a visible toast
      // on failure. This used to swallow every error as "non-critical", which
      // read as a button that does nothing when the report route failed.
      await downloadBlob(
        `/api/report?symbol=${encodeURIComponent(quote.symbol)}`,
        `${quote.symbol}_Research_${new Date().toISOString().slice(0, 10)}.xlsx`,
      );
    } catch (e) {
      console.error("[research] report export failed:", e);
      toast(e instanceof Error && e.message ? e.message : "Report export failed", "error");
    } finally {
      setDownloading(false);
    }
  }

  // The stat strip describes what the instrument *is*. A mutual fund is a
  // NAV-priced pool: it has net assets rather than a market cap, one NAV per
  // day rather than an intraday range, and no exchange volume — rendering
  // those as "—" reads as broken data, so fund-shaped stats replace them.
  // ETFs are exchange-traded and keep range/volume, but lead with AUM too.
  const fiftyTwoWeekRange = `${formatCurrency(quote.fiftyTwoWeekLow, quote.currency)} – ${formatCurrency(quote.fiftyTwoWeekHigh, quote.currency)}`;
  const netAssetsStat: [string, string] = [
    "Net assets",
    formatCompactCurrency(quote.netAssets ?? quote.marketCap, quote.currency),
  ];
  const statsRow: [string, string][] = isMutualFund
    ? [
        // Morningstar (Yahoo's fund source) reports net assets per share
        // class — for an Indian scheme that is the plan/option being viewed
        // (e.g. Regular-IDCW), not the whole scheme's AUM. Verified against
        // HDFC Large Cap: plan ₹3.6k Cr vs scheme ₹38k Cr. The label says so.
        ["Net assets (plan)", netAssetsStat[1]],
        ["YTD return",     formatPercent(quote.ytdReturn, 1)],
        // A fund's trailing P/E is the weighted P/E of what it holds — the
        // label says so, so it isn't mistaken for a valuation of the fund itself.
        ["P/E (holdings)", formatRatio(quote.peRatio)],
        ["52-week range",  fiftyTwoWeekRange],
        ["Previous NAV",   formatCurrency(quote.previousClose, quote.currency)],
        ["Exchange",       quote.exchange ?? "—"],
      ]
    : isFund
      ? [
          netAssetsStat,
          ["YTD return",    formatPercent(quote.ytdReturn, 1)],
          ["Day range",     `${formatCurrency(quote.dayLow, quote.currency)} – ${formatCurrency(quote.dayHigh, quote.currency)}`],
          ["52-week range", fiftyTwoWeekRange],
          ["Volume",        quote.volume != null ? formatCompact(quote.volume) : "—"],
          ["Exchange",      quote.exchange ?? "—"],
        ]
      : [
          // Yahoo reports market cap in the listing currency — a hardcoded "$"
          // mislabels every Indian/Japanese/European name by orders of magnitude.
          ["Market cap",    formatCompactCurrency(quote.marketCap, quote.currency)],
          ["P/E ratio",     formatRatio(quote.peRatio)],
          ["Day range",     `${formatCurrency(quote.dayLow, quote.currency)} – ${formatCurrency(quote.dayHigh, quote.currency)}`],
          ["52-week range", fiftyTwoWeekRange],
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

  // A re-polled quote briefly marks the price instead of silently swapping the
  // number under the user (see app/_components/use-value-flash.ts). Keyed on the
  // price itself, so an unchanged re-poll stays quiet.
  const priceFlash = useValueFlash(quote.price);

  /* ========================================================== */
  // Section order below is the reveal order: identity → confidence → the
  // answer → why now → context → personalised fit → evidence. Each `Reveal`
  // index adds 60ms, and since sections mount as their data streams in, each
  // one animates on arrival rather than everything waiting on the slowest.
  return (
    <div className="flex flex-col gap-5">

      {/* ── 1. Company masthead — identity, price, actions & key stats ── */}
      <Reveal index={0} data-arrival-target="price" className="overflow-hidden rounded-card border border-border bg-surface shadow-card">
        <div className="flex flex-wrap items-start justify-between gap-4 p-5">
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2.5">
              {/* A mutual fund's Yahoo symbol is an opaque Morningstar ID
                  (0P0001BA9B.BO) nobody searches by or remembers — the fund
                  NAME is its identity, so it leads. Ticker-first stays right
                  for everything with a real ticker. */}
              {isMutualFund && quote.name && quote.name !== quote.symbol ? (
                <>
                  <span className="text-xl font-semibold tracking-tight">{quote.name}</span>
                  <span className="font-mono text-sm text-muted">{quote.symbol}</span>
                </>
              ) : (
                <>
                  <span className="font-mono text-xl font-semibold tracking-tight">{quote.symbol}</span>
                  <span className="text-sm text-muted">{quote.name}</span>
                </>
              )}
              <span className={`rounded-full border px-2 py-0.5 text-micro font-semibold uppercase tracking-widest ${MARKET_BADGE[market]}`}>
                {MARKET_LABEL[market]}
              </span>
              {quote.assetType && (
                <span className="text-micro font-medium uppercase tracking-widest text-faint">{quote.assetType.toLowerCase()}</span>
              )}
              {/* Sector is orientation, not signal — same faint treatment as the asset type. */}
              {isEquity && identitySector && (
                <span className="text-micro font-medium uppercase tracking-widest text-faint">
                  · {identitySector}
                  {identityIndustry ? ` · ${identityIndustry}` : ""}
                </span>
              )}
            </div>
            <div className="flex items-baseline gap-3">
              {/* Keyed on the symbol, not the price: the headline number counts
                  up once per researched name, and a live re-poll of the *same*
                  name updates in place (marked by priceFlash) instead of
                  re-running the count from zero. */}
              <CountUp
                key={quote.symbol}
                value={quote.price}
                format={(v) => formatCurrency(v, quote.currency)}
                durationMs={650}
                className={`text-4xl font-semibold tabular-nums tracking-tight ${priceFlash}`}
              />
              <span className={`inline-flex items-center gap-1 text-sm font-medium tabular-nums ${positive ? "text-positive" : "text-negative"}`}>
                {positive ? <TrendingUp className="h-4 w-4" strokeWidth={2} /> : <TrendingDown className="h-4 w-4" strokeWidth={2} />}
                {formatCurrency(quote.change, quote.currency)} ({formatPercent(quote.changePercent)})
              </span>
            </div>
            <DataProvenance source="yahoo" asOf={quoteUpdatedAt} ttlHours={0.02} liveLabel />
          </div>

          {/* Action row */}
          <div className="flex flex-wrap items-center gap-1.5">
            <Link
              href={`/journal?symbol=${encodeURIComponent(quote.symbol)}`}
              className="inline-flex items-center gap-1.5 rounded-control px-2.5 py-2 text-sm text-muted outline-none transition-colors hover:bg-surface-2 hover:text-foreground focus-visible:ring-2 focus-visible:ring-brand/40"
            >
              <Clock3 className="h-4 w-4" strokeWidth={1.75} /> Journal
            </Link>
            <Link
              href={`/exposure?issuer=${encodeURIComponent(quote.symbol)}`}
              className="inline-flex items-center gap-1.5 rounded-control px-2.5 py-2 text-sm text-muted outline-none transition-colors hover:bg-surface-2 hover:text-foreground focus-visible:ring-2 focus-visible:ring-brand/40"
            >
              <Network className="h-4 w-4" strokeWidth={1.75} /> Exposure
            </Link>
            <button
              onClick={onCopyLink}
              className="inline-flex items-center gap-1.5 rounded-control px-2.5 py-2 text-sm text-muted outline-none transition-[color,background-color,transform] duration-150 hover:bg-surface-2 hover:text-foreground focus-visible:ring-2 focus-visible:ring-brand/40 active:scale-[0.97]"
            >
              <Link2 className="h-4 w-4" strokeWidth={1.75} /> Copy link
            </button>
            {/* Entry point into the EXISTING watchlist alert system (monitor →
                crossing detection → notification bell) — a user-defined
                monitoring action, so it lives here with the other utility
                actions, never inside the AI verdict. */}
            <PriceAlertAction
              symbol={quote.symbol}
              name={quote.name}
              currency={quote.currency}
              consensus={
                fundamentals?.analyst
                  ? {
                      mean: fundamentals.analyst.targetMean,
                      high: fundamentals.analyst.targetHigh,
                      low: fundamentals.analyst.targetLow,
                      opinions: fundamentals.analyst.numberOfOpinions,
                    }
                  : undefined
              }
              onTracked={onTracked}
            />
            <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />
            {/* IC Report is an equity workflow (signal library, 9-agent
                network, DCF engine — see app/ic-report). Funds, crypto,
                commodities, forex and macro don't get a dead button. The
                page reads ?symbol= and defaults its own tab; ?autorun=1 is
                deliberately NOT passed — the user triggers generation. */}
            {isEquity && (
              <Link
                href={`/ic-report?symbol=${encodeURIComponent(quote.symbol.toUpperCase())}`}
                className="inline-flex items-center gap-1.5 rounded-control border border-brand/40 bg-brand-muted px-3 py-2 text-sm font-medium text-brand outline-none transition-[color,background-color,transform] duration-150 hover:bg-brand/20 focus-visible:ring-2 focus-visible:ring-brand/40 active:scale-[0.97]"
              >
                <FileText className="h-4 w-4" strokeWidth={1.75} />
                IC Report
              </Link>
            )}
            <button
              onClick={downloadReport}
              disabled={downloading}
              className="inline-flex items-center gap-1.5 rounded-control border border-brand/40 bg-brand-muted px-3 py-2 text-sm font-medium text-brand outline-none transition-[color,background-color,transform] duration-150 hover:bg-brand/20 focus-visible:ring-2 focus-visible:ring-brand/40 disabled:opacity-50 enabled:active:scale-[0.97]"
            >
              {downloading ? <LoadingMark size={16} label="Generating report" /> : <DownloadIcon />}
              {downloading ? "Generating…" : "Excel Report"}
            </button>
            <button
              onClick={onSave}
              disabled={saved}
              className={`inline-flex items-center gap-1.5 rounded-control border px-3 py-2 text-sm font-medium outline-none transition-[color,background-color,border-color,transform] duration-150 focus-visible:ring-2 focus-visible:ring-brand/40 disabled:opacity-60 enabled:active:scale-[0.97] ${
                saved ? "border-brand/40 bg-brand-muted text-brand" : "border-border hover:bg-surface-2"
              }`}
            >
              <Bookmark className="h-4 w-4" strokeWidth={1.75} fill={saved ? "currentColor" : "none"} />
              {saved ? "Saved" : "Watchlist"}
            </button>
            <button
              onClick={() => setBuyingOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-control border border-brand/40 bg-brand-muted px-3 py-2 text-sm font-medium text-brand outline-none transition-[color,background-color,transform] duration-150 hover:bg-brand/20 focus-visible:ring-2 focus-visible:ring-brand/40 active:scale-[0.97]"
            >
              <Wallet className="h-4 w-4" strokeWidth={1.75} />
              Add to Portfolio
            </button>
          </div>
        </div>

        {/* Company orientation — what it does, what kind of investment it is,
            and the expandable About — deliberately BEFORE the stats strip, so
            the reader knows what the company is before being shown its numbers. */}
        {isEquity && (
          <CompanyOrientation
            symbol={quote.symbol}
            companyName={quote.name}
            fundamentals={fundamentals ?? null}
            fundamentalsLoading={fundsLoading}
            profileSector={assetProfile.sector}
            profileIndustry={assetProfile.industry}
            profileDescription={assetProfile.description}
          />
        )}

        {/* The fund's counterpart to CompanyOrientation, in the same slot and for
            the same reason: know what the instrument IS before reading numbers
            about it. Funds previously went straight from a ticker to a score. */}
        {isFund && (
          <FundOrientation fund={fund} loading={fundLoading} usListed={market === "US"} />
        )}

        {/* Key stats strip — hairline-divided, tabular */}
        <dl className={`grid grid-cols-2 gap-px border-t border-border bg-border sm:grid-cols-3 ${statsRow.length % 6 === 0 ? "lg:grid-cols-6" : "lg:grid-cols-3"}`}>
          {statsRow.map(([label, value]) => (
            <div key={label} className="flex flex-col gap-1 bg-surface px-4 py-3">
              <dt className="text-micro font-semibold uppercase tracking-widest text-faint">{label}</dt>
              <dd className="font-mono text-sm tabular-nums text-foreground">{value}</dd>
            </div>
          ))}
        </dl>
      </Reveal>

      {/* ── 2b. Research confidence — data coverage of the research inputs.
             Deliberately alone on this row: the investment-personality badge
             that used to sit beside it now lives in the masthead's orientation
             layer (investment characteristics), so coverage can never be
             misread as a quality/growth signal. ── */}
      {isEquity && (
        <Reveal index={1}>
          <ResearchConfidenceMeter
            fundamentals={fundamentals ?? null}
            fundamentalsLoading={fundsLoading}
            peers={peers ?? null}
            peersLoading={peersEntry.status === "loading"}
            filingsCount={filings.length}
            newsCount={news?.length ?? 0}
          />
        </Reveal>
      )}

      {/* ── 3. AI Decision Hero — the primary answer ────────────── */}
      {/* The hero's verdict + headline score are THE canonical call: the same
          ScoreResult the Conviction tab renders (screener.in snapshot for
          Indian stocks, the asset-class scorer otherwise). Macro has no score
          — the hero falls back to the AI's growth-outlook word there. */}
      <Reveal index={2}>
        {(() => {
          // `researchScoreResult` / `indiaSnapshot` are THE canonical Research
          // Score computed above — the exact same number the fit scorer
          // inherited, so the hero, the fit panel, and the Conviction tab are
          // structurally reading one figure.
          const headlineScore = isIndiaEquity
            ? (indiaSnapshot ? { composite: indiaSnapshot.composite, recommendation: indiaSnapshot.recommendation } : null)
            : researchScoreResult
              ? { composite: researchScoreResult.composite, recommendation: researchScoreResult.recommendation }
              : null;
          return (
            <DecisionHero
              verdict={verdict}
              loading={verdict == null && verdictStream.status !== "error"}
              received={verdictStream.received}
              streaming={verdictStream.streaming}
              startedAt={verdictStream.startedAt}
              error={verdictStream.error}
              onRetry={verdictStream.retry}
              headlineScore={headlineScore}
              dataConfidence={researchScoreResult?.confidence ?? null}
            />
          );
        })()}
      </Reveal>

      {/* ── Two-column layout on very wide viewports (≥1600px): the evidence
             column (valuation, chart, tabs) sits left, the context rail (why
             now, macro, portfolio fit, sector) sits right — halving the scroll
             height. Below 1600px everything stacks in one column. ── */}
      <div className="grid min-w-0 gap-5 min-[1600px]:grid-cols-[minmax(0,1fr)_400px] min-[1600px]:items-start">
      <div className="flex min-w-0 flex-col gap-5 min-[1600px]:order-2">

      {/* ── 3b. Why Now — timing context that appears nowhere else on the page ── */}
      <Reveal index={3}>
        <WhyNowCard
          sectorEntry={sectorRotationEntry}
          topMovementDriver={movementExplanation?.drivers[0]?.description ?? null}
          nearestTimelineHeadline={nearestTimelineEvent?.title ?? null}
        />
      </Reveal>

      {/* ── 3c. Macro Context — secondary context, collapsed so the answer leads.
             Only mounts once at least one rung has real data; a collapsed bar
             that expands to three "Unavailable" chips is dead weight. ── */}
      {isEquity && (sectorRotationEntry || (isIndia ? indiaSnapshot : fundamentals?.score)) && (
        <Reveal index={4}>
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
        </Reveal>
      )}

      {/* ── 4. Portfolio Fit + Portfolio Decision — personalised context for this user ── */}
      {ios?.profileReady && portfolioFit && (
        <Reveal index={5} className="flex flex-col gap-3">
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
        </Reveal>
      )}

      {buyingOpen && (
        <AddToPortfolioModal
          item={{ symbol: quote.symbol, name: quote.name }}
          fit={portfolioFit ?? undefined}
          onClose={() => setBuyingOpen(false)}
          onSuccess={(result) => {
            toast(`Bought ${result.symbol} — added to Portfolio`, "success");
            ios?.refreshReport();
          }}
        />
      )}

      {/* ── 4b. Sector Intelligence — this company's sector rank/rotation ── */}
      {isEquity && (
        <Reveal index={6}>
          <SectorContextCard entry={sectorRotationEntry} />
        </Reveal>
      )}

      </div>{/* end context rail */}

      <div className="flex min-w-0 flex-col gap-5 min-[1600px]:order-1">

      {/* ── 3a. Valuation strip — read-only. Research observes, Valuation judges:
          the case is displayed here and edited only in the workspace, so there is
          never a second editable copy of the one intrinsic value.

          Equities only, because the case is a free-cash-flow model — but that
          includes Indian listings: the valuation layer sources them from Yahoo
          (not screener.in, which reports neither free cash flow nor a share
          count) and is already region-aware, using the India risk-free rate, ERP
          and terminal growth. ── */}
      {isEquity ? (
        <Reveal index={3}>
          <ValuationStrip symbol={quote.symbol} price={quote.price ?? null} />
        </Reveal>
      ) : null}

      {/* ── 5. Price chart — always visible above tabs ──────────── */}
      <Reveal index={7}>
        <InteractiveChart
          symbol={quote.symbol}
          history={history}
          // Fallback label is market-aware: an Indian stock whose benchmark
          // fetch failed must not be captioned against the S&P 500.
          benchmarks={benchmarks ?? { market: [], marketLabel: benchmarkForSymbol(quote.symbol).label, sectorEtf: null, sector: [] }}
          currency={quote.currency}
          news={news}
          onAskAI={handleChartAskAI}
          onOpenTechnical={handleOpenTechnical}
          onNavigate={handleChartNavigate}
        />
      </Reveal>

      {/* ── 5b. Explain Every Movement — auto-loads (single instance on this page) ── */}
      <Reveal index={8}>
        <MovementExplainerCard
          symbol={quote.symbol}
          sector={fundamentals?.snapshot?.sector}
          autoLoad
          // Hold until fundamentals resolve, so the sector is part of the very
          // first request instead of triggering a second, superseding one.
          ready={!fundsLoading}
          onLoaded={setMovementExplanation}
        />
      </Reveal>

      {/* ── 5. Tab navigation ───────────────────────────────────── */}
      <TabNav active={tab} onChange={setTab} />

      {/* ── 6. Tab content ──────────────────────────────────────── */}

      {/* CONVICTION — score breakdown + investment assumptions */}
      {/* Each panel is its own Reveal, so switching tabs fades the new content
          in rather than hard-cutting it. */}
      {tab === "conviction" && (
        <Reveal index={0} className="flex flex-col gap-6">
          {isIndiaEquity && hasIndia && indiaCompany && indiaDerived ? (
            // Indian stocks: screener.in is the single source of the conviction
            // score. The Yahoo composite is intentionally omitted here — showing
            // both produced two contradictory headline scores (e.g. 52 vs 67).
            <InvestmentSnapshot company={indiaCompany} derived={indiaDerived} />
          ) : isFund ? (
            fundLoading ? (
              <LoadingSkeleton />
            ) : fundScore && fund ? (
              /* The fund conviction view, in the order a decision is made:
                 the call, then what you'd actually be buying, then what it
                 does to the book you already have, then what would change
                 the call. Everything after the score card is either compact
                 or collapsed, so the default state stays scannable. */
              <>
                <FundScoreCard score={fundScore} />
                {fundExposure && <ExposurePanel exposure={fundExposure} />}
                <PortfolioImpactCard
                  symbol={quote.symbol}
                  fund={fund}
                  suggestedAllocationPct={portfolioFit?.suggestedAllocationPct ?? null}
                />
                <VerdictTriggersCard fund={fund} history={history} score={fundScore} />
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
              risks={fundamentals?.risks}
              onViewRisks={() => setTab("analysis")}
            />
          )}
          {isIndiaEquity && indiaLoading && (
            <LoadingLine
              message="Loading India research data…"
              className="rounded-xl border border-border bg-surface p-5"
            />
          )}
        </Reveal>
      )}

      {/* ANALYSIS — why own/avoid, biggest risks, what changed */}
      {tab === "analysis" && (
        <Reveal index={0} className="flex flex-col gap-6">
          <WhySection
            verdict={verdict}
            verdictLoading={verdict == null && verdictStream.streaming}
            risks={fundamentals?.risks}
            news={news}
          />
          <WatchlistIntelligenceCard symbol={quote.symbol} />
          {isIndiaEquity && hasIndia && indiaCompany && (
            <AiSectionInsight
              section="valuation"
              company={indiaCompany}
              quote={indiaQuote}
              derived={indiaDerived!}
            />
          )}
          {/* The fund's analysis pair: why the call is what it is (evidence
              traced to the scoring factors that produced it), then when the
              fund has actually worked (measured off the price history the
              chart above already loaded).

              These replace the AI "Allocation Analysis" panel that used to sit
              here. It restated the sector weights rendered two tabs over and
              cost an inference to do it; both questions are answered better,
              and instantly, from data already in hand. */}
          {isFund && fund && fundScore && (
            <>
              <ThesisCaseCard
                name={quote.name || quote.symbol}
                fund={fund}
                score={fundScore}
                history={history}
                benchmarkHistory={benchmarks?.market ?? []}
                benchmarkLabel={benchmarks?.marketLabel ?? "the market"}
                usListed={market === "US"}
              />
              <BehaviorCard
                history={history}
                benchmarkHistory={benchmarks?.market ?? []}
                benchmarkLabel={benchmarks?.marketLabel ?? "the market"}
              />
            </>
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
        </Reveal>
      )}

      {/* FINANCIALS — earnings, score, charts */}
      {tab === "financials" && (
        <Reveal index={0} className="flex flex-col gap-6">
          {isFund ? (
            fundLoading ? (
              <LoadingSkeleton />
            ) : fund && fundScore ? (
              <>
                {/* FundScoreCard deliberately NOT repeated here — the score
                    lives on the Conviction tab only. */}
                <div className="grid gap-4 lg:grid-cols-2">
                  <HoldingsTable holdings={fund.holdings} />
                  <SectorAllocationChart sectorWeights={fund.sectorWeights} />
                </div>
                <FundPerformanceCard fund={fund} />
                {/* Vehicle quality and alternatives answer the implementation
                    question — "is this a good way to buy this exposure?" —
                    which belongs next to the anatomy, not next to the verdict. */}
                <VehicleCard fund={fund} history={history} perShareClass={isMutualFund} />
                <AlternativesCard symbol={quote.symbol} category={fund.category} />
                {/* The one surviving AI panel on the fund path. Kept because
                    it makes the single claim our data genuinely cannot: whether
                    this cost is cheap or dear FOR ITS CATEGORY — we have the
                    fund's expense ratio but no category cost benchmark to put
                    it against. It mounts only when this tab is opened. */}
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
                {/* YieldCurveCard lives on the Conviction tab only. */}
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

              <DataProvenance source="yahoo" asOf={fundamentalsEntry.updatedAt} ttlHours={24} />
              {/* The conviction block (score ring, pillars, subscores) lives on
                  the Conviction tab ONLY — it was previously duplicated here. */}
              {hasEarnings && <EarningsCard earnings={fundamentals.earnings} currency={quote.currency} />}

              {/* Financial charts grid. A resolved-but-empty peer set renders
                  NOTHING — a permanent "Peer data unavailable" box is worse
                  than a tighter grid. */}
              <div className="grid gap-4 lg:grid-cols-2">
                {hasStatements && <MarginTrendChart statements={fundamentals.statements!} sector={fundamentals.snapshot?.sector} />}
                {hasStatements && (
                  <RevenueFcfChart
                    statements={fundamentals.statements!}
                    // Reporting currency, not the listing currency: an ADR's
                    // statements arrive in its home currency (TSM: TWD on a
                    // USD listing). Identical to quote.currency otherwise.
                    currency={statementsCurrency(fundamentals.snapshot.financialCurrency, quote.currency)}
                  />
                )}
                {valuation.length >= 2 && (
                  <ValuationHistoryChart valuation={valuation} snapshot={fundamentals.snapshot} />
                )}
                {peers && peers.peerCount > 0 ? (
                  <PeerRadarChart peers={peers} symbol={quote.symbol} />
                ) : peersEntry.status === "loading" ? (
                  <div className="flex h-[296px] items-center justify-center rounded-xl border border-border bg-surface text-sm text-muted">
                    Loading peer comparison…
                  </div>
                ) : null}
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

              {/* India financials — quarterly results first (what an Indian
                  investor checks before anything else), then trends, then the
                  full balance sheet / cash flow parsed from screener.in. */}
              {isIndiaEquity && hasIndia && indiaCompany && hasIndiaFinancials && (
                <div className="flex flex-col gap-5">
                  <SectionDivider title="Financial Statements (screener.in)" />
                  <DataProvenance source="screener_in" asOf={indiaEntry.updatedAt} ttlHours={24} />

                  {(indiaCompany.quarterlyPL?.length ?? 0) >= 2 && (
                    <section className="flex flex-col gap-4">
                      <QuarterlyResultsCard
                        data={indiaCompany.quarterlyPL!}
                        statementKind={indiaCompany.statementKind}
                        basis={indiaCompany.basis}
                        filings={filings}
                        resultsMeta={india?.resultsMeta ?? null}
                        upcoming={india?.upcomingResults ?? null}
                      />
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
                        <EpsTrendChart data={indiaCompany.annualPL!} />
                      </div>
                    </section>
                  )}

                  {indiaCompany.balanceSheet && (
                    <StatementTable
                      title="Balance Sheet"
                      stmt={indiaCompany.balanceSheet}
                      basis={indiaCompany.basis}
                      strongRows={["Total Liabilities", "Total Assets"]}
                    />
                  )}
                  {indiaCompany.cashFlow && (
                    <StatementTable
                      title="Cash Flow"
                      stmt={indiaCompany.cashFlow}
                      basis={indiaCompany.basis}
                      strongRows={["Net Cash Flow", "Free Cash Flow"]}
                    />
                  )}

                  <section className="flex flex-col gap-3">
                    <div>
                      <h3 className="text-sm font-semibold">10-Year Ratio Trends</h3>
                      <p className="text-xs text-muted">Historical ratios with trend direction</p>
                    </div>
                    <RatioSparklines ratios={indiaCompany.ratios} />
                  </section>
                  {indiaCompany.kpis.length > 0 && (
                    <section className="flex flex-col gap-3">
                      <div>
                        <h3 className="text-sm font-semibold">Company Operating KPIs</h3>
                        <p className="text-xs text-muted">Company-specific metrics screener.in publishes for this name</p>
                      </div>
                      <RatioSparklines ratios={indiaCompany.kpis} />
                    </section>
                  )}
                  <AiSectionInsight
                    section="financials"
                    company={indiaCompany}
                    quote={indiaQuote}
                    derived={indiaDerived!}
                  />
                </div>
              )}

              {isIndiaEquity && indiaLoading && <LoadingLine message="Loading India financial data…" />}

              {fundamentals.statementsError && (
                <p className="text-xs text-muted">
                  Note: SEC statement data unavailable ({fundamentals.statementsError}).
                </p>
              )}
            </>
          ) : null}
        </Reveal>
      )}

      {/* OWNERSHIP — holders, insider, India shareholding */}
      {tab === "ownership" && (
        <Reveal index={0} className="flex flex-col gap-6">
          {fundsLoading ? (
            <LoadingSkeleton />
          ) : (
            <>
              {/* India shareholding — shown first for India stocks */}
              {isIndiaEquity && hasIndia && indiaCompany && hasIndiaOwnership && (
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
                  {hasOwnership && <SectionDivider title="Global Institutional Ownership" />}
                </div>
              )}

              {isIndiaEquity && indiaLoading && <LoadingLine message="Loading shareholding data…" />}

              {/* Global institutional ownership + insider. For Indian listings
                  the SEBI-regulated shareholding pattern above IS the ownership
                  story — Yahoo's US-style insider table is almost always empty
                  for NSE names, so it renders only when it has something. */}
              {hasOwnership && <OwnershipCard ownership={fundamentals!.ownership} currency={quote.currency} />}
              {(!isIndia || (fundamentals?.insider?.transactions.length ?? 0) > 0) && (
                <InsiderTable insider={fundamentals?.insider ?? { transactions: [], netValue: 0, buyCount: 0, sellCount: 0 }} currency={quote.currency} />
              )}

              {/* Peers */}
              {!isIndia && peers && peers.peerCount > 0 && (
                <div className="flex flex-col gap-3">
                  <SectionDivider title="Peer Comparison" />
                  <PeerCompetitivePosition peers={peers} symbol={quote.symbol} />
                  <PeerRadarChart peers={peers} symbol={quote.symbol} />
                </div>
              )}

              {/* India peer table */}
              {isIndiaEquity && hasIndia && indiaDerived && indiaDerived.peers.length > 0 && (
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
        </Reveal>
      )}

      {/* DETAILS — analyst, risk heatmap, filings, copilot, notes */}
      {tab === "details" && (
        <Reveal index={0} className="flex flex-col gap-6">
          {/* Investment Timeline, Knowledge Graph, Opportunity Map — compact previews */}
          <TimelinePreviewCard
            symbol={quote.symbol}
            onLoaded={(mostRecent) => setNearestTimelineEvent(mostRecent)}
          />
          <YourExposureCard symbol={quote.symbol} />
          <RelatedOpportunitiesCard symbol={quote.symbol} />

          {/* Fund profile (family, category, expense ratio, asset allocation) */}
          {isFund && fund && <FundProfileCard fund={fund} />}

          {/* Options chain (equity/fund underlyings with listed options).
              Rendered ONLY when every field is present and plausible — Yahoo's
              chain data is often stale/placeholder off-hours, and a card with
              "ATM IV 2.3%" or zeroed greeks is worse than no card. */}
          {derivativesLoading ? (
            <LoadingPanel height="h-40" message="Loading options chain…" />
          ) : isDerivativesSummaryComplete(derivativesSummary) ? (
            <div className="flex flex-col gap-4">
              <DerivativesSummaryCard summary={derivativesSummary} currency={quote.currency} />
              <div className="grid gap-4 sm:grid-cols-2">
                <AiDerivativesInsight section="volatility" symbol={quote.symbol} underlyingName={quote.name} summary={derivativesSummary} currency={quote.currency} />
                <AiDerivativesInsight section="positioning" symbol={quote.symbol} underlyingName={quote.name} summary={derivativesSummary} currency={quote.currency} />
              </div>
            </div>
          ) : null}

          {/* Analyst consensus */}
          {fundamentals?.analyst && <AnalystCard analyst={fundamentals.analyst} currency={quote.currency} />}

          {/* Risks render on the Analysis tab only (WhySection's "Biggest
              Risks") — the risk heatmap here duplicated the same list. */}

          {/* SEC Filings (US/global equity). India: NSE corporate announcements
              on the same Filing shape (lib/india-news.ts). */}
          {isEquity && (
            <section className="flex flex-col gap-3">
              <SectionDivider title={isIndia ? "Exchange Filings (NSE)" : "SEC Filings"} />
              {!edgarError && filings.length > 0 && (
                <DataProvenance source={isIndia ? "nse_india" : "sec_edgar"} asOf={filingsUpdatedAt} ttlHours={isIndia ? 3 : 24} />
              )}
              {isIndia && filings.length === 0 ? (
                <p className="text-sm text-muted">
                  No recent NSE corporate announcements found — the exchange feed may be
                  temporarily unavailable.
                </p>
              ) : edgarError ? (
                <p className="text-sm text-muted">EDGAR unavailable: {edgarError}</p>
              ) : filings.length === 0 ? (
                <p className="text-sm text-muted">No recent filings found.</p>
              ) : (
                <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
                  {/* Identical same-day filings of one form type (e.g. four
                      Form 4s covering four insiders) collapse into one row —
                      EDGAR's submissions feed does not carry the filer name,
                      so a count is the honest differentiator. */}
                  {(() => {
                    type FilingGroup = { first: Filing; all: Filing[] };
                    const groups: FilingGroup[] = [];
                    const byKey = new Map<string, FilingGroup>();
                    for (const f of filings.slice(0, 20)) {
                      const key = `${f.form}|${f.filedAt}`;
                      const existing = byKey.get(key);
                      if (existing) existing.all.push(f);
                      else {
                        const g = { first: f, all: [f] };
                        byKey.set(key, g);
                        groups.push(g);
                      }
                    }
                    return groups.map(({ first, all }) => (
                      <li
                        key={first.accessionNumber}
                        className="flex items-center justify-between gap-4 bg-surface px-4 py-3"
                      >
                        <div className="min-w-0">
                          <span className="font-mono text-sm text-brand">
                            {first.form}
                            {all.length > 1 && (
                              <span className="ml-1.5 rounded-full border border-border px-1.5 text-xs text-muted">×{all.length}</span>
                            )}
                          </span>
                          <p className="truncate text-sm text-muted">
                            {first.description}
                            {all.length > 1 ? ` — ${all.length} filed this day` : ""}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-4">
                          <span className="text-xs text-muted">{formatDate(first.filedAt)}</span>
                          <span className="flex items-center gap-2">
                            {all.map((f, i) => (
                              <a
                                key={f.accessionNumber}
                                href={f.documentUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-sm text-brand hover:underline"
                              >
                                {all.length > 1 ? `${i + 1}` : "View →"}
                              </a>
                            ))}
                          </span>
                        </div>
                      </li>
                    ));
                  })()}
                  {filings.length > 20 && (
                    <li className="bg-surface px-4 py-3 text-center text-xs text-muted">
                      Showing 20 of {filings.length} filings
                    </li>
                  )}
                </ul>
              )}
            </section>
          )}

          {/* Documents & corporate actions — annual reports, concalls, credit
              ratings (screener.in-indexed official documents) plus dividend
              and split/bonus history (Yahoo events). India only. */}
          {isIndiaEquity && hasIndia && indiaCompany && (
            <DocumentsActionsCard
              documents={indiaCompany.documents}
              actions={india?.corporateActions ?? null}
            />
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
        </Reveal>
      )}

      </div>{/* end evidence column */}
      </div>{/* end two-column grid */}
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
              className="rounded-lg border border-border bg-surface px-4 py-2 font-mono text-sm transition-all duration-150 hover:-translate-y-px hover:border-brand/40 hover:bg-surface-2 hover:text-brand active:scale-[0.97]"
            >
              {sym}
            </button>
          ))}
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURE_CARDS.map((f, i) => (
          <Reveal key={f.title} index={i}>
            <Card padding="md" className="card-lift flex h-full flex-col gap-1">
              <p className="text-sm font-semibold text-foreground">{f.title}</p>
              <p className="text-xs leading-5 text-muted">{f.desc}</p>
            </Card>
          </Reveal>
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
  const focus = useFocusSafe();
  const [symbol, setSymbol] = useState("");
  /** The symbol currently being researched. Changing it cancels the previous plan. */
  const [activeSymbol, setActiveSymbol] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [searchMode, setSearchMode] = useState<SearchMode>("ticker");
  const [manualQuery, setManualQuery] = useState("");
  /** A copilot question handed off via ?ask= (see app/_components/ask-ai.ts). */
  const [handedOffAsk, setHandedOffAsk] = useState<string | null>(null);
  const toast = useToast();
  const highlightTarget = useArrivalTarget();

  // One orchestrated, streamed call replaces the old four-stage waterfall
  // (/api/research → then fundamentals + peers → then sector-rotation). Each
  // section lands in the platform store the instant the server resolves it, and
  // switching symbols aborts everything still in flight — so a slow response for
  // the previous ticker can no longer overwrite the new one.
  const bundle = useResearchBundle(activeSymbol);
  useBootReady(!bundle.streaming, "research");

  const quoteEntry = useDatasetValue<Quote>("quote", activeSymbol);
  const historyEntry = useDatasetValue<HistoryPoint[]>("history", activeSymbol);
  const benchmarkEntry = useDatasetValue<HistoryPoint[]>("benchmarkHistory", activeSymbol);
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
        market: benchmarkEntry.data ?? [],
        marketLabel: benchmarkForSymbol(activeSymbol ?? "").label,
        sectorEtf: sectorEntry.data?.etf ?? null,
        sector: sectorEntry.data?.history ?? [],
      },
      news: newsEntry.data ?? [],
      quoteUpdatedAt: quoteEntry.updatedAt,
      filingsUpdatedAt: filingsEntry.updatedAt,
    };
  }, [quoteEntry.data, quoteEntry.updatedAt, historyEntry.data, filingsEntry.data, filingsEntry.error, filingsEntry.updatedAt, benchmarkEntry.data, sectorEntry.data, newsEntry.data, activeSymbol]);

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
  //
  // Keyed on `searchParams`, NOT run once on mount: a client-side navigation
  // to this same route (⌘K ticker jump while already on Research, a
  // notification's "Ask AI", any /research?symbol=… push) re-renders the page
  // without remounting it, so a mount-only effect silently ignored the new
  // symbol — the URL said TSM while the page still showed MSFT (verified in
  // a real browser, 2026-08-11). `window.location` stays the read source so
  // the ask-strip below can't go stale against the router's snapshot.
  const deepLinkSearch = useSearchParams();
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const param = params.get("symbol");
    // A handed-off copilot question (see app/_components/ask-ai.ts). Consumed
    // once and stripped from the URL immediately, so a refresh or a copied
    // link doesn't re-ask it — the question belongs to the moment it was
    // asked in, not to the page's address.
    const ask = params.get("ask");
    /* eslint-disable react-hooks/set-state-in-effect */
    if (ask) {
      params.delete("ask");
      const rest = params.toString();
      window.history.replaceState(null, "", `${window.location.pathname}${rest ? `?${rest}` : ""}`);
      setHandedOffAsk(ask);
    }
    const restored = param ?? sessionStorage.getItem("uaa_research_symbol");
    if (!restored) return;
    setSymbol(restored.toUpperCase());
    submit(restored);
    /* eslint-enable react-hooks/set-state-in-effect */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deepLinkSearch]);

  // Prefill the search box from the focus spine when the Hub opens without a
  // symbol of its own (§4.4). Seeds the box only — no fetch, no submit — so the
  // user still chooses to run it; URL param and this page's own restore win.
  const prefilledRef = useRef(false);
  useEffect(() => {
    if (prefilledRef.current || !focus?.mostRecent) return;
    const param = new URLSearchParams(window.location.search).get("symbol");
    if (param || sessionStorage.getItem("uaa_research_symbol") || symbol) {
      prefilledRef.current = true;
      return;
    }
    prefilledRef.current = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSymbol(focus.mostRecent);
  }, [focus?.mostRecent, symbol]);

  useEffect(() => {
    if (!activeSymbol) return;
    // A researched symbol is the strongest "acted on" signal — record it in the
    // focus spine so other tools carry the working name (§4.4).
    focus?.recordFocus(activeSymbol);
    try {
      sessionStorage.setItem("uaa_research_symbol", activeSymbol);
    } catch {
      /* private browsing / quota — non-fatal */
    }
  }, [activeSymbol, focus]);

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
        // Provenance for the Pipeline board (lib/idea-source.ts): kept out of a
        // research session, and which kind of asset was being researched.
        body: JSON.stringify({
          symbol: data.quote.symbol,
          name: data.quote.name,
          source: "research",
          sourceDetail: `Researched as ${ASSET_CLASS_LABEL[detectAssetClass(data.quote)]}`,
        }),
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
    // "wide": research is a data surface — capping it at 1280px left a third
    // of a 2500px display as dead margin and made the page ~15 screens tall.
    // Pairs with the ≥1600px two-column layout inside ResearchWorkspace.
    <PageShell gap="gap-6" py="py-10" width="wide">
      <ArrivalHighlight targetId={highlightTarget} />
      {/* The description is an ONBOARDING affordance, so it is shown only while
          there is nothing to research yet.
        
          It is a 300-character feature list, and it used to sit above the company
          header on every load — pushing NVDA's price, market cap and ranges below
          y=220 on a 1000px viewport so that ~170px of the most valuable space on
          the page was occupied by prose the user had already read. Once a symbol is
          loaded, the instrument is the headline. */}
      <PageHeader
        title="Research Hub"
        description={
          data
            ? undefined
            : "Equities, funds, crypto, commodities, forex and macro across US, India, Japan and Europe by ticker — plus derivatives, real estate, private markets and structured products."
        }
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
          // A ticker is 1–5 characters; a viewport-wide input reads as a form,
          // not a command line. Capped, with the button right beside it.
          className="flex max-w-2xl gap-2"
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

      {/* Loading state — the brand mark, not a stack of grey rectangles
          pretending to be the content that's about to arrive. */}
      {loading && (
        <LoadingPanel
          height="h-72"
          markSize={34}
          message={`Assembling research on ${symbol.trim().toUpperCase() || "this asset"}…`}
        />
      )}

      {/* Main workspace */}
      {data && !loading && (
        <ResearchWorkspace
          data={data}
          bundleStreaming={bundle.streaming}
          onSave={addToWatchlist}
          saved={saved}
          onCopyLink={copyLink}
          onTracked={() => setSaved(true)}
          initialAsk={handedOffAsk}
          onInitialAskHandled={() => setHandedOffAsk(null)}
        />
      )}

      {/* Empty state */}
      {!data && !loading && !error && (
        <EmptyState onSelect={(sym) => { setSymbol(sym); submit(sym); }} />
      )}
    </PageShell>
  );
}
