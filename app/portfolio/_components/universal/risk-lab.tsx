"use client";

import { useState } from "react";
import Link from "next/link";
import { Card, Badge } from "@/app/_components/ui";
import { CollapsibleSection } from "@/app/_components/collapsible-section";
import { formatCurrency } from "@/lib/format";
import { describeIlliquidWeight } from "@/lib/portfolio/model/types";
import type { UniversalRisk } from "@/lib/portfolio/engines/risk";
import type { ScenarioResult } from "@/lib/portfolio/engines/scenario";
import { FACTOR_SENSITIVITIES_AS_OF } from "@/lib/portfolio/classes/reference/factor-sensitivities";

/**
 * Risk Lab — risk beyond price volatility.
 *
 * Duration, credit, FX, liquidity and inflation risk are all real, all invisible to
 * a returns-based model, and all absent from the engine this replaces. They come
 * from the portfolio's factor exposures.
 */

/**
 * One risk figure.
 *
 * `tone` is deliberately NOT derived from the sign of the number. Half the
 * metrics here are "higher is worse" (volatility, drawdown, VaR, duration,
 * illiquidity) and half are "higher is better" (Sharpe, Sortino), so a shared
 * sign→colour rule would actively mislead on one half of the grid. Each call
 * site states its own tone, and an UNKNOWN value is always neutral — a missing
 * measurement is not good news, which is what a green em-dash would imply.
 */
function Metric({
  label,
  value,
  hint,
  tone = "default",
  title,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "positive" | "negative" | "warning";
  /** Plain-English definition, for a metric whose name is jargon. */
  title?: string;
}) {
  const toneClass =
    tone === "positive" ? "text-positive"
    : tone === "negative" ? "text-negative"
    : tone === "warning" ? "text-warning"
    : "text-foreground";

  return (
    <div className="flex flex-col gap-0.5 rounded-lg border border-border bg-surface/40 p-3">
      <span
        className={`text-[10px] uppercase tracking-wider text-muted/70 ${title ? "cursor-help decoration-dotted underline-offset-2 hover:underline" : ""}`}
        title={title}
      >
        {label}
      </span>
      <span className={`font-mono text-base font-bold tabular-nums ${toneClass}`}>{value}</span>
      {hint && <span className="text-[10px] leading-snug text-muted/70">{hint}</span>}
    </div>
  );
}

const n = (v: number | null, suffix = "", digits = 2) =>
  v == null ? "—" : `${v.toFixed(digits)}${suffix}`;

/**
 * Signed rendering for a sensitivity, where the sign IS the information: a
 * credit or inflation sensitivity of −0.42 and +0.42 are opposite facts, and
 * `toFixed` alone renders the positive one without its sign.
 */
const signed = (v: number | null, suffix = "", digits = 2) =>
  v == null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(digits)}${suffix}`;

/** A sensitivity's tone: unknown is neutral, hurt is negative, helped is positive. */
function sensitivityTone(v: number | null, hurtBelow: number): "default" | "negative" | "positive" {
  if (v == null) return "default";
  if (v < hurtBelow) return "negative";
  return v > 0 ? "positive" : "default";
}

export function RiskLab({ risk, scenarios }: { risk: UniversalRisk; scenarios: ScenarioResult[] }) {
  const [selected, setSelected] = useState<string | null>(scenarios[0]?.id ?? null);
  const active = scenarios.find((s) => s.id === selected) ?? null;
  const illiquid = describeIlliquidWeight(risk.illiquidPct, risk.illiquidHoldings);

  return (
    <div className="flex flex-col gap-4">
      {/* ── Coverage disclosure ───────────────────────────────────────────────
          Gated on observedPct < 100, NOT on proxiedPct > 0.

          The old gate was `proxiedPct > 0`, and a declared proxy volatility only
          exists for the manually-valued classes and cash. So a MARKET-priced
          holding whose price history simply didn't arrive — a fresh listing, a
          delisted ticker, a provider error, a line the provider has no series
          for — was counted in the weights, excluded from every statistic, and
          disclosed NOWHERE: proxiedPct stayed 0, so this card never rendered,
          and a portfolio measured on 60% of its value presented volatility,
          beta, VaR and drawdown as if they described the whole book.
          Understating risk silently is the exact failure the risk engine's own
          docblock says it exists to prevent. */}
      {risk.coverage.observedPct < 100 && (
        <Card className="flex flex-col gap-1.5 border-warning/25 bg-warning/[0.04] p-4">
          <span className="text-xs font-semibold text-warning">
            Risk measured on {risk.coverage.observedPct}% of portfolio value
          </span>
          <p className="text-[11px] leading-relaxed text-muted">
            Volatility, beta, drawdown, VaR and the ratios below are computed from the{" "}
            <strong className="text-foreground">{risk.coverage.observedPct}%</strong> of the
            portfolio that has a real price history.
            {risk.coverage.proxiedPct > 0 && (
              <>
                {" "}
                <strong className="text-foreground">
                  {risk.coverage.proxiedPct}% ({risk.coverage.holdingsProxied}{" "}
                  {risk.coverage.holdingsProxied === 1 ? "holding" : "holdings"})
                </strong>{" "}
                has none, so a declared proxy volatility is used instead of assuming it is
                riskless. An illiquid asset with a flat carrying value is not a low-risk
                asset — it is an unobserved one.
              </>
            )}
            {risk.coverage.unmodelledPct > 0 && (
              <>
                {" "}
                <strong className="text-negative">
                  {risk.coverage.unmodelledPct}% ({risk.coverage.holdingsUnmodelled}{" "}
                  {risk.coverage.holdingsUnmodelled === 1 ? "holding" : "holdings"})
                </strong>{" "}
                is market-priced but returned no price history at all, so it enters the
                weights and none of the statistics. Treat every figure below as describing
                the measured sleeve, not the whole portfolio.
              </>
            )}
          </p>
        </Card>
      )}

      {/* ── Methodology ── where each number above actually comes from, so the
          rigor is visible rather than just asserted. Collapsed by default —
          this is evidence on demand, not something that should compete with
          the numbers themselves for attention. */}
      <CollapsibleSection
        title="Methodology"
        subtitle="What's measured, what's a declared reference value, and where each comes from"
      >
        <ul className="flex flex-col gap-2 text-[11px] leading-relaxed text-muted">
          <li>
            <strong className="text-foreground">Volatility, Sharpe, drawdown, VaR, CVaR</strong> — computed
            from real daily price history for the {risk.coverage.observedPct}% of the portfolio that has
            one. Beta is a regression of portfolio returns against {risk.benchmarkLabel ?? "the market benchmark"} over the same window.
          </li>
          <li>
            <strong className="text-foreground">Equity/fund beta feeding the factor exposures below</strong> —
            measured from each holding&apos;s own daily returns where the regression explains enough of the
            variance to be trusted (R² ≥ 0.10); otherwise it falls back to the data provider&apos;s beta, then
            to a class-typical reference value — never a noisy measurement presented as a real one.
          </li>
          <li>
            <strong className="text-foreground">Duration</strong> — real, read from each bond fund&apos;s
            actual holdings data (topHoldings.bondHoldings.duration), not estimated.
          </li>
          <li>
            <strong className="text-foreground">Credit, inflation, FX and commodity sensitivities</strong> for
            asset classes where none of the above can be measured directly (gold, oil, broad commodities,
            crypto, real estate) — a curated reference table of typical relationships, dated{" "}
            {FACTOR_SENSITIVITIES_AS_OF}. These are long-run averages and can go stale across regime changes
            (e.g. the 2022 breakdown of the stock/bond correlation), which is why the date is shown.
          </li>
          <li>
            <strong className="text-foreground">Stress scenarios</strong> apply the same measured-or-reference
            sensitivities as macro factor shocks — an asset priced by a complex (gold, oil) loads on that
            complex&apos;s own factor, not on the macro drivers behind it, so nothing gets shocked twice for the
            same move.
          </li>
        </ul>
      </CollapsibleSection>

      {/* ── Return-based risk ── */}
      <div>
        <h3 className="mb-2 flex items-baseline gap-2 text-xs font-semibold uppercase tracking-wider text-muted">
          Market risk
          {risk.coverage.observedPct < 100 && (
            <span className="font-normal normal-case tracking-normal text-muted/60">
              measured on {risk.coverage.observedPct}% of value
            </span>
          )}
        </h3>
        <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-4">
          <Metric
            label="Volatility"
            value={n(risk.annualizedVolatility, "%", 1)}
            hint="Annualized standard deviation"
            title="How much the portfolio's value swings year to year. Higher means a wider range of outcomes, in both directions."
          />
          <Metric
            label="Beta"
            value={n(risk.beta, "", 2)}
            hint={`vs ${risk.benchmarkLabel ?? "market"}`}
            title={`How much the portfolio moves for each 1% move in ${risk.benchmarkLabel ?? "its market benchmark"}. 1.0 = moves with the market; below 1.0 = moves less.`}
          />
          <Metric
            label="Max drawdown"
            value={n(risk.maxDrawdown, "%", 1)}
            hint="Worst peak-to-trough fall"
            tone="negative"
            title="The largest percentage fall from a previous high, over the measured window. What it actually felt like to hold at the worst moment."
          />
          <Metric
            label="Sharpe"
            value={n(risk.sharpeRatio, "", 2)}
            hint="Return per unit of total risk"
            tone={risk.sharpeRatio == null ? "default" : risk.sharpeRatio >= 1 ? "positive" : risk.sharpeRatio < 0 ? "negative" : "default"}
            title="Return above cash, divided by total volatility. Above 1.0 is good; negative means you were paid less than a Treasury bill for taking risk."
          />
          {/* Sortino was computed by the risk engine and rendered nowhere — so the
              one ratio that distinguishes harmful downside from mere choppiness
              was invisible. (It was also mathematically wrong until the same
              audit; see computeRiskAdjustedRatios.) */}
          <Metric
            label="Sortino"
            value={n(risk.sortinoRatio, "", 2)}
            hint="Return per unit of DOWNSIDE risk"
            tone={risk.sortinoRatio == null ? "default" : risk.sortinoRatio >= 1.5 ? "positive" : risk.sortinoRatio < 0 ? "negative" : "default"}
            title="Like Sharpe, but it only counts volatility to the downside. Upside swings are not penalised. Higher than Sharpe for most portfolios."
          />
          <Metric
            label="VaR (95%)"
            value={risk.var95Dollar != null ? formatCurrency(risk.var95Dollar) : "—"}
            hint={risk.var95Pct != null ? `${risk.var95Pct.toFixed(2)}% · 1 day in 20` : "Worst 1-day loss, 19 days in 20"}
            tone="negative"
            title="Value at Risk: on the worst 1 day in 20, the portfolio is modelled to lose at least this much."
          />
          {/* CVaR answers the question VaR cannot: when it IS bad, how bad? */}
          <Metric
            label="CVaR (95%)"
            value={risk.cvar95Dollar != null ? formatCurrency(risk.cvar95Dollar) : "—"}
            hint={risk.cvar95Pct != null ? `${risk.cvar95Pct.toFixed(2)}% · average bad day` : "Average loss on the worst days"}
            tone="negative"
            title="Conditional VaR, or expected shortfall: the AVERAGE loss across the worst 5% of days. VaR says where the tail starts; this says how deep it goes."
          />
          <Metric
            label="Avg correlation"
            value={risk.correlation ? risk.correlation.avgCorrelation.toFixed(2) : "—"}
            hint={risk.correlation ? `across ${risk.correlation.symbols.length} holdings` : "Not enough history"}
            tone={
              risk.correlation == null ? "default"
              : risk.correlation.avgCorrelation >= 0.7 ? "warning"
              : risk.correlation.avgCorrelation <= 0.3 ? "positive"
              : "default"
            }
            title="Average pairwise correlation between holdings. Near 1.0 means they move together, so the portfolio is less diversified than its holding count suggests."
          />
        </div>
      </div>

      {/* ── Concentration ────────────────────────────────────────────────────
          The engine computed HHI, top-holding, top-class and top-sector weight
          and a low/medium/high verdict, and the Risk Lab displayed none of it —
          concentration is the single most common way a real portfolio gets hurt,
          and it was only visible as a banner at the top of the page. */}
      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">
          Concentration
        </h3>
        <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-5">
          <Metric
            label="Verdict"
            value={risk.concentrationRisk === "low" ? "Low" : risk.concentrationRisk === "medium" ? "Medium" : "High"}
            hint="Across holding, class and HHI"
            tone={risk.concentrationRisk === "high" ? "negative" : risk.concentrationRisk === "medium" ? "warning" : "positive"}
          />
          {/* "Position HHI", never a bare "HHI".
              The Dashboard's allocation bars each show an HHI too — over ASSET
              CLASSES, SECTORS, CURRENCIES and so on. On the real book this one read
              689 ("Low") while the asset-class one read 3440 ("concentrated"), both
              labelled "HHI", both correct, on the same page. Identical labels for
              different denominators is the fastest way to make a user believe the
              tool contradicts itself — the same rule that renamed the holdings
              table's "Score" column to "Quality". */}
          <Metric
            label="Position HHI"
            value={risk.positionHhi.toFixed(0)}
            hint={`${(risk.positionHhi > 0 ? 10000 / risk.positionHhi : 0).toFixed(1)} effective holdings`}
            tone={risk.positionHhi > 2500 ? "negative" : risk.positionHhi > 1500 ? "warning" : "positive"}
            title="Herfindahl-Hirschman Index over INDIVIDUAL HOLDING weights: the sum of squared weights, 0-10000. Below 1500 is diversified, above 2500 is concentrated. 10000/HHI is the equal-weight equivalent number of holdings. The allocation bars on the Dashboard show a separate HHI per dimension (asset class, sector, currency) — a book can be spread across many names and still sit in one asset class, so those figures are expected to differ from this one."
          />
          <Metric
            label="Top holding"
            value={`${risk.topHoldingWeight.toFixed(1)}%`}
            tone={risk.topHoldingWeight > 25 ? "negative" : risk.topHoldingWeight > 15 ? "warning" : "default"}
          />
          <Metric
            label="Top asset class"
            value={`${risk.topAssetClassWeight.toFixed(1)}%`}
            tone={risk.topAssetClassWeight > 85 ? "negative" : risk.topAssetClassWeight > 70 ? "warning" : "default"}
          />
          <Metric
            label="Top sector"
            value={risk.topSectorWeight > 0 ? `${risk.topSectorWeight.toFixed(1)}%` : "—"}
            hint={risk.topSectorWeight > 0 ? "of total portfolio value" : "No sector-classified holdings"}
            tone={risk.topSectorWeight > 50 ? "negative" : risk.topSectorWeight > 40 ? "warning" : "default"}
          />
        </div>
      </div>

      {/* ── Cross-asset risk: none of this existed before ── */}
      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">
          Cross-asset risk
        </h3>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          <Metric
            label="Duration"
            value={n(risk.duration, "y", 1)}
            hint={risk.duration != null ? `+1pp rates ≈ ${(-risk.duration).toFixed(1)}%` : "No rate exposure"}
            tone={risk.duration != null && risk.duration > 8 ? "warning" : "default"}
          />
          <Metric
            label="Credit sensitivity"
            value={signed(risk.creditSensitivity, "%")}
            hint="Per 1pp of spread widening"
            tone={sensitivityTone(risk.creditSensitivity, -1)}
            title="How much portfolio value moves if corporate credit spreads widen by 1 percentage point. Negative means credit stress hurts you."
          />
          {/* The tone here used to be `sensitivity < -0.5 ? negative : positive`,
              which painted TWO wrong states green: a null (no inflation-sensitive
              exposure at all rendered a green em-dash, implying the portfolio was
              inflation-protected when nothing had been measured), and any value
              between -0.5 and 0 (still losing money to inflation, shown as a
              positive). Unknown is now neutral and only a genuine positive
              sensitivity reads as protection. */}
          <Metric
            label="Inflation"
            value={signed(risk.inflationSensitivity, "%")}
            hint={
              risk.inflationSensitivity == null
                ? "No inflation-sensitive exposure measured"
                : "Per 1pp inflation surprise"
            }
            tone={sensitivityTone(risk.inflationSensitivity, -0.5)}
            title="How much portfolio value moves on a surprise 1 percentage point rise in inflation, including the policy-rate response. Negative means inflation hurts you."
          />
          <Metric
            label="Foreign currency"
            value={`${risk.foreignCurrencyPct.toFixed(0)}%`}
            hint={risk.foreignCurrencyPct < 1 ? "No currency diversification" : "Non-base currency"}
          />
          {/* Weight AND count. "Illiquid: 0%" alone is true by dollar-weight and
              false as an impression: three genuinely illiquid holdings worth
              $1,750 in a $9.2M book round to 0.0%, and a reader concludes nothing
              here is illiquid — while the Holdings tab shows three ILLIQUID
              badges. Both numbers come from the same isIlliquid() predicate as
              those badges, and the WORDING comes from the shared
              describeIlliquidWeight() so the Optimize tab's "cannot be
              rebalanced" banner states this identical fact identically. Same
              weight-plus-context pairing as "Position HHI 688 · 14.5 effective
              holdings" above. */}
          <Metric
            label="Illiquid"
            value={illiquid.weight}
            hint={illiquid.context}
            tone={risk.illiquidPct > 30 ? "warning" : "default"}
            title="Share of portfolio VALUE that cannot be liquidated within days, and how many holdings that is. A small weight across several holdings is still an illiquid sleeve — it just cannot move the total. Matches the ILLIQUID badges on the Holdings tab and the Optimize tab's rebalancing banner."
          />
        </div>
      </div>

      {/* ── Correlation ── */}
      {risk.correlation && (
        <Card className="flex flex-col gap-2 p-5">
          {/* The average itself lives in the Market risk grid above; repeating it
              here would be two authorities for one number. This card is the
              detail: which specific pairs are the problem. */}
          <div className="flex items-baseline justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">
              Most correlated pairs
            </h3>
            <span className="text-[11px] text-muted/70">r &gt; 0.75</span>
          </div>

          {risk.correlation.highPairs.length > 0 ? (
            <ul className="flex flex-col gap-1">
              {risk.correlation.highPairs.map((p) => (
                <li key={`${p.a}-${p.b}`} className="flex items-center justify-between text-xs">
                  {/* Each half of the pair opens its research page — "these two
                      move together" begs "so what are they, exactly?". */}
                  <span className="font-mono text-foreground">
                    <Link
                      href={`/research?symbol=${encodeURIComponent(p.a)}`}
                      className="rounded-sm hover:text-brand hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
                    >
                      {p.a}
                    </Link>
                    {" ↔ "}
                    <Link
                      href={`/research?symbol=${encodeURIComponent(p.b)}`}
                      className="rounded-sm hover:text-brand hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
                    >
                      {p.b}
                    </Link>
                  </span>
                  <span className="font-mono tabular-nums text-warning">r = {p.r.toFixed(2)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-muted">No highly-correlated pairs.</p>
          )}

          {/* Excluded, NOT assumed uncorrelated. Assigning r=0 to an illiquid holding
              would render it a perfect diversifier — the most dangerous single lie a
              portfolio tool can tell. */}
          {risk.correlation.excluded.length > 0 && (
            <p className="mt-1 text-[11px] leading-relaxed text-muted/70">
              Excluded ({risk.correlation.excluded.length}):{" "}
              {risk.correlation.excluded.join(", ")} — no return series exists for these.
              They are left out rather than assumed uncorrelated.
            </p>
          )}
        </Card>
      )}

      {/* ── Scenarios ── */}
      <div className="flex flex-col gap-3">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">Stress tests</h3>
          <p className="mt-1 text-[11px] text-muted/70">
            Each scenario is a set of macro factor shocks. Every asset class responds
            through its own declared sensitivities — so gold and Treasuries can rise in
            a crisis while equities fall, rather than everything falling together.
          </p>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {scenarios.map((s) => {
            const isActive = s.id === selected;
            const bad = s.portfolioImpactPct < 0;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => setSelected(s.id)}
                aria-pressed={isActive}
                className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 ${
                  isActive
                    ? "border-brand bg-brand/10 text-foreground"
                    : "border-border text-muted hover:border-brand/40 hover:text-foreground"
                }`}
              >
                <span>{s.name}</span>
                <span className={`font-mono font-semibold tabular-nums ${bad ? "text-negative" : "text-positive"}`}>
                  {s.portfolioImpactPct >= 0 ? "+" : ""}{s.portfolioImpactPct.toFixed(1)}%
                </span>
              </button>
            );
          })}
        </div>

        {active && (
          <Card className="flex flex-col gap-4 p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h4 className="text-sm font-semibold text-foreground">{active.name}</h4>
                <p className="mt-0.5 text-xs leading-relaxed text-muted">{active.description}</p>
              </div>
              <div className="flex shrink-0 flex-col items-end">
                <span className={`font-mono text-2xl font-bold tabular-nums ${
                  active.portfolioImpactPct < 0 ? "text-negative" : "text-positive"
                }`}>
                  {active.portfolioImpactPct >= 0 ? "+" : ""}{active.portfolioImpactPct.toFixed(1)}%
                </span>
                <span className="font-mono text-xs tabular-nums text-muted">
                  {formatCurrency(active.portfolioImpactValue)}
                </span>
              </div>
            </div>

            <div className="flex flex-wrap gap-1.5">
              {active.shockSummary.map((s) => (
                <Badge key={s} variant="neutral">{s}</Badge>
              ))}
            </div>

            {/* Coverage: how much of the portfolio this scenario actually touches. The
                old engine defaulted anything it couldn't classify to -20% and presented
                the result as complete. */}
            {active.coveragePct < 100 && (
              <p className="text-[11px] text-muted/70">
                {active.coveragePct}% of portfolio value has a sensitivity to the factors
                this scenario shocks. The rest is genuinely unaffected — not unmodelled.
              </p>
            )}

            <div className="overflow-x-auto">
              <table className="w-full min-w-[480px]">
                <thead>
                  <tr className="border-b border-border text-[10px] uppercase tracking-wider text-muted/70">
                    <th className="py-2 text-left font-semibold">Holding</th>
                    <th className="px-2 py-2 text-right font-semibold">Impact</th>
                    <th className="px-2 py-2 text-right font-semibold">Value</th>
                    <th className="py-2 pl-2 text-left font-semibold">Driven by</th>
                  </tr>
                </thead>
                <tbody>
                  {[...active.holdings]
                    .sort((a, b) => a.impactPct - b.impactPct)
                    .map((h) => (
                      <tr key={h.id} className="border-b border-border/50">
                        <td className="py-2 text-xs font-medium text-foreground">
                          {h.symbol ? (
                            <Link
                              href={`/research?symbol=${encodeURIComponent(h.symbol)}`}
                              className="rounded-sm hover:text-brand hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
                            >
                              {h.symbol}
                            </Link>
                          ) : (
                            h.name
                          )}
                        </td>
                        {/* No "≤−100%" marker here any more, and no floor to mark:
                            the engine composes factor shocks in log-return space, so
                            a long position's impact is bounded above −100% by
                            construction rather than clamped after the fact. See
                            applyShocks(). */}
                        <td className={`px-2 py-2 text-right font-mono text-xs font-semibold tabular-nums ${
                          h.impactPct < 0 ? "text-negative" : h.impactPct > 0 ? "text-positive" : "text-muted"
                        }`}>
                          {h.impactPct >= 0 ? "+" : ""}{h.impactPct.toFixed(1)}%
                        </td>
                        <td className="px-2 py-2 text-right font-mono text-xs tabular-nums text-muted">
                          {formatCurrency(h.impactValue)}
                        </td>
                        <td className="py-2 pl-2 text-[11px] text-muted">
                          {h.drivers.length > 0
                            ? h.drivers.map((d) => d.label).join(", ")
                            : "no exposure to these factors"}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
