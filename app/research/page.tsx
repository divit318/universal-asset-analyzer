"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";
import { TrendingUp, TrendingDown, Clock3, Network, Link2, Bookmark } from "lucide-react";
import type {
  FundamentalsData,
  MovementExplanation,
  PeerComparison,
  Quote,
  ResearchData,
  SectorRotationEntry,
  TimelineEvent,
} from "@/lib/types";
import type { InvestmentVerdict } from "@/app/api/ai/verdict/route";
import type { ScreenerInCompany, ScreenerInPeer } from "@/lib/screener-in";
import { detectMarket, MARKET_BADGE, MARKET_LABEL, type MarketRegion } from "@/lib/market";
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
import { TimelinePreviewCard } from "./_components/timeline-preview-card";
import { GraphPreviewCard } from "./_components/graph-preview-card";
import { RelatedOpportunitiesCard } from "./_components/related-opportunities-card";

// Fundamentals sub-components (US / global equity)
import { ScoreCard } from "./_components/score-card";
import { RiskHeatmap } from "./_components/risk-heatmap";
import { AnalystCard } from "./_components/analyst-card";
import { InsiderTable } from "./_components/insider-table";
import { EarningsCard } from "./_components/earnings-card";
import { OwnershipCard } from "./_components/ownership-card";
import { ValuationHistoryChart } from "./_components/valuation-history-chart";
import { MarginTrendChart, PeerRadarChart, RevenueFcfChart } from "./_components/charts";

// India-specific components (conditionally rendered)
import { computeIndiaSnapshot } from "@/lib/india-snapshot";
import { InvestmentSnapshot } from "./india/_components/investment-snapshot";
import { RatioSparklines } from "./india/_components/ratio-sparklines";
import { OwnershipTimeline } from "./india/_components/ownership-timeline";
import { RankedPeers } from "./india/_components/ranked-peers";
import { AiSectionInsight } from "./india/_components/ai-section-insight";
import {
  AnnualRevenueChart,
  AnnualMarginChart,
  QuarterlyRevenueChart,
  QuarterlyProfitChart,
  QuarterlySummaryStats,
} from "./india/_components/financial-charts";

import { useToast } from "@/app/_components/toast";
import { useIOSSafe } from "@/lib/ios-context";
import { PortfolioFitPanel } from "@/app/_components/portfolio-fit-panel";
import { PositionActionCard } from "./_components/position-action-card";
import { CollapsibleSection } from "@/app/_components/collapsible-section";
import { PageShell, PageHeader, Card, Button, Tabs, type TabItem } from "@/app/_components/ui";

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

const QUICK_SYMBOLS = [
  "AAPL", "NVDA", "MSFT", "GOOGL", "META", "TSLA",
  "RELIANCE.NS", "HDFCBANK.NS", "TCS.NS",
  "ASML", "7203.T",
];

const FEATURE_CARDS = [
  { title: "AI Investment Verdict",  desc: "Local AI generates a BUY / HOLD / SELL verdict with conviction breakdown — runs on Ollama, no cloud." },
  { title: "Investment Case",        desc: "Why own / why avoid + catalysts, risks, and what changed since the last analysis." },
  { title: "Price & Technical Chart",desc: "5-year interactive chart with candles, SMA overlays, RSI/MACD panels, and benchmark comparison." },
  { title: "Conviction Breakdown",   desc: "Transparent AI scoring across valuation, quality, growth, momentum, and analyst consensus." },
  { title: "India Research",         desc: "For NSE / BSE stocks: promoter holdings, FII/DII ownership, shareholding timeline, peer rankings." },
  { title: "SEC Filings & Insider",  desc: "EDGAR filings, insider transactions, and institutional ownership for US-listed equities." },
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
  const positive = quote.changePercent >= 0;

  // Tab state
  const [tab, setTab] = useState<Tab>("conviction");

  // AI verdict (auto-fetched, drives hero + analysis tab)
  const [verdict, setVerdict] = useState<InvestmentVerdict | null>(null);
  const [verdictLoading, setVerdictLoading] = useState(true);

  // Fundamentals (score, earnings, ownership, risks, etc.)
  const [fundamentals, setFundamentals] = useState<FundamentalsData | null>(null);
  const [peers, setPeers] = useState<PeerComparison | null>(null);
  const [fundsLoading, setFundsLoading] = useState(true);
  const [fundsError, setFundsError] = useState<string | null>(null);

  // Sector Rotation — fetched once per sector, shared by SectorContextCard,
  // MacroContextLadder, and WhyNowCard so they don't each fetch independently.
  const [sectorRotationEntry, setSectorRotationEntry] = useState<SectorRotationEntry | null>(null);

  // Movement Explainer result, lifted up so WhyNowCard can reuse the top
  // driver without a second fetch.
  const [movementExplanation, setMovementExplanation] = useState<MovementExplanation | null>(null);

  // Most recent Timeline milestone, populated once TimelinePreviewCard (Details
  // tab) has loaded — lets WhyNowCard cite it without a second fetch.
  const [nearestTimelineEvent, setNearestTimelineEvent] = useState<TimelineEvent | null>(null);

  // India-specific data (lazy, only when market === "IN")
  const [india, setIndia] = useState<IndiaData | null>(null);
  const [indiaLoading, setIndiaLoading] = useState(false);

  // Excel download
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

  // Fetch fundamentals + peers (for equities)
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    if (!isEquity) { setFundsLoading(false); return; }
    setFundsLoading(true);
    setFundamentals(null);
    setFundsError(null);
    setPeers(null);
    /* eslint-enable react-hooks/set-state-in-effect */
    void Promise.allSettled([
      fetch(`/api/fundamentals?symbol=${encodeURIComponent(quote.symbol)}`).then((r) =>
        r.json() as Promise<FundamentalsData & { error?: string }>
      ),
      fetch(`/api/peers?symbol=${encodeURIComponent(quote.symbol)}`).then((r) =>
        r.ok ? (r.json() as Promise<PeerComparison>) : null
      ).catch(() => null),
    ]).then(([fundsResult, peersResult]) => {
      if (fundsResult.status === "fulfilled") {
        const f = fundsResult.value;
        if (f.error) setFundsError(f.error);
        else setFundamentals(f);
      } else {
        setFundsError("Fundamentals unavailable");
      }
      if (peersResult.status === "fulfilled") setPeers(peersResult.value);
    }).finally(() => setFundsLoading(false));
  }, [quote.symbol, isEquity]);

  // Sector Rotation — find the entry matching this company's sector from the
  // latest persisted snapshot. Filtered client-side (no server util import,
  // to avoid pulling lib/db.ts's node:sqlite dependency into the client bundle).
  useEffect(() => {
    const sector = fundamentals?.snapshot?.sector;
    if (!sector) {
      /* eslint-disable-next-line react-hooks/set-state-in-effect */
      setSectorRotationEntry(null);
      return;
    }
    let cancelled = false;
    void fetch("/api/sector-rotation")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled) return;
        const entry = data?.snapshot?.sectors?.find((s: SectorRotationEntry) => s.sector === sector) ?? null;
        setSectorRotationEntry(entry);
      })
      .catch(() => { if (!cancelled) setSectorRotationEntry(null); });
    return () => { cancelled = true; };
  }, [fundamentals?.snapshot?.sector]);

  // Fetch India data when market is detected as IN
  useEffect(() => {
    if (!isIndia) return;
    const baseSymbol = quote.symbol.replace(/\.(NS|BO)$/i, "");
    /* eslint-disable react-hooks/set-state-in-effect */
    setIndiaLoading(true);
    setIndia(null);
    /* eslint-enable react-hooks/set-state-in-effect */
    void fetch(`/api/screener-in?symbol=${encodeURIComponent(baseSymbol)}`)
      .then((r) => r.ok ? (r.json() as Promise<IndiaData>) : null)
      .then((d) => setIndia(d))
      .catch(() => { /* India data is best-effort */ })
      .finally(() => setIndiaLoading(false));
  }, [quote.symbol, isIndia]);

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
      <div className="overflow-hidden rounded-card border border-border bg-surface shadow-card">
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
          Snapshot below always agree. */}
      <DecisionHero
        verdict={verdict}
        loading={verdictLoading}
        score={isIndia ? null : fundamentals?.score ?? null}
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
        </div>
      )}

      {/* FINANCIALS — earnings, score, charts */}
      {tab === "financials" && (
        <div className="flex flex-col gap-6">
          {!isEquity ? (
            <div className="rounded-xl border border-border bg-surface p-6 text-center text-sm text-muted">
              Detailed financial analysis is available for equities.
              {quote.assetType === "CRYPTOCURRENCY"
                ? " Use the AI Copilot in the Details tab for crypto analysis."
                : ""}
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
          <ResearchCopilot symbol={quote.symbol} name={quote.name} isEquity={isEquity} portfolioContext={portfolioContextForAI} />

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
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Page root                                                                   */
/* -------------------------------------------------------------------------- */

export default function ResearchPage() {
  const [symbol, setSymbol] = useState("");
  const [data, setData] = useState<ResearchData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const toast = useToast();

  const runResearch = useCallback(async (raw: string) => {
    const sym = raw.trim().toUpperCase();
    if (!sym) return;
    try {
      const res = await fetch(`/api/research?symbol=${encodeURIComponent(sym)}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `Lookup failed (${res.status})`);
      setData(json as ResearchData);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  function submit(raw: string) {
    if (!raw.trim()) return;
    setLoading(true);
    setError(null);
    setData(null);
    setSaved(false);
    void runResearch(raw);
  }

  // Deep-link support and session restore
  useEffect(() => {
    const param = new URLSearchParams(window.location.search).get("symbol");
    if (param) {
      /* eslint-disable react-hooks/set-state-in-effect */
      setSymbol(param.toUpperCase());
      submit(param);
      /* eslint-enable react-hooks/set-state-in-effect */
    } else {
      try {
        const raw = sessionStorage.getItem("uaa_research_state");
        if (raw) {
          const st = JSON.parse(raw) as { symbol?: string; data?: ResearchData };
           
          if (st.symbol) setSymbol(st.symbol);
          if (st.data) setData(st.data);
           
        }
      } catch { /* ignore corrupt storage */ }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist session state
  useEffect(() => {
    if (!symbol || !data) return;
    try { sessionStorage.setItem("uaa_research_state", JSON.stringify({ symbol, data })); } catch { /* ignore */ }
  }, [symbol, data]);

  // Update tab title
  useEffect(() => {
    if (data?.quote.symbol) {
      document.title = `${data.quote.symbol} · Research · UAA`;
    } else {
      document.title = "Research · UAA";
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
      <PageHeader
        title="Research"
        description="Universal investment research — US, India, Japan, Europe, and more. Search any global ticker."
      />

      {/* Search bar */}
      <form
        onSubmit={(e) => { e.preventDefault(); submit(symbol); }}
        className="flex gap-2"
      >
        <SymbolSearch
          value={symbol}
          onChange={setSymbol}
          onSelect={(sym) => submit(sym)}
          loading={loading}
        />
        <Button type="submit" variant="primary" disabled={loading}>
          {loading ? "Loading…" : "Research"}
        </Button>
      </form>

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
