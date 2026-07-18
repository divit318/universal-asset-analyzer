"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Dialog } from "@/app/_components/dialog";
import { Button, Field, Input, Card } from "@/app/_components/ui";
import { PortfolioFitBadge } from "@/app/_components/portfolio-fit-badge";
import { useFreshQuote } from "@/app/_components/use-fresh-quote";
import { formatCurrency } from "@/lib/format";
import type { PortfolioFitAnalysis } from "@/lib/ios/types";
import type { Objective } from "@/lib/portfolio/engines/optimize";
import { DEFAULT_CONSTRAINTS } from "@/lib/portfolio/engines/optimize";
import { useBuyRecommendation } from "./recommendation/use-buy-recommendation";
import { AllocationChoice, type EntryMode } from "./recommendation/smart-entry";
import { RecommendedAllocation } from "./recommendation/recommended-allocation";
import { ManualAllocation, type SizingMode } from "./recommendation/manual-allocation";
import { ExistingPositionNote } from "./recommendation/existing-position-note";
import { FundingSourcePanel } from "./recommendation/funding-source";
import { ImpactComparison } from "./recommendation/impact-comparison";
import { AssetHeader } from "./recommendation/asset-header";
import { BeforeAfter, CollapsibleSection } from "./recommendation/metric-row";
import { describeRiskDelta, GRADE_TONE } from "./recommendation/format";
import { buildTransactionWarnings } from "@/lib/portfolio/engines/position-size-explain";
import type { FundingSource, SellSuggestion } from "./recommendation/types";
import type { DecisionHorizon } from "@/lib/types";

type Stage = "review" | "confirm";

interface BuyResult {
  symbol: string;
  shares: number;
  price: number;
  currency: string;
  assetClass: string;
  totalCost: number;
  healthBefore: number | null;
  healthAfter: number | null;
}

/**
 * The single objective every recommendation in this modal is computed under.
 * The modal used to make the user choose between conservative/balanced/
 * aggressive before it would show them a number — a choice that either
 * duplicated Recommended Allocation (the engine already weighs risk) or
 * duplicated Manual Allocation (the user is already naming the amount). It is
 * now a fixed, documented default instead of a question.
 */
const OBJECTIVE: Objective = "maximize_sharpe";

const LAST_BROKER_KEY = "uaa:lastBroker";
const LAST_ACCOUNT_KEY = "uaa:lastAccount";

/** Local calendar date, not UTC — toISOString() would show "yesterday" for anyone west of UTC in the evening. */
function todayStr() {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Greedily reuses the server-picked sell recommendations to cover an arbitrary shortfall — used when the user sizes past available cash. */
function pickSellsForShortfall(sellSuggestions: SellSuggestion[], shortfall: number) {
  const out: { holdingId: string; amount: number; reason: string }[] = [];
  let remaining = shortfall;
  for (const s of sellSuggestions) {
    if (remaining <= 0) break;
    const amount = Math.min(s.amount, remaining);
    if (amount <= 0) continue;
    out.push({ holdingId: s.holdingId, amount, reason: s.rationale });
    remaining -= amount;
  }
  return out;
}

export function AddToPortfolioModal({
  item,
  fit,
  onClose,
  onSuccess,
}: {
  item: { symbol: string; name: string };
  fit?: PortfolioFitAnalysis;
  onClose: () => void;
  onSuccess: (result: BuyResult) => void;
}) {
  const router = useRouter();
  const { quote, loading: quoteLoading } = useFreshQuote(item.symbol, true);

  // `null` until the user answers "how would you like to invest?" — that
  // unanswered state is what keeps the opening view to a stock summary, a fit
  // badge and one question.
  const [entryMode, setEntryMode] = useState<EntryMode | null>(null);
  const [fundingSource, setFundingSource] = useState<FundingSource>("cash");
  const [sizingMode, setSizingMode] = useState<SizingMode>("amount");
  const [manualValue, setManualValue] = useState("");
  const [showDetails, setShowDetails] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BuyResult | null>(null);
  const [stage, setStage] = useState<Stage>("review");
  const submittingRef = useRef(false);

  // Optional transaction metadata — all opt-in, none required to submit. Trade
  // date defaults to today and broker/account recall the last values typed
  // (client-only — there is no "accounts" table to look up), so a routine
  // purchase never asks for anything beyond a symbol and an amount.
  const [tradeDate, setTradeDate] = useState(todayStr);
  const [broker, setBroker] = useState("");
  const [account, setAccount] = useState("");
  const [commission, setCommission] = useState("");
  const [taxes, setTaxes] = useState("");
  const [fees, setFees] = useState("");
  const [thesis, setThesis] = useState("");
  const [targetPrice, setTargetPrice] = useState("");
  const [horizon, setHorizon] = useState<DecisionHorizon | "">("");
  const [conviction, setConviction] = useState<number>(3);

  /* eslint-disable react-hooks/set-state-in-effect -- one-time client-only recall, no SSR equivalent */
  useEffect(() => {
    try {
      const savedBroker = localStorage.getItem(LAST_BROKER_KEY);
      const savedAccount = localStorage.getItem(LAST_ACCOUNT_KEY);
      if (savedBroker) setBroker(savedBroker);
      if (savedAccount) setAccount(savedAccount);
    } catch {
      // Storage may be unavailable (private browsing) — defaults just stay empty.
    }
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  // ---- Data ----
  // One baseline fetch (the engine's own optimal size) drives Recommended
  // Allocation and supplies the portfolio context — cash, existing weight,
  // total value — that Manual Allocation sizes against. It starts immediately
  // on open rather than waiting for the entry-mode answer, so picking
  // "Recommended Allocation" reveals a finished number instead of a spinner.
  const {
    recommendation: baseline,
    loading: baselineLoading,
    error: baselineError,
    refetch: refetchBaseline,
  } = useBuyRecommendation(item.symbol, item.name, OBJECTIVE);

  const price = quote?.price ?? baseline?.price ?? null;
  const currency = quote?.currency ?? "USD";
  const portfolioValue = baseline?.before.totalValue ?? 0;
  const cashAvailable = baseline?.cashAvailable ?? 0;
  const existingHolding = baseline?.before.holdings.find((h) => h.symbol === item.symbol) ?? null;
  const existingValueBase = existingHolding?.valuation.valueBase ?? 0;

  const numericManual = parseFloat(manualValue.replace(/,/g, ""));
  const validManual = Number.isFinite(numericManual) && numericManual > 0;

  const manualAmount = useMemo(() => {
    if (!validManual || price == null) return null;
    switch (sizingMode) {
      case "amount": return numericManual;
      case "quantity": return numericManual * price;
      case "pctPortfolio": return portfolioValue > 0 ? (numericManual / 100) * portfolioValue : null;
      case "pctCash": return cashAvailable > 0 ? (numericManual / 100) * cashAvailable : null;
    }
  }, [validManual, price, sizingMode, numericManual, portfolioValue, cashAvailable]);

  // Live Preview: only fetches in manual mode with a valid amount — otherwise
  // `current` reuses `baseline` rather than redundantly re-requesting the
  // recommendation we already hold.
  const previewEnabled = entryMode === "manual" && manualAmount != null && manualAmount > 0;
  const { recommendation: preview, loading: previewLoading } = useBuyRecommendation(
    item.symbol, item.name, OBJECTIVE, manualAmount ?? undefined, previewEnabled,
  );
  const current = previewEnabled ? preview : baseline;

  const recommendationUsable = baseline != null && baseline.action === "BUY" && baseline.recommendedAmount > 0;

  const finalAmount = entryMode === "manual"
    ? manualAmount
    : recommendationUsable ? baseline!.recommendedAmount : null;
  const finalShares = finalAmount != null && price ? finalAmount / price : null;

  // Once baseline loads, default Funding Source to whatever actually covers
  // the recommended amount without requiring the user to think about it.
  const defaultedFundingRef = useRef(false);
  useEffect(() => {
    if (!baseline || defaultedFundingRef.current) return;
    defaultedFundingRef.current = true;
    if (!baseline.fundingFullyCoveredByCash && baseline.sellSuggestions.length > 0) {
      /* eslint-disable-next-line react-hooks/set-state-in-effect -- syncing to an async recommendation result, once */
      setFundingSource("optimizer_decides");
    }
  }, [baseline]);

  // The resulting weight is read from `current.recommendedAllocationPct` —
  // simulate.ts's "buy" change models adding exposure without also modeling
  // where the money came from (funding is tracked separately, deliberately —
  // see position-size.ts's header), so `after`'s total is NOT the same total a
  // naive (existing + amount) / before.totalValue calculation would assume.
  // Only fall back to that estimate when `current` hasn't caught up to the
  // amount actually on screen yet (mid-debounce) — self-corrects within one
  // fetch cycle either way.
  const currentMatchesAmount = current != null && finalAmount != null && Math.round(current.recommendedAmount) === Math.round(finalAmount);
  const estimatedAllocationPct = finalAmount != null && portfolioValue > 0
    ? ((existingValueBase + finalAmount) / portfolioValue) * 100
    : null;
  const finalAllocationPct = currentMatchesAmount ? current!.recommendedAllocationPct : estimatedAllocationPct;
  const cashRemaining = finalAmount != null ? cashAvailable - finalAmount : null;

  const shortfall = useMemo(() => {
    if (finalAmount == null) return 0;
    return Math.max(0, Math.round(finalAmount - cashAvailable));
  }, [finalAmount, cashAvailable]);

  // ---- Validation ----
  const dateValid = !tradeDate || tradeDate <= todayStr();
  const feesNum = parseFloat(fees);
  const commissionNum = parseFloat(commission);
  const taxesNum = parseFloat(taxes);
  const feesLikeTotal = (Number.isFinite(feesNum) ? feesNum : 0) + (Number.isFinite(commissionNum) ? commissionNum : 0) + (Number.isFinite(taxesNum) ? taxesNum : 0);
  const feesUnrealistic = finalAmount != null && finalAmount > 0 && feesLikeTotal > finalAmount * 0.05;

  const canSubmit = finalAmount != null && finalAmount > 0 && price != null && dateValid &&
    (fundingSource === "cash" ? shortfall <= 0 : true);

  const warnings = useMemo(() => {
    if (!current || finalAllocationPct == null) return [];
    return buildTransactionWarnings(current, finalAllocationPct, DEFAULT_CONSTRAINTS);
  }, [current, finalAllocationPct]);

  const advance = useCallback(() => {
    if (stage === "review" && canSubmit) setStage("confirm");
  }, [stage, canSubmit]);

  const handleEntryModeChange = useCallback((next: EntryMode) => {
    setEntryMode(next);
    setError(null);
  }, []);

  async function submit() {
    if (submittingRef.current || finalAmount == null || !price) return;
    submittingRef.current = true;
    setSubmitting(true);
    setError(null);

    try {
      const sellFirst = fundingSource !== "cash" && shortfall > 0
        ? pickSellsForShortfall(current?.sellSuggestions ?? [], shortfall)
        : undefined;

      const feesToSend = Number.isFinite(feesNum) && feesNum >= 0 ? feesNum : undefined;
      const meta: Record<string, unknown> = { source: "research_buy" };
      if (thesis.trim()) meta.notes = thesis.trim();
      if (broker.trim()) meta.broker = broker.trim();
      if (account.trim()) meta.account = account.trim();
      if (Number.isFinite(commissionNum) && commissionNum >= 0) meta.commission = commissionNum;
      if (Number.isFinite(taxesNum) && taxesNum >= 0) meta.taxes = taxesNum;

      const res = await fetch("/api/portfolio/buy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol: item.symbol,
          name: item.name,
          amount: finalAmount,
          sellFirst,
          objective: OBJECTIVE,
          tradeDate: tradeDate || undefined,
          fees: feesToSend,
          meta,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Purchase failed");

      const buyResult: BuyResult = {
        symbol: json.symbol,
        shares: json.shares,
        price: json.price,
        currency: json.currency,
        assetClass: json.assetClass,
        totalCost: json.totalCost,
        healthBefore: current?.before.health.total ?? null,
        healthAfter: current?.after.health.total ?? null,
      };

      try {
        if (broker.trim()) localStorage.setItem(LAST_BROKER_KEY, broker.trim());
        if (account.trim()) localStorage.setItem(LAST_ACCOUNT_KEY, account.trim());
      } catch {
        // Non-fatal — the purchase already succeeded.
      }

      // Optional: log this purchase as an investment decision when the user
      // supplied any conviction context — reuses the existing Decision Journal
      // (POST /api/decisions) verbatim rather than inventing a parallel record.
      const targetPriceNum = parseFloat(targetPrice);
      if (thesis.trim() || horizon || Number.isFinite(targetPriceNum)) {
        try {
          await fetch("/api/decisions", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              symbol: item.symbol,
              name: item.name,
              action: "buy",
              conviction,
              thesis: thesis.trim() || null,
              priceAt: json.price,
              currency: json.currency,
              targetPrice: Number.isFinite(targetPriceNum) ? targetPriceNum : null,
              horizon: horizon || null,
              fitScore: fit?.fitScore ?? null,
              fitTier: fit?.fitTier ?? null,
            }),
          });
        } catch {
          // The purchase already succeeded — a failed decision log is non-fatal.
        }
      }

      setResult(buyResult);
      onSuccess(buyResult);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Purchase failed");
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  // Enter to advance, Escape already closes via Dialog. Textareas/selects are
  // exempt so Enter still behaves as expected while writing notes or picking
  // a horizon — submit() itself is idempotent against a double-fire (guarded
  // by submittingRef), so this never risks a duplicate purchase.
  useEffect(() => {
    if (result) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "Enter") return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "TEXTAREA" || tag === "SELECT") return;
      if (stage === "review") advance();
      else if (stage === "confirm" && !submitting && canSubmit) void submit();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
    // No dependency array: re-attaches every render so the handler always
    // closes over the latest stage/canSubmit/submit — intentional, not an
    // omission, since submit() itself isn't memoized.
  });

  // ---- Success ----
  if (result) {
    const healthImproved = result.healthBefore != null && result.healthAfter != null && result.healthAfter > result.healthBefore;
    return (
      <Dialog open title="Purchase added successfully" onClose={onClose} className="max-w-md">
        <div className="flex flex-col items-center gap-3 py-2 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-positive/15 text-positive">
            <svg width="22" height="22" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 10l4 4 8-8" />
            </svg>
          </div>
          <p className="text-sm font-semibold">{item.name}</p>
          <p className="font-mono text-xl font-bold">{formatCurrency(result.totalCost, result.currency)}</p>
          <p className="text-xs text-muted">
            {result.shares.toLocaleString(undefined, { maximumFractionDigits: 6 })} sh of {result.symbol} at {formatCurrency(result.price, result.currency)}/share
          </p>
          {result.healthBefore != null && result.healthAfter != null && (
            <div className="mt-1 w-full rounded-lg border border-border bg-surface-2 px-4 py-2">
              <BeforeAfter
                label="Portfolio health"
                before={result.healthBefore.toFixed(0)}
                after={result.healthAfter.toFixed(0)}
                tone={healthImproved ? "positive" : undefined}
              />
            </div>
          )}
          <div className="mt-2 flex w-full flex-col gap-2">
            <Button variant="primary" onClick={() => router.push("/portfolio")} className="w-full">Open Portfolio</Button>
            <Button variant="secondary" onClick={() => router.push(`/research?symbol=${item.symbol}`)} className="w-full">Continue Research</Button>
            <Button variant="secondary" onClick={onClose} className="w-full">Add Another Asset</Button>
          </div>
        </div>
      </Dialog>
    );
  }

  // ---- Confirmation stage: "what changes if I proceed?" ----
  if (stage === "confirm" && current && finalAmount != null && price != null) {
    const after = current.after;
    const before = current.before;
    // Funding from cash spends finalAmount directly; funding via sold holdings
    // first raises `shortfall` in cash, then the same finalAmount is spent.
    const cashAfter = cashAvailable - finalAmount + (fundingSource !== "cash" ? shortfall : 0);
    const divBefore = before.health.dimensions.find((d) => d.name === "Diversification")?.score ?? null;
    const divAfter = after.health.dimensions.find((d) => d.name === "Diversification")?.score ?? null;

    return (
      <Dialog open title={`Confirm purchase — ${item.symbol}`} onClose={onClose} className="max-w-lg">
        <div className="flex flex-col gap-4">
          <div className="rounded-lg border border-border bg-surface-2 p-4">
            <p className="text-sm">
              Buying <span className="font-mono font-semibold">{finalShares?.toLocaleString(undefined, { maximumFractionDigits: 6 })}</span> shares of{" "}
              <span className="font-semibold">{item.name}</span>
            </p>
            <p className="mt-1 text-xs text-muted">Cost: {formatCurrency(finalAmount, currency)} at {formatCurrency(price, currency)}/share</p>
            <p className="mt-1 text-[11px] text-muted">
              {entryMode === "manual" ? "Manual allocation" : "Recommended allocation"}
            </p>
          </div>

          <Card className="flex flex-col gap-0.5 p-4">
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted">What changes</h3>
            <BeforeAfter label="Portfolio health" before={before.health.total.toFixed(0)} after={after.health.total.toFixed(0)} tone={after.health.total >= before.health.total ? "positive" : "negative"} />
            <BeforeAfter label="Portfolio grade" before={before.health.grade} after={after.health.grade} tone={GRADE_TONE[after.health.grade]} />
            {divBefore != null && divAfter != null && (
              <BeforeAfter label="Diversification" before={divBefore.toFixed(0)} after={divAfter.toFixed(0)} tone={divAfter >= divBefore ? "positive" : "negative"} />
            )}
            <BeforeAfter label="Cash" before={formatCurrency(cashAvailable)} after={formatCurrency(cashAfter)} tone={cashAfter < 0 ? "negative" : undefined} />
            <BeforeAfter
              label="Largest holding"
              before={`${before.risk.topHoldingWeight.toFixed(1)}%`}
              after={`${after.risk.topHoldingWeight.toFixed(1)}%`}
              tone={after.risk.topHoldingWeight > before.risk.topHoldingWeight + 0.5 ? "negative" : undefined}
            />
            <div className="mt-1 flex items-center justify-between border-t border-border/60 pt-1.5 text-[12px]">
              <span className="text-muted">Risk</span>
              <span className="font-mono font-semibold">{describeRiskDelta(current.impact.riskDelta)}</span>
            </div>
            <div className="flex items-center justify-between text-[12px]">
              <span className="text-muted">Income</span>
              <span className="font-mono font-semibold">
                {current.impact.incomeDelta >= 0 ? "+" : "−"}{formatCurrency(Math.abs(current.impact.incomeDelta))}/yr
              </span>
            </div>
          </Card>

          {warnings.length > 0 && (
            <ul className="flex flex-col gap-1 rounded-lg border border-warning/30 bg-warning/5 p-3">
              {warnings.map((w) => (
                <li key={w} className="text-[11px] leading-relaxed text-warning">⚠ {w}</li>
              ))}
            </ul>
          )}

          {error && <p className="text-xs text-negative">{error}</p>}

          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setStage("review")} disabled={submitting} className="flex-1">Back</Button>
            <Button variant="primary" onClick={() => void submit()} disabled={submitting || quoteLoading || !canSubmit} className="flex-[2]">
              {submitting ? "Placing order…" : `Confirm — ${formatCurrency(finalAmount, currency)}`}
            </Button>
          </div>
        </div>
      </Dialog>
    );
  }

  // ---- Review stage ----
  // The primary CTA names exactly what happens next at this point in the flow:
  // nothing chosen yet -> Continue (inert); recommended -> the purchase itself,
  // since the panel above already *is* the review; manual -> the review step,
  // because a hand-typed number deserves a confirmation screen.
  // When the optimizer declines (or fails), the next action is not a dead
  // "Buy" button — it is switching to Manual Allocation, so the CTA becomes
  // that. Every state keeps exactly one enabled, obvious next step.
  const recommendedDeadEnd = entryMode === "recommended" && !baselineLoading && !recommendationUsable;

  const primaryLabel = entryMode == null
    ? "Continue"
    : recommendedDeadEnd
      ? "Enter an amount manually"
      : entryMode === "recommended"
        ? finalAmount != null ? `Buy ${formatCurrency(finalAmount, currency)} of ${item.symbol}` : "Buy"
        : "Review Purchase";

  const primaryAction = recommendedDeadEnd
    ? () => handleEntryModeChange("manual")
    : entryMode === "recommended"
      ? () => void submit()
      : advance;

  const primaryDisabled = recommendedDeadEnd
    ? false
    : entryMode == null || submitting || quoteLoading || !canSubmit;

  return (
    <Dialog open title={`Add to Portfolio — ${item.symbol}`} onClose={onClose} className="max-w-2xl">
      <div className="max-h-[75vh] space-y-5 overflow-y-auto pr-1">
        {/* Step 1 — the asset */}
        {quote ? (
          <AssetHeader quote={quote} existingHolding={existingHolding} />
        ) : (
          <div className="h-32 animate-pulse rounded-xl border border-border bg-surface" />
        )}

        {/* Portfolio Fit */}
        {fit && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted">Portfolio Fit</span>
            <PortfolioFitBadge score={fit.fitScore} tier={fit.fitTier} showScore />
          </div>
        )}

        {/* Step 2 — the only question asked up front */}
        <AllocationChoice mode={entryMode} onChange={handleEntryModeChange} />

        {/* Step 3A — the optimizer's answer */}
        {entryMode === "recommended" && (
          <RecommendedAllocation
            recommendation={baseline}
            loading={baselineLoading}
            error={baselineError}
            currency={currency}
            maxHoldingPct={DEFAULT_CONSTRAINTS.maxHoldingPct}
            onRetry={refetchBaseline}
          />
        )}

        {/* Step 3B — the user's own number */}
        {entryMode === "manual" && (
          <ManualAllocation
            mode={sizingMode}
            onModeChange={setSizingMode}
            value={manualValue}
            onValueChange={setManualValue}
            currency={currency}
            price={price}
            shares={finalShares}
            weightAfter={finalAllocationPct}
            cashRemaining={cashRemaining}
            maxHoldingPct={DEFAULT_CONSTRAINTS.maxHoldingPct}
            loading={previewEnabled && previewLoading}
          />
        )}

        {/* Contextual, only once an amount exists */}
        {entryMode != null && existingHolding && finalAllocationPct != null && (
          <ExistingPositionNote
            name={item.name}
            currentPct={existingHolding.weight}
            afterPct={finalAllocationPct}
            capPct={DEFAULT_CONSTRAINTS.maxHoldingPct}
          />
        )}

        {entryMode != null && current && shortfall > 0 && (
          <FundingSourcePanel
            cashAvailable={cashAvailable}
            fundingShortfall={shortfall}
            sellSuggestions={current.sellSuggestions}
            sellSuggestionsCoverShortfall={current.sellSuggestionsCoverShortfall}
            selected={fundingSource}
            onSelect={setFundingSource}
          />
        )}

        {entryMode != null && warnings.length > 0 && (
          <ul className="flex flex-col gap-1 rounded-lg border border-warning/30 bg-warning/5 p-3">
            {warnings.map((w) => (
              <li key={w} className="text-[11px] leading-relaxed text-warning">⚠ {w}</li>
            ))}
          </ul>
        )}

        {/* Step 5 — depth, collapsed. Most purchases never open these. */}
        {entryMode != null && finalAmount != null && (
          <div className="flex flex-col gap-2">
            {current && (
              <CollapsibleSection title="Full portfolio impact">
                <ImpactComparison before={current.before} after={current.after} />
              </CollapsibleSection>
            )}

            <div className="rounded-lg border border-border bg-surface/40 p-3">
              <button
                type="button"
                onClick={() => setShowDetails((v) => !v)}
                aria-expanded={showDetails}
                className="flex w-full items-center justify-between text-xs font-semibold uppercase tracking-wider text-muted"
              >
                Transaction details
                <span aria-hidden>{showDetails ? "−" : "+"}</span>
              </button>
              {showDetails && (
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <Field label="Purchase date">
                    <Input type="date" max={todayStr()} value={tradeDate} onChange={(e) => setTradeDate(e.target.value)} />
                  </Field>
                  <Field label="Fees ($)"><Input type="number" step="any" min="0" value={fees} onChange={(e) => setFees(e.target.value)} placeholder="0" /></Field>
                  <Field label="Broker"><Input value={broker} onChange={(e) => setBroker(e.target.value)} placeholder="e.g. Fidelity" /></Field>
                  <Field label="Account"><Input value={account} onChange={(e) => setAccount(e.target.value)} placeholder="e.g. Taxable" /></Field>
                  <Field label="Commission ($)"><Input type="number" step="any" min="0" value={commission} onChange={(e) => setCommission(e.target.value)} placeholder="0" /></Field>
                  <Field label="Taxes ($)"><Input type="number" step="any" min="0" value={taxes} onChange={(e) => setTaxes(e.target.value)} placeholder="0" /></Field>
                  <Field label="Target price"><Input type="number" step="any" min="0" value={targetPrice} onChange={(e) => setTargetPrice(e.target.value)} placeholder="Optional" /></Field>
                  <Field label="Time horizon">
                    <select
                      value={horizon}
                      onChange={(e) => setHorizon(e.target.value as DecisionHorizon | "")}
                      className="w-full rounded-control border border-border bg-surface-2 px-3 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/25"
                    >
                      <option value="">—</option>
                      <option value="short">Short-term</option>
                      <option value="medium">Medium-term</option>
                      <option value="long">Long-term</option>
                    </select>
                  </Field>
                  <Field label={`Conviction (${conviction}/5)`}>
                    <Input type="range" min="1" max="5" step="1" value={conviction} onChange={(e) => setConviction(Number(e.target.value))} />
                  </Field>
                  <div className="col-span-2">
                    <Field label="Investment thesis / notes">
                      <textarea
                        value={thesis}
                        onChange={(e) => setThesis(e.target.value)}
                        rows={3}
                        placeholder="Why this position, why now…"
                        className="w-full rounded-control border border-border bg-surface-2 px-3 py-2 text-sm outline-none placeholder:text-faint focus:border-brand focus:ring-2 focus:ring-brand/25"
                      />
                    </Field>
                  </div>
                  {!dateValid && (
                    <p className="col-span-2 text-[11px] text-negative">Purchase date can&apos;t be in the future.</p>
                  )}
                  {feesUnrealistic && (
                    <p className="col-span-2 text-[11px] text-warning">
                      Fees + commission + taxes ({formatCurrency(feesLikeTotal)}) are more than 5% of the trade value — double-check before confirming.
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {error && <p className="text-xs text-negative">{error}</p>}

        {/* Step 4 — one obvious next action */}
        <div className="sticky bottom-0 flex flex-col gap-2 border-t border-border bg-surface pt-4">
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose} disabled={submitting} className="flex-1">Cancel</Button>
            <Button variant="primary" onClick={primaryAction} disabled={primaryDisabled} className="flex-[2]">
              {submitting ? "Placing order…" : primaryLabel}
            </Button>
          </div>
          {fundingSource === "cash" && shortfall > 0 && (
            <p className="text-[11px] text-warning">
              {formatCurrency(shortfall)} short of available cash — choose a different funding source or a smaller amount.
            </p>
          )}
          <p className="flex items-center justify-center gap-1.5 text-[11px] text-muted">
            <svg width="10" height="10" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <rect x="4" y="9" width="12" height="8" rx="1.5" />
              <path d="M7 9V6.5a3 3 0 0 1 6 0V9" />
            </svg>
            {baseline ? `Funds available: ${formatCurrency(cashAvailable, currency)}` : "Everything stays on this device."}
          </p>
        </div>
      </div>
    </Dialog>
  );
}
