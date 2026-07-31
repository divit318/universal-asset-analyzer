import { Button, Card, Skeleton } from "@/app/_components/ui";
import { formatCurrency } from "@/lib/format";
import type { BuyRecommendationResponse } from "./types";

/**
 * State 2A — the optimizer's answer, presented as a finished decision rather
 * than a control panel: the amount, the shares it buys, the weight it lands
 * the position at, and one plain-English paragraph of why. Nothing here is
 * adjustable; adjusting is what Manual Allocation is for.
 *
 * The three non-BUY states matter as much as the happy path. The old modal
 * rendered nothing at all when the engine declined to size a position, which
 * is what made "recommend the optimal amount" look broken — it had in fact
 * answered, and the answer was "not right now", with a reason nobody showed.
 */
export function RecommendedAllocation({
  recommendation,
  loading,
  error,
  currency,
  maxHoldingPct,
  onRetry,
}: {
  recommendation: BuyRecommendationResponse | null;
  loading: boolean;
  error: string | null;
  currency: string;
  /** The concentration cap the sizing engine itself respected — shown so the weight has a reference point. */
  maxHoldingPct: number;
  onRetry: () => void;
}) {
  if (loading && !recommendation) {
    return (
      <Card className="flex flex-col gap-3 p-4" aria-busy="true">
        <Skeleton height="h-3" width="w-40" />
        <Skeleton height="h-8" width="w-52" />
        <Skeleton height="h-3" />
        <Skeleton height="h-3" width="w-4/5" />
        <span className="sr-only">Calculating your recommended allocation…</span>
      </Card>
    );
  }

  // The optimizer failed outright (network, no live price, engine throw). Never
  // fail silently — say what happened and offer both ways forward.
  if (error) {
    return (
      <UnavailableCard
        title="Couldn't calculate a recommendation"
        body={error}
        onRetry={onRetry}
      />
    );
  }

  if (!recommendation) {
    return (
      <UnavailableCard
        title="No recommendation available"
        body="The optimizer returned no result for this asset. You can retry, or size the position yourself."
        onRetry={onRetry}
      />
    );
  }

  // The optimizer succeeded and its answer is "don't add here" — a real,
  // reportable recommendation, not an error. holdReason comes from
  // position-size.ts and already states the binding constraint.
  if (recommendation.action !== "BUY" || recommendation.recommendedAmount <= 0) {
    return (
      <UnavailableCard
        title="The optimizer doesn't recommend adding here"
        body={
          recommendation.holdReason ??
          "Adding to this position wouldn't improve your portfolio given your current targets, concentration limits and available cash."
        }
        tone="neutral"
      />
    );
  }

  const { recommendedAmount, recommendedShares, recommendedAllocationPct: weightAfter } = recommendation;
  const weightBefore = recommendation.before.holdings.find(
    (h) => h.symbol?.toUpperCase() === recommendation.symbol.toUpperCase(),
  )?.weight ?? 0;
  const weightDelta = weightAfter - weightBefore;
  const withinCap = weightAfter <= maxHoldingPct;

  return (
    <Card className={`flex flex-col gap-4 p-4 transition-opacity ${loading ? "opacity-60" : ""}`}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <span className="text-label uppercase tracking-widest text-muted/70">Recommended investment</span>
          <span className="font-mono text-2xl font-bold leading-none">{formatCurrency(recommendedAmount, currency)}</span>
          {recommendedShares != null && (
            <span className="text-[11px] text-muted">
              ≈{recommendedShares.toLocaleString(undefined, { maximumFractionDigits: 4 })} shares
            </span>
          )}
        </div>

        <div className="flex flex-col gap-1 sm:items-end">
          <span className="text-label uppercase tracking-widest text-muted/70">New portfolio weight</span>
          <span className="flex items-baseline gap-2">
            <span className="font-mono text-2xl font-bold leading-none">{weightAfter.toFixed(2)}%</span>
            {Math.abs(weightDelta) >= 0.01 && (
              <span className={`text-xs font-medium ${weightDelta >= 0 ? "text-positive" : "text-negative"}`}>
                {weightDelta >= 0 ? "+" : ""}{weightDelta.toFixed(2)}%
              </span>
            )}
          </span>
          <span className={`flex items-center gap-1 text-[11px] ${withinCap ? "text-positive" : "text-warning"}`}>
            <svg width="12" height="12" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              {withinCap ? <path d="M4 10l4 4 8-8" /> : <path d="M10 5v6M10 14.5v.5" />}
            </svg>
            {withinCap ? `Within your ${maxHoldingPct}% limit` : `Exceeds your ${maxHoldingPct}% limit`}
          </span>
        </div>
      </div>

      <div className="flex flex-col gap-1.5 border-t border-border/60 pt-3">
        <span className="text-xs font-semibold text-foreground">Why this amount?</span>
        <p className="text-[12px] leading-relaxed text-muted">{recommendation.aiExplanation || recommendation.summary}</p>
      </div>
    </Card>
  );
}

/**
 * No "choose an amount myself" button here on purpose — in every one of these
 * states the modal's own primary CTA becomes exactly that, so repeating it
 * inside the card would put two identical next actions on one screen. Retry
 * stays local because it only applies to the two failure states, not to a
 * legitimate HOLD.
 */
function UnavailableCard({
  title,
  body,
  tone = "warning",
  onRetry,
}: {
  title: string;
  body: string;
  tone?: "warning" | "neutral";
  onRetry?: () => void;
}) {
  return (
    <Card
      className={`flex flex-col gap-3 p-4 ${tone === "warning" ? "border-warning/30 bg-warning/5" : ""}`}
      role="status"
    >
      <div className="flex flex-col gap-1">
        <span className={`text-[13px] font-semibold ${tone === "warning" ? "text-warning" : "text-foreground"}`}>{title}</span>
        <p className="text-[12px] leading-relaxed text-muted">{body}</p>
      </div>
      {onRetry && (
        <Button variant="secondary" onClick={onRetry} className="w-fit">
          Try again
        </Button>
      )}
    </Card>
  );
}
