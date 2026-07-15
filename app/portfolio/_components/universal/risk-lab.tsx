"use client";

import { useState } from "react";
import { Card, Badge } from "@/app/_components/ui";
import { formatCurrency } from "@/lib/format";
import type { UniversalRisk } from "@/lib/portfolio/engines/risk";
import type { ScenarioResult } from "@/lib/portfolio/engines/scenario";

/**
 * Risk Lab — risk beyond price volatility.
 *
 * Duration, credit, FX, liquidity and inflation risk are all real, all invisible to
 * a returns-based model, and all absent from the engine this replaces. They come
 * from the portfolio's factor exposures.
 */

function Metric({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "positive" | "negative" | "warning";
}) {
  const toneClass =
    tone === "positive" ? "text-positive"
    : tone === "negative" ? "text-negative"
    : tone === "warning" ? "text-warning"
    : "text-foreground";

  return (
    <div className="flex flex-col gap-0.5 rounded-lg border border-border bg-surface/40 p-3">
      <span className="text-[10px] uppercase tracking-wider text-muted/70">{label}</span>
      <span className={`font-mono text-base font-bold tabular-nums ${toneClass}`}>{value}</span>
      {hint && <span className="text-[10px] leading-snug text-muted/70">{hint}</span>}
    </div>
  );
}

const n = (v: number | null, suffix = "", digits = 2) =>
  v == null ? "—" : `${v.toFixed(digits)}${suffix}`;

export function RiskLab({ risk, scenarios }: { risk: UniversalRisk; scenarios: ScenarioResult[] }) {
  const [selected, setSelected] = useState<string | null>(scenarios[0]?.id ?? null);
  const active = scenarios.find((s) => s.id === selected) ?? null;

  return (
    <div className="flex flex-col gap-4">
      {/* ── Coverage disclosure ───────────────────────────────────────────────
          The old engine computed volatility on whichever holdings happened to have
          price history and reported it as THE portfolio's volatility — while the
          illiquid ones still counted in the weights. That systematically understates
          risk. We state coverage instead of hiding it. */}
      {risk.coverage.proxiedPct > 0 && (
        <Card className="flex flex-col gap-1 border-warning/25 bg-warning/[0.04] p-4">
          <span className="text-xs font-semibold text-warning">Risk coverage</span>
          <p className="text-[11px] leading-relaxed text-muted">
            Volatility and drawdown are measured on the {risk.coverage.observedPct}% of the
            portfolio with a real price history.{" "}
            <strong className="text-foreground">
              {risk.coverage.proxiedPct}% ({risk.coverage.holdingsProxied}{" "}
              {risk.coverage.holdingsProxied === 1 ? "holding" : "holdings"})
            </strong>{" "}
            has none, so a declared proxy volatility is used instead of assuming it is
            riskless. An illiquid asset with a flat carrying value is not a low-risk
            asset — it is an unobserved one.
          </p>
        </Card>
      )}

      {/* ── Return-based risk ── */}
      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">
          Market risk
        </h3>
        <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <Metric label="Volatility" value={n(risk.annualizedVolatility, "%", 1)} hint="Annualized" />
          <Metric label="Beta" value={n(risk.beta, "", 2)} hint="vs SPY" />
          <Metric label="Sharpe" value={n(risk.sharpeRatio, "", 2)} />
          <Metric label="Max drawdown" value={n(risk.maxDrawdown, "%", 1)} tone="negative" />
          <Metric
            label="VaR (95%)"
            value={risk.var95Dollar != null ? formatCurrency(risk.var95Dollar) : "—"}
            hint="Worst 1-day loss, 19 days in 20"
            tone="negative"
          />
          {/* CVaR answers the question VaR cannot: when it IS bad, how bad? */}
          <Metric
            label="CVaR (95%)"
            value={risk.cvar95Dollar != null ? formatCurrency(risk.cvar95Dollar) : "—"}
            hint="Average loss on the worst days"
            tone="negative"
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
            value={n(risk.creditSensitivity, "%", 2)}
            hint="Per 1pp of spread widening"
            tone={risk.creditSensitivity != null && risk.creditSensitivity < -1 ? "warning" : "default"}
          />
          <Metric
            label="Inflation"
            value={n(risk.inflationSensitivity, "%", 2)}
            hint="Per 1pp inflation surprise"
            tone={risk.inflationSensitivity != null && risk.inflationSensitivity < -0.5 ? "negative" : "positive"}
          />
          <Metric
            label="Foreign currency"
            value={`${risk.foreignCurrencyPct.toFixed(0)}%`}
            hint={risk.foreignCurrencyPct < 1 ? "No currency diversification" : "Non-base currency"}
          />
          <Metric
            label="Illiquid"
            value={`${risk.illiquidPct.toFixed(0)}%`}
            hint="Cannot sell within days"
            tone={risk.illiquidPct > 30 ? "warning" : "default"}
          />
        </div>
      </div>

      {/* ── Correlation ── */}
      {risk.correlation && (
        <Card className="flex flex-col gap-2 p-5">
          <div className="flex items-baseline justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">Correlation</h3>
            <span className="font-mono text-xs tabular-nums text-muted">
              avg r = {risk.correlation.avgCorrelation.toFixed(2)}
            </span>
          </div>

          {risk.correlation.highPairs.length > 0 ? (
            <ul className="flex flex-col gap-1">
              {risk.correlation.highPairs.map((p) => (
                <li key={`${p.a}-${p.b}`} className="flex items-center justify-between text-xs">
                  <span className="font-mono text-foreground">{p.a} ↔ {p.b}</span>
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
                onClick={() => setSelected(s.id)}
                className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs transition-colors ${
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
                          {h.symbol ?? h.name}
                        </td>
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
