import { Button, Card, Skeleton } from "@/app/_components/ui";
import { formatCurrency } from "@/lib/format";
import type { ConfidenceTier } from "@/lib/portfolio/engines/position-size";
import type { BuyRecommendationResponse } from "./types";

/**
 * State 2A — the optimizer's answer, presented as a finished decision rather
 * than a control panel: a conviction-tiered headline (Strong Buy allocation /
 * Recommended allocation / Starter position), the amount, the shares it buys,
 * the weight it lands the position at, the measured/estimated portfolio impact,
 * and the grounded reasons. Nothing here is adjustable; adjusting is what
 * Manual Allocation is for.
 *
 * The non-BUY states matter as much as the happy path. A HOLD is a real,
 * reportable recommendation — rendered with its quantitative reasons (research
 * verdict, class weights, conviction size), never a generic shrug.
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
  // position-size.ts and states the binding constraint or the research
  // verdict; `reasons` carries the quantitative drivers behind it.
  if (recommendation.action !== "BUY" || recommendation.recommendedAmount <= 0) {
    return (
      <Card className="flex flex-col gap-3 p-4" role="status">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <span className="text-[13px] font-semibold text-foreground">
            {recommendation.headline?.title ?? "The optimizer recommends waiting"}
          </span>
          <ConfidenceBadge tier={recommendation.confidenceTier} value={recommendation.confidence} />
        </div>
        <p className="text-[12px] leading-relaxed text-muted">
          {recommendation.holdReason ??
            "Adding to this position wouldn't improve your portfolio given your current targets, concentration limits and available cash."}
        </p>
        <ReasonsList reasons={recommendation.reasons} />
      </Card>
    );
  }

  const { recommendedAmount, recommendedShares, recommendedAllocationPct: weightAfter } = recommendation;
  const weightBefore = recommendation.before.holdings.find(
    (h) => h.symbol?.toUpperCase() === recommendation.symbol.toUpperCase(),
  )?.weight ?? 0;
  const weightDelta = weightAfter - weightBefore;
  const withinCap = weightAfter <= maxHoldingPct;
  const sectorMove = sectorMoveOf(recommendation);

  return (
    <Card className={`flex flex-col gap-4 p-4 transition-opacity ${loading ? "opacity-60" : ""}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[13px] font-semibold text-foreground">
          {recommendation.headline?.title ?? "Recommended allocation"}
        </span>
        <ConfidenceBadge tier={recommendation.confidenceTier} value={recommendation.confidence} />
      </div>

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

      {/* Expected impact — measured (alignment, volatility) and estimated (expected return, labeled as such). */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 border-t border-border/60 pt-3 sm:grid-cols-3">
        {recommendation.expectedReturn && (
          <ImpactStat
            label="Expected return"
            value={`${recommendation.expectedReturn.portfolioDeltaPct >= 0 ? "+" : ""}${recommendation.expectedReturn.portfolioDeltaPct.toFixed(2)} pp/yr`}
            tone={recommendation.expectedReturn.portfolioDeltaPct >= 0 ? "positive" : "negative"}
            title={recommendation.expectedReturn.basis}
          />
        )}
        {recommendation.impact.riskDelta != null && (
          <ImpactStat
            label="Volatility"
            value={`${recommendation.impact.riskDelta >= 0 ? "+" : ""}${recommendation.impact.riskDelta.toFixed(1)} pp`}
            tone={recommendation.impact.riskDelta <= 0 ? "positive" : "neutral"}
          />
        )}
        {/* Null when either side is unscorable — the stat is omitted rather than shown as 0. */}
        {recommendation.impact.alignmentDelta != null && (
          <ImpactStat
            label="Portfolio alignment"
            value={`${recommendation.impact.alignmentDelta >= 0 ? "+" : ""}${recommendation.impact.alignmentDelta.toFixed(1)} pts`}
            tone={recommendation.impact.alignmentDelta >= 0 ? "positive" : "negative"}
          />
        )}
        {recommendation.correlationWithHoldings != null && (
          <ImpactStat
            label="Correlation"
            value={`r=${recommendation.correlationWithHoldings.toFixed(2)}`}
            tone={Math.abs(recommendation.correlationWithHoldings) <= 0.4 ? "positive" : "neutral"}
            title="Highest return correlation against your existing large holdings."
          />
        )}
        {sectorMove && (
          <ImpactStat label={sectorMove.sector} value={`${sectorMove.before.toFixed(1)}% → ${sectorMove.after.toFixed(1)}%`} tone="neutral" />
        )}
      </div>

      <div className="flex flex-col gap-1.5 border-t border-border/60 pt-3">
        <span className="text-xs font-semibold text-foreground">Why this amount?</span>
        <p className="text-[12px] leading-relaxed text-muted">{recommendation.aiExplanation || recommendation.summary}</p>
        <ReasonsList reasons={recommendation.reasons} />
      </div>
    </Card>
  );
}

/** The target's own sector weight, before → after, when the trade moves it visibly. */
function sectorMoveOf(rec: BuyRecommendationResponse): { sector: string; before: number; after: number } | null {
  const holding = rec.after.holdings.find((h) => h.symbol?.toUpperCase() === rec.symbol.toUpperCase());
  const sector = holding?.attributes.sector;
  if (!sector) return null;
  const before = rec.before.allocation.bySector.slices.find((s) => s.key === sector)?.weight ?? 0;
  const after = rec.after.allocation.bySector.slices.find((s) => s.key === sector)?.weight ?? 0;
  return Math.abs(after - before) >= 0.1 ? { sector, before, after } : null;
}

const TIER_LABEL: Record<ConfidenceTier, string> = { high: "High", medium: "Medium", low: "Low" };
const TIER_TONE: Record<ConfidenceTier, string> = {
  high: "text-positive border-positive/40 bg-positive/10",
  medium: "text-warning border-warning/40 bg-warning/10",
  low: "text-muted border-border bg-surface-2",
};

function ConfidenceBadge({ tier, value }: { tier: ConfidenceTier; value: number }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${TIER_TONE[tier]}`}
      title={`Recommendation confidence: ${value}/100 — blends the research score's own confidence with portfolio data coverage.`}
    >
      {TIER_LABEL[tier]} confidence
    </span>
  );
}

function ImpactStat({ label, value, tone, title }: { label: string; value: string; tone: "positive" | "negative" | "neutral"; title?: string }) {
  const toneClass = tone === "positive" ? "text-positive" : tone === "negative" ? "text-negative" : "text-foreground";
  return (
    <div className="flex flex-col" title={title}>
      <span className="text-[10px] uppercase tracking-wider text-muted/70">{label}</span>
      <span className={`font-mono text-[13px] font-semibold ${toneClass}`}>{value}</span>
    </div>
  );
}

function ReasonsList({ reasons }: { reasons: string[] }) {
  if (reasons.length === 0) return null;
  return (
    <ul className="flex flex-col gap-1">
      {reasons.map((r) => (
        <li key={r} className="flex gap-1.5 text-[12px] leading-relaxed text-muted">
          <span aria-hidden className="mt-[1px] text-muted/60">•</span>
          <span>{r}</span>
        </li>
      ))}
    </ul>
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
  onRetry,
}: {
  title: string;
  body: string;
  onRetry?: () => void;
}) {
  return (
    <Card className="flex flex-col gap-3 border-warning/30 bg-warning/5 p-4" role="status">
      <div className="flex flex-col gap-1">
        <span className="text-[13px] font-semibold text-warning">{title}</span>
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
