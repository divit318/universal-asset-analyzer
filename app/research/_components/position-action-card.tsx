import Link from "next/link";
import { computePositionAction, type PositionAction } from "@/lib/position-action";
import type { PortfolioFitAnalysis } from "@/lib/ios/types";
import { formatCurrency } from "@/lib/format";

const KIND_STYLE: Record<PositionAction["kind"], { label: string; tone: string; badge: string }> = {
  initiate: { label: "Initiate", tone: "text-positive", badge: "text-positive border-positive/40 bg-positive/10" },
  add: { label: "Add", tone: "text-positive", badge: "text-positive border-positive/40 bg-positive/10" },
  trim: { label: "Trim", tone: "text-warning", badge: "text-warning border-warning/40 bg-warning/10" },
  exit: { label: "Exit", tone: "text-negative", badge: "text-negative border-negative/40 bg-negative/10" },
  hold: { label: "Hold", tone: "text-muted", badge: "text-muted border-border bg-surface-2" },
  avoid: { label: "Skip", tone: "text-muted", badge: "text-muted border-border bg-surface-2" },
};

/**
 * The sized, portfolio-aware next step for the stock being researched. Turns the
 * fit scorer's suggested weight into a concrete order in shares at the live
 * price, with the resulting portfolio impact — the bridge from "interesting" to
 * "done".
 */
export function PositionActionCard({
  symbol,
  price,
  currency,
  portfolioValue,
  currentShares,
  fit,
}: {
  symbol: string;
  price: number;
  currency: string | null;
  portfolioValue: number;
  /** Read from the already-loaded IOS report by the caller — see the comment
   *  at its call site in research/page.tsx for why this isn't fetched here. */
  currentShares: number;
  fit: PortfolioFitAnalysis;
}) {
  // Needs a real portfolio to size against; the fit panel covers the generic case.
  if (portfolioValue <= 0 || price <= 0) return null;

  const action = computePositionAction({
    symbol,
    price,
    portfolioValue,
    currentShares,
    targetPct: fit.suggestedAllocationPct,
    fitTier: fit.fitTier,
    isInPortfolio: fit.isInPortfolio,
    concentrationWarning: fit.concentrationWarning,
  });

  const style = KIND_STYLE[action.kind];
  const barMax = Math.max(action.currentPct, action.targetPct, 1);

  return (
    <div className="flex flex-col gap-3 rounded-card border border-border bg-surface p-4">
      <div className="flex items-center justify-between">
        <span className="text-micro font-semibold uppercase tracking-widest text-faint">Next action</span>
        <span className={`rounded-control border px-2 py-0.5 text-xs font-semibold uppercase ${style.badge}`}>
          {style.label}
        </span>
      </div>

      <div className="flex flex-col gap-0.5">
        <span className={`text-lg font-semibold ${style.tone}`}>{action.headline}</span>
        <span className="text-sm text-muted">{action.detail}</span>
      </div>

      {/* Current → target weight */}
      {(action.currentPct > 0 || action.targetPct > 0) && (
        <div className="flex flex-col gap-1">
          <div className="flex justify-between text-micro text-faint">
            <span>Current {action.currentPct.toFixed(1)}%</span>
            <span>Target {action.targetPct.toFixed(1)}%</span>
          </div>
          <div className="relative h-1.5 overflow-hidden rounded-full bg-surface-2">
            <div className="absolute inset-y-0 left-0 rounded-full bg-muted/50" style={{ width: `${(action.currentPct / barMax) * 100}%` }} />
            <div className="absolute inset-y-0 w-0.5 bg-brand" style={{ left: `${(action.targetPct / barMax) * 100}%` }} />
          </div>
          <p className="text-[10px] text-faint">
            Conviction-sized target from your investment policy (fit score, sector caps, diversification) — if a Portfolio Decision target appears below, that one only rebalances among your current holdings, so the two can differ.
          </p>
        </div>
      )}

      {action.concentrationWarning && (
        <p className="rounded-md bg-warning/10 px-2 py-1.5 text-xs text-warning">
          ⚠ Reaching this weight would concentrate your portfolio — consider sizing smaller.
        </p>
      )}

      <div className="flex items-center justify-between border-t border-border pt-2.5 text-xs">
        <span className="text-faint">
          {action.currentShares > 0
            ? `Holding ${action.currentShares} @ ${formatCurrency(price, currency ?? undefined)}`
            : `At ${formatCurrency(price, currency ?? undefined)}`}
        </span>
        <Link href={`/journal?symbol=${encodeURIComponent(symbol)}`} className="font-medium text-brand hover:underline">
          Log this decision →
        </Link>
      </div>
    </div>
  );
}
