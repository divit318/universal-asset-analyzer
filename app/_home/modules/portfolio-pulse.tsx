"use client";

/**
 * Module 4 — Portfolio Pulse.
 *
 * Health, movers, risk, drift, cash, diversification — plus the AI's one-line
 * read, which arrives on the shared brief stream rather than costing its own
 * model call.
 *
 * `marketPricedPct` is surfaced deliberately: if half the portfolio's value is
 * self-reported rather than marked to market, every percentage on this card
 * inherits that softness and the user should be able to see it.
 */

import Link from "next/link";
import { Badge } from "@/app/_components/ui";
import { formatCurrency, toneClass } from "@/lib/format";
import { getHomeModule } from "@/lib/home/registry";
import type { PortfolioPulse, PulseMover } from "@/lib/home/contracts";
import { ModuleShell } from "../module-shell";
import { useHome, useHomeSlice } from "../home-provider";

const definition = getHomeModule("portfolio-pulse");

function signed(n: number, digits = 2): string {
  return `${n >= 0 ? "+" : ""}${n.toFixed(digits)}%`;
}

function Stat({ label, value, sub, className = "" }: { label: string; value: string; sub?: string; className?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-micro uppercase tracking-wide text-muted">{label}</span>
      <span className={`font-mono text-sm font-semibold tabular-nums ${className || "text-foreground"}`}>{value}</span>
      {sub ? <span className="truncate text-xs text-muted">{sub}</span> : null}
    </div>
  );
}

function Mover({ label, mover }: { label: string; mover: PulseMover | null }) {
  if (!mover) return <Stat label={label} value="—" />;
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-micro uppercase tracking-wide text-muted">{label}</span>
      <Link href={`/research?symbol=${encodeURIComponent(mover.symbol)}`} className="font-mono text-sm font-semibold text-foreground hover:text-brand">
        {mover.symbol}
      </Link>
      <span className={`font-mono text-xs tabular-nums ${toneClass(mover.changePct)}`}>
        {signed(mover.changePct, 1)} · {formatCurrency(mover.changeDollar)}
      </span>
    </div>
  );
}

export function PortfolioPulseModule() {
  const state = useHomeSlice("portfolioPulse");
  const { brief, refreshDigest } = useHome();

  const unmet = state.data?.status === "empty" ? ("portfolio" as const) : null;
  const summary = brief.data?.portfolioSummary;

  return (
    <ModuleShell
      definition={definition}
      state={state}
      unmet={unmet}
      minHeight={200}
      onRefresh={refreshDigest}
      isEmpty={(d: PortfolioPulse) => d.status === "empty"}
      emptyMessage="No holdings yet."
    >
      {(d) => (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-baseline gap-3">
            <span className="font-mono text-2xl font-semibold tabular-nums text-foreground">
              {formatCurrency(d.totalValue)}
            </span>
            <span className={`font-mono text-sm font-semibold tabular-nums ${toneClass(d.todayChangePct)}`}>
              {signed(d.todayChangePct)} today
            </span>
            {d.healthGrade ? (
              <Badge variant={d.healthScore != null && d.healthScore >= 70 ? "positive" : d.healthScore != null && d.healthScore >= 50 ? "warning" : "negative"}>
                Health {d.healthGrade} · {d.healthScore}/100
              </Badge>
            ) : null}
          </div>

          {summary ? <p className="text-sm leading-6 text-muted">{summary}</p> : null}

          <div className="grid grid-cols-2 gap-4 border-t border-border pt-4 sm:grid-cols-4">
            <Mover label="Best performer" mover={d.bestPerformer} />
            <Mover label="Worst performer" mover={d.worstPerformer} />
            <Stat
              label="Cash"
              value={d.cashPct != null ? `${d.cashPct.toFixed(1)}%` : "—"}
            />
            {/* This is the HHI over *asset classes*, not over holdings — an
                all-equity book of 18 names scores 0 here, which is correct and
                would read as absurd under a bare "Diversification" label. */}
            <Stat
              label="Asset-class mix"
              value={d.diversificationScore != null ? `${d.diversificationScore}/100` : "—"}
              sub={d.diversificationScore === 0 ? "Single asset class" : undefined}
            />
          </div>

          {(d.largestRisk || d.largestDrift || d.largestOpportunity) && (
            <div className="flex flex-col gap-2 border-t border-border pt-4">
              {d.largestRisk ? (
                <p className="text-xs leading-5 text-muted">
                  <span className="font-semibold text-negative">Largest risk</span> · {d.largestRisk.description}
                </p>
              ) : null}
              {d.largestDrift ? (
                <p className="text-xs leading-5 text-muted">
                  <span className="font-semibold text-warning">Allocation drift</span> · {d.largestDrift.label} is{" "}
                  {signed(d.largestDrift.driftPct, 1)} vs. target
                </p>
              ) : null}
              {d.largestOpportunity ? (
                <p className="text-xs leading-5 text-muted">
                  <span className="font-semibold text-positive">Largest opportunity</span> ·{" "}
                  <Link href={`/research?symbol=${encodeURIComponent(d.largestOpportunity.symbol)}`} className="font-mono hover:text-brand">
                    {d.largestOpportunity.symbol}
                  </Link>{" "}
                  — {d.largestOpportunity.reason}
                </p>
              ) : null}
            </div>
          )}

          {d.marketPricedPct < 95 ? (
            <p className="border-t border-border pt-4 text-xs text-muted">
              {d.marketPricedPct.toFixed(0)}% of value is marked to market; the rest is self-reported.
            </p>
          ) : null}
        </div>
      )}
    </ModuleShell>
  );
}
