"use client";

/**
 * The Universal Portfolio Manager.
 *
 * ONE page, ONE experience, across every asset class — equities, ETFs, REITs, bonds,
 * commodities, crypto, cash, real estate, private markets, alternatives and
 * structured products. Not a stock dashboard with extra labels bolted on: the
 * allocation, risk, scenario, health, recommendation and optimization engines are all
 * asset-class-agnostic, and each class plugs its own metrics into them.
 *
 * See PLAN-portfolio-universal.md for the architecture and the audit that motivated it.
 */

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useDataset } from "@/lib/platform/client/use-dataset";
import { askAi } from "@/app/_components/ask-ai";
import {
  PageShell,
  PageHeader,
  StatTile,
  Button,
  Tabs,
  Badge,
  Card,
} from "@/app/_components/ui";
import { formatCurrency } from "@/lib/format";
import type { UniversalPortfolioReport } from "@/lib/portfolio/report";
import { OBJECTIVES, type Objective } from "@/lib/portfolio/engines/optimize";

import { AllocationPanel, MacroFactorPanel } from "./_components/universal/allocation-panel";
import { AsOfStamp } from "./_components/universal/as-of-stamp";
import { AttributionPanel } from "./_components/universal/attribution-panel";
import { TrajectoryPanel } from "./_components/universal/trajectory-panel";
import { DecisionCenter } from "./_components/universal/decision-center";
import { HoldingsPanel } from "./_components/universal/holdings-panel";
import { PerformancePanel } from "./_components/universal/performance-panel";
import { RiskLab } from "./_components/universal/risk-lab";
import { HealthPanel } from "./_components/universal/health-panel";
import { OptimizePanel } from "./_components/universal/optimize-panel";
import { CashPanel } from "./_components/universal/cash-panel";
import { AddHoldingDialog } from "./_components/universal/add-holding-dialog";
import { ImportScreenshotDialog } from "./_components/universal/import-screenshot-dialog";
import { PortfolioThesisBanner } from "./_components/universal/portfolio-thesis";
import { KeyFactsStrip } from "./_components/universal/key-facts-strip";
import { TABS, TAB_IDS, type Tab } from "./_components/universal/dashboard-nav";
import { IntelligencePanel } from "./_components/universal/intelligence-panel";
import { PipelineBoard } from "./_components/pipeline-board";
import { SimulatorPanel } from "./_components/simulator/simulator-panel";
import { ReadOnlyHoldings } from "./_components/universal/read-only-holdings";
import type { PortfolioMeta } from "@/lib/db";
import { ArrivalHighlight, useArrivalTarget } from "@/app/_components/arrival-highlight";
import { useBootReady } from "@/app/_components/boot-context";
import { Reveal } from "@/app/_components/reveal";
import { CountUp } from "@/app/_components/count-up";
import { LoadingMark } from "@/app/_components/loading-mark";
import { BrandEmptyState } from "@/app/_components/brand";

// Tab vocabulary lives in ./_components/universal/dashboard-nav — shared with
// the components that navigate INTO a tab (key-facts strip, finding actions).

const pct = (v: number, digits: number) => `${v >= 0 ? "+" : ""}${v.toFixed(digits)}%`;

/**
 * The period a since-inception return covers, in the units a human would use.
 * "+0.2%" means nothing without it. "avg" because it is cost-weighted across
 * holdings acquired at different times, not a single start date.
 */
function periodLabel(days: number): string {
  if (days <= 0) return "on cost";
  if (days < 45) return `avg ${days}d held`;
  if (days < 400) return `avg ${Math.round(days / 30.44)}mo held`;
  return `avg ${(days / 365.25).toFixed(1)}y held`;
}

/**
 * Adaptive precision for a return.
 *
 * A headline return needs two decimals when it is under 10% (a 0.16% result
 * rendered at one decimal becomes "+0.2%", which then disagrees with the
 * attribution panel's "+0.16%" for no reason) and one above it, where a second
 * decimal is noise.
 */
const returnPct = (v: number) => pct(v, Math.abs(v) < 10 ? 2 : 1);

/* ─────────────────────────── Page ─────────────────────────── */

export default function PortfolioPage() {
  return (
    <Suspense fallback={null}>
      <PortfolioPageInner />
    </Suspense>
  );
}

function PortfolioPageInner() {
  const [tab, setTab] = useState<Tab>("dashboard");
  const [objective, setObjective] = useState<Objective>("maximize_sharpe");
  // Which named portfolio the page is looking at. 1 = Main, the only one with
  // full management; promoted portfolios are view-only until every write route
  // is portfolio-aware (see ReadOnlyHoldings for the reasoning).
  const [portfolioId, setPortfolioId] = useState(1);
  const [showAdd, setShowAdd] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showAllConcentration, setShowAllConcentration] = useState(false);
  const highlightTarget = useArrivalTarget();
  const searchParams = useSearchParams();
  const router = useRouter();

  // Tab-and-anchor navigation for the executive layer (key-facts strip,
  // finding actions): switch tab, then scroll to the section once it exists.
  // Two frames rather than one — the tab's panels mount on the next render,
  // and the Reveal wrappers need a beat before offsets are meaningful.
  const navigateTo = useCallback((target: Tab, anchor?: string) => {
    setTab(target);
    if (!anchor) return;
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        document.getElementById(anchor)?.scrollIntoView({ behavior: "smooth", block: "start" });
      }),
    );
  }, []);

  // Deep-link support: a notification (or any other link) can open the page
  // straight into a specific tab via `?tab=`. Reacts on every client-side
  // navigation, not just first mount — router.push() from the notification
  // bell to a page the user is already on re-renders this component rather
  // than remounting it.
  useEffect(() => {
    const requested = searchParams.get("tab");
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing to the router's URL state, an external source, not derivable at render time
    if (requested && TAB_IDS.includes(requested)) setTab(requested as Tab);
  }, [searchParams]);
  // Bumped after a trade execution/undo so the (independently-fetched, content-hash
  // cached) Thesis banner knows to refetch — nothing else wires that automatically.
  const [thesisRefreshSignal, setThesisRefreshSignal] = useState(0);

  // CLAUDE.md: client data goes through useDataset — it gives cancellation on
  // param change, in-flight dedup, and per-key re-render. A bare
  // useEffect + fetch + three useState slots is the pattern that left ten
  // stale-response races on the research page.
  const fetcher = useCallback(
    async (signal: AbortSignal) => {
      const res = await fetch(`/api/portfolio/report?objective=${objective}&portfolioId=${portfolioId}`, { signal });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to load portfolio");
      return json as UniversalPortfolioReport;
    },
    [objective, portfolioId],
  );

  // Keying on the objective (and portfolio) means switching cancels the
  // in-flight request for the old one rather than racing it.
  const { data: report, error, isInitialLoading, revalidating, refresh } =
    useDataset<UniversalPortfolioReport>("portfolioReport", `${objective}|${portfolioId}`, fetcher);

  const portfoliosFetcher = useCallback(async (signal: AbortSignal) => {
    const res = await fetch("/api/portfolio/portfolios", { signal });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error ?? "Failed to list portfolios");
    return json.portfolios as PortfolioMeta[];
  }, []);
  const { data: portfolios } = useDataset<PortfolioMeta[]>("portfoliosList", "all", portfoliosFetcher);
  const isMain = portfolioId === 1;
  // Non-main portfolios are view-only: every other tab's panel calls routes
  // that read or WRITE the default portfolio, so the tab itself is clamped
  // away rather than each button inside it individually disarmed.
  const VIEW_ONLY_TABS: Tab[] = ["dashboard", "risk", "simulator"];
  const effectiveTab: Tab = isMain || VIEW_ONLY_TABS.includes(tab) ? tab : "dashboard";
  useBootReady(!isInitialLoading, "portfolio");

  const loading = isInitialLoading || revalidating;
  const empty = !isInitialLoading && !error && (!report || report.holdingCount === 0);

  // Dry powder, read off the allocation the report already computed rather than
  // re-derived — so the headline tile and the allocation bar can never disagree.
  const cashSlice = report?.allocation.byAssetClass.slices.find((s) => s.key === "cash");
  const cash = { value: cashSlice?.value ?? 0, weight: cashSlice?.weight ?? 0 };

  return (
    <PageShell width="wide">
      <ArrivalHighlight targetId={highlightTarget} />
      <PageHeader
        title="Portfolio"
        description="Holdings, allocation, P&L, risk, and health across every asset class you own — with every recommended change simulated before it's shown."
        actions={
          <div className="flex items-center gap-3">
            {/* When these numbers were priced. Without it, an overnight-stale
                "Today +0.42%" is presented with exactly the authority of a quote
                from ten seconds ago. */}
            {report && <AsOfStamp generatedAt={report.generatedAt} />}
            {isMain && (
              <>
                {/* The zero-typing path: photograph the brokerage app, upload,
                    review the reconciliation, confirm. */}
                <Button variant="secondary" size="md" onClick={() => setShowImport(true)}>
                  Update from screenshot
                </Button>
                <Button variant="primary" size="md" onClick={() => setShowAdd(true)}>
                  Add holding
                </Button>
              </>
            )}
          </div>
        }
      />

      {portfolios && portfolios.length > 1 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs font-medium text-muted">Portfolio:</span>
          {portfolios.map((pf) => (
            <button
              key={pf.id}
              onClick={() => setPortfolioId(pf.id)}
              aria-pressed={portfolioId === pf.id}
              className={`max-w-[16rem] truncate rounded-lg border px-3 py-1.5 text-xs transition-colors ${
                portfolioId === pf.id
                  ? "border-brand bg-brand/10 font-semibold text-foreground"
                  : "border-border text-muted hover:border-brand/40 hover:text-foreground"
              }`}
            >
              {pf.name}
            </button>
          ))}
          {!isMain && (
            <span className="text-[11px] text-muted">
              View-only — trades, decisions and optimization run on Main Portfolio.
            </span>
          )}
        </div>
      )}

      {error && (
        <Card className="flex items-center justify-between gap-3 border-negative/25 bg-negative/5 p-4">
          <p className="text-xs text-negative">{error}</p>
          <button onClick={refresh} className="text-xs text-brand hover:underline">
            Retry
          </button>
        </Card>
      )}

      {/* Only the boot splash (or, off first-load, this one small inline
          affordance) ever masks this wait — never a full-page skeleton grid. */}
      {isInitialLoading && (
        <div className="flex items-center gap-2 text-xs text-muted">
          <LoadingMark size={16} label="Loading portfolio" />
          Loading your portfolio…
        </div>
      )}

      {/* An empty (or failed-to-load) real portfolio still gets the tab bar: the
          Simulator is fully usable with zero real holdings — a hypothetical book
          is exactly what a user with no positions yet would want to build first —
          and it must not be taken hostage by a report fetch failure it doesn't
          depend on. The empty-state card renders only for a genuinely empty
          portfolio; on error, the error card above is the whole story. */}
      {!isInitialLoading && !(report && report.holdingCount > 0) && (
        <div className="flex flex-col gap-5">
          <Tabs tabs={TABS} active={tab} onChange={setTab} layoutId="portfolio-universal-tabs" />
          {tab === "simulator" ? (
            <SimulatorPanel realPortfolioHasHoldings={false} />
          ) : empty ? (
            // The app's canonical first-run screen: a brand-new user's very
            // first page with nothing on it. Branded rather than an anonymous
            // paragraph. `padding="none"`: BrandEmptyState brings its own
            // py-12, and Card's default p-6 on top is 72px of dead space above
            // the mark.
            <Card padding="none">
              <BrandEmptyState
                title="No holdings yet."
                detail="Add equities, ETFs, bonds, crypto, commodities or cash here — or upload a screenshot of your brokerage's holdings page and let UAA read it. Real estate, private markets and alternatives are added through the Research Hub and appear here automatically."
              >
                <div className="flex flex-wrap items-center justify-center gap-2">
                  <Button variant="primary" size="md" onClick={() => setShowImport(true)}>
                    Import from screenshot →
                  </Button>
                  <Button variant="secondary" size="md" onClick={() => setShowAdd(true)}>
                    Add manually
                  </Button>
                </div>
              </BrandEmptyState>
            </Card>
          ) : null}
        </div>
      )}

      {report && report.holdingCount > 0 && (
        <div className="flex flex-col gap-5">
          {/* ── Headline ──────────────────────────────────────────────────────
              Six tiles, and cash is one of them. FIRST on the page — the measured
              facts render before the AI's reading of them (the thesis banner sits
              below and fills in on its own schedule, never blocking these).
              Dry powder is a standing, first-class fact for anyone managing a
              book — "how much can I deploy?" is asked more often than almost
              anything else on this page — and it was previously reachable only by
              reading a row inside an allocation bar. */}
          <Reveal index={0} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            <StatTile
              label="Total value"
              value={<CountUp value={report.totalValue} format={formatCurrency} />}
              sublabel={`${report.holdingCount} holdings · ${report.allocation.byAssetClass.slices.length} asset classes`}
            />
            {/* Time-bounded. An unqualified "+0.2%" is not a rate, and sitting next
                to a "Today +0.42%" that is twice as large it made both figures
                look wrong. Stating the period resolves it. */}
            <StatTile
              label="Total return"
              value={<CountUp value={report.totalReturn} format={returnPct} />}
              sublabel={`${formatCurrency(report.totalReturnDollar)} · ${periodLabel(report.holdingPeriodDays)}`}
              tone={report.totalReturn >= 0 ? "positive" : "negative"}
            />
            <StatTile
              label="Today"
              value={<CountUp value={report.todayChangePct} format={(v) => pct(v, 2)} />}
              sublabel={formatCurrency(report.todayChangeDollar)}
              tone={report.todayChangePct >= 0 ? "positive" : "negative"}
            />
            <StatTile
              label="Cash"
              value={<CountUp value={cash.value} format={formatCurrency} />}
              sublabel={
                cash.weight >= 0.05
                  ? `${cash.weight.toFixed(1)}% of portfolio · deployable`
                  : "No cash buffer"
              }
              tone={cash.weight > 25 ? "warning" : cash.weight < 1 ? "warning" : "default"}
            />
            {/* Income counts coupons, rent, staking and interest — not just dividends. */}
            <StatTile
              label="Annual income"
              value={<CountUp value={report.annualIncome} format={formatCurrency} />}
              sublabel={`${report.incomeYieldPct.toFixed(2)}% yield`}
            />
            <StatTile
              label="Health"
              value={<><CountUp value={report.health.total} format={(v) => Math.round(v).toString()} /> {report.health.grade}</>}
              sublabel={
                report.trajectory?.healthDelta != null && Math.abs(report.trajectory.healthDelta) >= 1
                  ? `${pct(report.trajectory.healthDelta, 0).replace("%", "")} pts over ${report.trajectory.windowDays}d`
                  : `${report.health.coveragePct}% of dimensions applicable`
              }
              tone={report.health.total >= 70 ? "positive" : report.health.total >= 50 ? "default" : "warning"}
            />
          </Reveal>

          {/* ── Top things to know ───────────────────────────────────────────
              The executive navigation layer: one scannable line of the facts
              that most deserve a decision, each linking into the section or
              workflow where it can be acted on. Derived from the report, so a
              quiet portfolio renders a quiet (or empty) strip. */}
          <Reveal index={1}>
            <KeyFactsStrip report={report} onNavigate={navigateTo} />
          </Reveal>

          {/* AI interpretation of the figures above — independent fetch, cached
              by content hash, compact by default. Below the tiles by design:
              measurement first, reading second. */}
          {isMain && (
            <Reveal index={1}>
              <PortfolioThesisBanner enabled={report.holdingCount > 0} refreshSignal={thesisRefreshSignal} />
            </Reveal>
          )}

          {/* ── Data-quality disclosure ──────────────────────────────────────────
              A portfolio that is largely self-reported marks has a "total value" that
              is largely the user's own opinion, and every percentage above inherits
              that softness. We say so instead of presenting it with the authority of a
              marked-to-market number. */}
          {/* ── FX could not be resolved ─────────────────────────────────────
              A currency that failed to resolve is carried at 1:1, and the only FX
              indicator anywhere else in the UI is `fxRate !== 1` — so a failed
              lookup renders exactly like a genuine base-currency holding. Nothing
              on the page could reveal it, while the error flowed into total value
              and every percentage derived from it. Given as an error rather than a
              note, because the headline number is wrong by an unknown amount. */}
          {report.unresolvedCurrencies.length > 0 && (
            <Reveal index={2}>
              <Card className="flex flex-col gap-1 border-negative/30 bg-negative/[0.05] p-3.5">
                <span className="text-[11px] font-semibold text-negative">
                  Exchange rate unavailable — totals are wrong for{" "}
                  {report.unresolvedCurrencies.join(", ")}
                </span>
                <p className="text-[11px] leading-relaxed text-muted">
                  No rate could be fetched for{" "}
                  <strong className="text-foreground">{report.unresolvedCurrencies.join(", ")}</strong>
                  {report.unresolvedCurrencies.length === 1 ? "" : " "}, so{" "}
                  {report.unresolvedCurrencies.length === 1 ? "it is" : "they are"} being counted
                  1:1 against {report.baseCurrency}. Total value, every weight, and every
                  percentage on this page are affected by an unknown amount until the rate
                  resolves. Reload to retry.
                </p>
              </Card>
            </Reveal>
          )}

          {report.marketPricedPct < 95 && (
            <Reveal index={2}>
              <Card className="flex flex-col gap-1 border-border bg-surface/40 p-3.5">
                <span className="text-[11px] font-semibold text-foreground">Valuation basis</span>
                <p className="text-[11px] leading-relaxed text-muted">
                  <strong className="text-foreground">{report.marketPricedPct}%</strong> of
                  portfolio value is priced by a live market.{" "}
                  <strong className="text-foreground">{100 - report.marketPricedPct}%</strong>{" "}
                  comes from your own valuations or derived models
                  {report.stalePct > 0 && (
                    <>
                      , and <strong className="text-warning">{report.stalePct}%</strong> of value
                      rests on a mark that has gone stale
                    </>
                  )}
                  . Every percentage on this page is computed against that whole.
                </p>
              </Card>
            </Reveal>
          )}

          {/* ── Concentration warnings ──────────────────────────────────────
              Collapsed to the three most severe, but the count of what is hidden
              is always stated. Silently truncating a risk list at three is how a
              portfolio ends up with six concentration findings and a user who
              believes it has three. */}
          {report.concentration.length > 0 && (
            <Reveal index={3} className="flex flex-col gap-1.5">
              <div id="concentration-findings" className="flex flex-col gap-1.5 scroll-mt-20">
              {(showAllConcentration ? report.concentration : report.concentration.slice(0, 3)).map((c, i) => (
                <div
                  key={`${c.type}-${c.label}-${i}`}
                  className={`flex items-start gap-2 rounded-lg border px-3.5 py-2.5 ${
                    c.severity === "high"
                      ? "border-negative/25 bg-negative/[0.04]"
                      : "border-warning/25 bg-warning/[0.04]"
                  }`}
                >
                  <Badge variant={c.severity === "high" ? "negative" : "warning"}>
                    {c.type}
                  </Badge>
                  <div className="flex min-w-0 flex-col gap-1">
                    <p className="text-xs leading-relaxed text-muted">{c.message}</p>
                    {/* PROBLEM → ACTION, only for the workflows that already
                        exist: rebalancing lives in Optimize, hypotheticals in
                        the Simulator, and open questions with the assistant —
                        pre-loaded with this finding so the user never restates
                        it. Main portfolio only: those tabs act on Main. */}
                    {isMain && (
                      <div className="flex flex-wrap items-center gap-x-3 text-[11px]">
                        <button
                          type="button"
                          onClick={() => navigateTo("optimize")}
                          className="rounded-sm text-brand hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
                        >
                          Rebalance in Optimize →
                        </button>
                        <button
                          type="button"
                          onClick={() => navigateTo("simulator")}
                          className="rounded-sm text-brand hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
                        >
                          Test a fix in Simulator
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            askAi(router, {
                              source: "app",
                              question: `My portfolio dashboard flagged a ${c.severity}-severity ${c.type} concentration finding: "${c.message}" How much does this matter for my portfolio, and what are my options?`,
                            })
                          }
                          className="rounded-sm text-muted hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
                        >
                          Ask AI why this matters
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
              </div>
              {report.concentration.length > 3 && (
                <button
                  onClick={() => setShowAllConcentration((v) => !v)}
                  aria-expanded={showAllConcentration}
                  className="self-start text-[11px] text-brand hover:underline"
                >
                  {showAllConcentration
                    ? "Show fewer"
                    : `Show ${report.concentration.length - 3} more concentration ${
                        report.concentration.length - 3 === 1 ? "finding" : "findings"
                      }`}
                </button>
              )}
            </Reveal>
          )}

          <Reveal index={4}>
            <Tabs
              tabs={isMain ? TABS : TABS.filter((t) => VIEW_ONLY_TABS.includes(t.id))}
              active={effectiveTab}
              onChange={setTab}
              layoutId="portfolio-universal-tabs"
            />
          </Reveal>

          {/* ── Dashboard ────────────────────────────────────────────────────
              Ordered by the question each section answers, most urgent first:

                1. What changed, and did my last change help?   (Trajectory)
                   What is actually wrong with it?              (Health, triaged)
                2. What is it made of?                          (Allocation)
                3. What is carrying this, what is dragging it?   (Attribution)
                4. What will move it next?                      (Macro factors)

              Attribution sits AFTER the composition breakdowns, not before them.
              The narrative summary above the tabs makes composition claims — "US-
              CENTRIC", "61% US exposure", "0% in foreign currencies", "lacks
              inflation protection" — and the reader has to be able to check those
              against the actual breakdowns before anything else competes for the
              scroll. Attribution is a single-day tactical slice, and "NVDA carried
              this" only means something once you already know NVDA's weight, so it
              reads better with composition context in hand. Macro factor exposure
              stays last: it is the most forward-looking section here and hands off
              directly into the Risk Lab tab, whose stress tests are computed from
              exactly those exposures. */}
          {effectiveTab === "dashboard" && (
            <div className="flex flex-col gap-4">
              <div className="grid gap-4 xl:grid-cols-2">
                <div id="panel-trajectory" className="h-full scroll-mt-20">
                  <TrajectoryPanel trajectory={report.trajectory} />
                </div>
                <div id="panel-health" className="h-full scroll-mt-20">
                  <HealthPanel
                    health={report.health}
                    holdings={report.holdings}
                    risk={report.risk}
                    onNavigate={isMain ? navigateTo : undefined}
                  />
                </div>
              </div>
              <div id="panel-allocation" className="scroll-mt-20">
                <AllocationPanel allocation={report.allocation} holdings={report.holdings} />
              </div>
              {/* `realizedPnl` from the same report: attribution decomposes only
                  what is still held, so without it the panel's total differed from
                  the tile above by exactly the banked P&L and said nothing. */}
              <div id="panel-attribution" className="scroll-mt-20">
                <AttributionPanel
                  attribution={report.attribution}
                  totalReturnPct={report.totalReturn}
                  realizedPnl={"empty" in report.performance ? 0 : report.performance.realizedPnl}
                  dayMoves={report.dayMoves}
                />
              </div>
              <div id="panel-macro" className="scroll-mt-20">
                <MacroFactorPanel
                  allocation={report.allocation}
                  holdings={report.holdings}
                  onOpenRiskLab={() => navigateTo("risk")}
                />
              </div>
              {!isMain && <ReadOnlyHoldings holdings={report.holdings} baseCurrency={report.baseCurrency} />}
            </div>
          )}

          {effectiveTab === "decisions" && (
            <div className="flex flex-col gap-5">
              <DecisionCenter
                decisions={report.decisions}
                health={report.health}
                risk={report.risk}
                assetClassHhi={report.allocation.byAssetClass.hhi}
                annualIncome={report.annualIncome}
              />
              <CashPanel
                onExecuted={() => {
                  refresh();
                  setThesisRefreshSignal((n) => n + 1);
                }}
              />
            </div>
          )}

          {effectiveTab === "holdings" && (
            <HoldingsPanel
              holdings={report.holdings}
              totalValue={report.totalValue}
              onChanged={() => { refresh(); setThesisRefreshSignal((n) => n + 1); }}
            />
          )}

          {/* Both props come from ONE report, so the panel's reconciliation is
              anchored on the same total value — and the same prices — as the header
              tile above it. It used to fetch its own, 15 seconds apart. */}
          {effectiveTab === "performance" && (
            <PerformancePanel performance={report.performance} totalValue={report.totalValue} />
          )}

          {effectiveTab === "pipeline" && <PipelineBoard />}

          {effectiveTab === "risk" && <RiskLab risk={report.risk} scenarios={report.scenarios} />}

          {/* Kept mounted only while active; the panel fetches its own endpoint
              (one AI synthesis call, content-hash cached server-side) and reuses
              the thesis's refresh signal so an executed trade re-runs it. */}
          {effectiveTab === "intelligence" && (
            <IntelligencePanel enabled refreshSignal={thesisRefreshSignal} />
          )}

          {effectiveTab === "simulator" && <SimulatorPanel realPortfolioHasHoldings={true} />}

          {effectiveTab === "optimize" && (
            <OptimizePanel
              optimization={report.optimization}
              objective={objective}
              onObjectiveChange={setObjective}
              objectives={OBJECTIVES}
              loading={loading}
              totalPortfolioValue={report.totalValue}
              baseCurrency={report.baseCurrency}
              atEquilibrium={report.atEquilibrium}
              onExecuted={() => {
                refresh();
                setThesisRefreshSignal((n) => n + 1);
              }}
            />
          )}
        </div>
      )}

      <AddHoldingDialog
        open={showAdd}
        onClose={() => setShowAdd(false)}
        onSaved={refresh}
      />
      <ImportScreenshotDialog
        open={showImport}
        onClose={() => setShowImport(false)}
        onApplied={() => {
          refresh();
          setThesisRefreshSignal((n) => n + 1);
        }}
      />
    </PageShell>
  );
}
