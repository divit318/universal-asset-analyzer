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
import { useSearchParams } from "next/navigation";
import { useDataset } from "@/lib/platform/client/use-dataset";
import {
  PageShell,
  PageHeader,
  StatTile,
  Button,
  Tabs,
  Badge,
  Card,
  type TabItem,
} from "@/app/_components/ui";
import { formatCurrency } from "@/lib/format";
import type { UniversalPortfolioReport } from "@/lib/portfolio/report";
import { OBJECTIVES, type Objective } from "@/lib/portfolio/engines/optimize";

import { AllocationPanel } from "./_components/universal/allocation-panel";
import { DecisionCenter } from "./_components/universal/decision-center";
import { HoldingsPanel } from "./_components/universal/holdings-panel";
import { RiskLab } from "./_components/universal/risk-lab";
import { HealthPanel } from "./_components/universal/health-panel";
import { OptimizePanel } from "./_components/universal/optimize-panel";
import { CashPanel } from "./_components/universal/cash-panel";
import { AddHoldingDialog } from "./_components/universal/add-holding-dialog";
import { PortfolioThesisBanner } from "./_components/universal/portfolio-thesis";
import { PipelineBoard } from "./_components/pipeline-board";
import { ArrivalHighlight, useArrivalTarget } from "@/app/_components/arrival-highlight";

type Tab = "dashboard" | "decisions" | "holdings" | "pipeline" | "risk" | "optimize";

const TABS: TabItem<Tab>[] = [
  { id: "dashboard", label: "Dashboard" },
  { id: "decisions", label: "Decisions" },
  { id: "holdings",  label: "Holdings"  },
  { id: "pipeline",  label: "Pipeline"  },
  { id: "risk",      label: "Risk Lab"  },
  { id: "optimize",  label: "Optimize"  },
];

const TAB_IDS: string[] = TABS.map((t) => t.id);

/**
 * Mirrors the real layout — five KPI tiles, the tab strip, then two panel
 * columns — so the page does not visibly reflow when data lands. A generic stack
 * of four bars is only marginally better than a blank screen, and this page takes
 * several seconds to price a whole book.
 */
function Skeleton() {
  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="h-[86px] animate-pulse rounded-card border border-border bg-surface" />
        ))}
      </div>
      <div className="h-9 w-full max-w-md animate-pulse rounded-control bg-surface-2" />
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="h-80 animate-pulse rounded-card border border-border bg-surface" />
        <div className="h-80 animate-pulse rounded-card border border-border bg-surface" />
      </div>
    </div>
  );
}

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
  const [showAdd, setShowAdd] = useState(false);
  const highlightTarget = useArrivalTarget();
  const searchParams = useSearchParams();

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
      const res = await fetch(`/api/portfolio/report?objective=${objective}`, { signal });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to load portfolio");
      return json as UniversalPortfolioReport;
    },
    [objective],
  );

  // Keying on the objective means switching it cancels the in-flight request for
  // the old one rather than racing it.
  const { data: report, error, isInitialLoading, revalidating, refresh } =
    useDataset<UniversalPortfolioReport>("portfolioReport", objective, fetcher);

  const loading = isInitialLoading || revalidating;
  const empty = !isInitialLoading && !error && (!report || report.holdingCount === 0);

  return (
    <PageShell width="wide">
      <ArrivalHighlight targetId={highlightTarget} />
      <PageHeader
        title="Portfolio"
        description="Your entire net investable portfolio — every asset class, one system."
        actions={
          <Button variant="primary" size="md" onClick={() => setShowAdd(true)}>
            Add holding
          </Button>
        }
      />

      {error && (
        <Card className="flex items-center justify-between gap-3 border-negative/25 bg-negative/5 p-4">
          <p className="text-xs text-negative">{error}</p>
          <button onClick={refresh} className="text-xs text-brand hover:underline">
            Retry
          </button>
        </Card>
      )}

      {isInitialLoading && <Skeleton />}

      {empty && (
        <Card className="flex flex-col items-center gap-3 p-12 text-center">
          <p className="text-sm font-semibold text-foreground">No holdings yet.</p>
          <p className="max-w-md text-xs leading-relaxed text-muted">
            Add equities, ETFs, bonds, crypto, commodities or cash here. Real estate,
            private markets and alternatives are added through the Research Hub and
            appear here automatically.
          </p>
          <Button variant="primary" size="md" onClick={() => setShowAdd(true)}>
            Add your first holding →
          </Button>
        </Card>
      )}

      {report && report.holdingCount > 0 && (
        <div className="flex flex-col gap-5">
          <PortfolioThesisBanner enabled={report.holdingCount > 0} refreshSignal={thesisRefreshSignal} />

          {/* ── Headline ── */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <StatTile
              label="Total value"
              value={formatCurrency(report.totalValue)}
              sublabel={`${report.holdingCount} holdings · ${report.allocation.byAssetClass.slices.length} asset classes`}
            />
            <StatTile
              label="Total return"
              value={`${report.totalReturn >= 0 ? "+" : ""}${report.totalReturn.toFixed(1)}%`}
              sublabel={formatCurrency(report.totalReturnDollar)}
              tone={report.totalReturn >= 0 ? "positive" : "negative"}
            />
            <StatTile
              label="Today"
              value={`${report.todayChangePct >= 0 ? "+" : ""}${report.todayChangePct.toFixed(2)}%`}
              sublabel={formatCurrency(report.todayChangeDollar)}
              tone={report.todayChangePct >= 0 ? "positive" : "negative"}
            />
            {/* Income counts coupons, rent, staking and interest — not just dividends. */}
            <StatTile
              label="Annual income"
              value={formatCurrency(report.annualIncome)}
              sublabel={`${report.incomeYieldPct.toFixed(2)}% yield`}
            />
            <StatTile
              label="Health"
              value={`${report.health.total} ${report.health.grade}`}
              sublabel={`${report.health.coveragePct}% of dimensions applicable`}
              tone={report.health.total >= 70 ? "positive" : report.health.total >= 50 ? "default" : "warning"}
            />
          </div>

          {/* ── Data-quality disclosure ──────────────────────────────────────────
              A portfolio that is largely self-reported marks has a "total value" that
              is largely the user's own opinion, and every percentage above inherits
              that softness. We say so instead of presenting it with the authority of a
              marked-to-market number. */}
          {report.marketPricedPct < 95 && (
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
          )}

          {/* ── Concentration warnings ── */}
          {report.concentration.length > 0 && (
            <div className="flex flex-col gap-1.5">
              {report.concentration.slice(0, 3).map((c, i) => (
                <div
                  key={i}
                  className={`flex items-start gap-2 rounded-lg border px-3.5 py-2.5 ${
                    c.severity === "high"
                      ? "border-negative/25 bg-negative/[0.04]"
                      : "border-warning/25 bg-warning/[0.04]"
                  }`}
                >
                  <Badge variant={c.severity === "high" ? "negative" : "warning"}>
                    {c.type}
                  </Badge>
                  <p className="text-xs leading-relaxed text-muted">{c.message}</p>
                </div>
              ))}
            </div>
          )}

          <Tabs tabs={TABS} active={tab} onChange={setTab} layoutId="portfolio-universal-tabs" />

          {tab === "dashboard" && (
            <div className="flex flex-col gap-4">
              <AllocationPanel allocation={report.allocation} />
              <HealthPanel health={report.health} />
            </div>
          )}

          {tab === "decisions" && (
            <div className="flex flex-col gap-5">
              <DecisionCenter
                decisions={report.decisions}
                health={report.health}
                risk={report.risk}
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

          {tab === "holdings" && (
            <HoldingsPanel
              holdings={report.holdings}
              totalValue={report.totalValue}
              onChanged={() => { refresh(); setThesisRefreshSignal((n) => n + 1); }}
            />
          )}

          {tab === "pipeline" && <PipelineBoard />}

          {tab === "risk" && <RiskLab risk={report.risk} scenarios={report.scenarios} />}

          {tab === "optimize" && (
            <OptimizePanel
              optimization={report.optimization}
              objective={objective}
              onObjectiveChange={setObjective}
              objectives={OBJECTIVES}
              loading={loading}
              totalPortfolioValue={report.totalValue}
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
    </PageShell>
  );
}
