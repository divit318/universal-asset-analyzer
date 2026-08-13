"use client";

/**
 * The "top things to know" strip — an executive navigation layer, not another
 * analytics card.
 *
 * One quiet, scannable line of the portfolio's most decision-relevant facts,
 * each one a link into the section or workflow where it can be examined and
 * acted on. Items are DERIVED from the report and appear only when material:
 * a 1.0-beta, 3%-cash, unconcentrated book renders almost nothing here, which
 * is the correct amount of alarm.
 *
 * Deliberately NOT a Card and NOT badges: it sits between the headline tiles
 * and the tab bar as plain text with separators, so it reads as a caption of
 * the tiles above it rather than competing with the panels below.
 */

import type { UniversalPortfolioReport } from "@/lib/portfolio/report";
import type { Tab } from "./dashboard-nav";

export interface KeyFact {
  /** The fact, stated tersely: "84% US", "QQQM 26.2%", "beta 1.70". */
  label: string;
  /** Why it's on the strip — shown as a title tooltip. */
  reason: string;
  tone: "warning" | "neutral";
  /** Where clicking takes the user. */
  tab: Tab;
  /** Optional element id to scroll to once the tab is active. */
  anchor?: string;
}

/** Derive the strip's items from the report. Pure; exported for tests. */
export function deriveKeyFacts(report: UniversalPortfolioReport): KeyFact[] {
  const facts: KeyFact[] = [];
  const { risk, allocation, concentration, trajectory } = report;

  // Largest single holding — the first thing anyone asks about a book.
  const top = [...report.holdings].sort((a, b) => b.weight - a.weight)[0];
  if (top && top.weight >= 10) {
    facts.push({
      label: `${top.symbol ?? top.name} ${top.weight.toFixed(1)}%`,
      reason: `Largest single position. ${top.weight.toFixed(1)}% of the portfolio rides on it.`,
      tone: top.weight >= 20 ? "warning" : "neutral",
      tab: "holdings",
    });
  }

  // Dominant asset class, with real drift context when snapshots exist.
  if (risk.topAssetClassWeight >= 55) {
    const cls = allocation.byAssetClass.slices[0];
    const drift =
      trajectory?.concentrationDelta != null && Math.abs(trajectory.concentrationDelta) >= 1
        ? ` ${trajectory.concentrationDelta > 0 ? "↑" : "↓"}${Math.abs(trajectory.concentrationDelta).toFixed(1)}pp over ${trajectory.windowDays}d`
        : "";
    facts.push({
      label: `${risk.topAssetClassWeight.toFixed(0)}% ${cls?.label.toLowerCase() ?? "one class"}${drift}`,
      reason: `Largest asset class${drift ? " — drift measured from your executed-change snapshots" : ""}. See the class breakdown.`,
      tone: risk.topAssetClassWeight >= 70 ? "warning" : "neutral",
      tab: "dashboard",
      anchor: "panel-allocation",
    });
  }

  // Home-country concentration.
  const us = allocation.byGeography.slices.find((s) => /united states|^usa?$/i.test(s.label));
  if (us && us.weight >= 60) {
    facts.push({
      label: `${us.weight.toFixed(0)}% US`,
      reason: "Geographic concentration. Expand the geography breakdown to see which holdings.",
      tone: us.weight >= 80 ? "warning" : "neutral",
      tab: "dashboard",
      anchor: "panel-allocation",
    });
  }

  // Cash at either extreme is a standing decision; in between it's furniture.
  const cash = allocation.byAssetClass.slices.find((s) => s.key === "cash");
  const cashW = cash?.weight ?? 0;
  if (cashW >= 10 || cashW < 1) {
    facts.push({
      label: cashW < 1 ? "no cash buffer" : `${cashW.toFixed(0)}% cash`,
      reason:
        cashW < 1
          ? "Nothing left to deploy into a drawdown or an opportunity."
          : "Uninvested capital — a drag on expected return at this size.",
      tone: cashW >= 25 || cashW < 1 ? "warning" : "neutral",
      tab: "dashboard",
      anchor: "panel-allocation",
    });
  }

  // Beta, when it says something.
  if (risk.beta != null && (risk.beta >= 1.2 || risk.beta <= 0.8)) {
    facts.push({
      label: `${risk.beta.toFixed(2)} beta`,
      reason: `Moves ~${risk.beta.toFixed(2)}× ${risk.benchmarkLabel ?? "the market"}. Stress-test it in the Risk Lab.`,
      tone: risk.beta >= 1.5 ? "warning" : "neutral",
      tab: "risk",
    });
  }

  // Open concentration findings, counted rather than repeated.
  if (concentration.length > 0) {
    facts.push({
      label: `${concentration.length} concentration flag${concentration.length === 1 ? "" : "s"}`,
      reason: "The findings listed above the tabs. Each states what breached and by how much.",
      tone: concentration.some((c) => c.severity === "high") ? "warning" : "neutral",
      tab: "dashboard",
      anchor: "concentration-findings",
    });
  }

  // Illiquidity is only news when it exists.
  if (risk.illiquidPct >= 15) {
    facts.push({
      label: `${risk.illiquidPct.toFixed(0)}% illiquid`,
      reason: "Cannot be sold within days. See the liquidity ladder.",
      tone: risk.illiquidPct >= 30 ? "warning" : "neutral",
      tab: "dashboard",
      anchor: "panel-allocation",
    });
  }

  return facts.slice(0, 6);
}

export function KeyFactsStrip({
  report,
  onNavigate,
}: {
  report: UniversalPortfolioReport;
  onNavigate: (tab: Tab, anchor?: string) => void;
}) {
  const facts = deriveKeyFacts(report);
  if (facts.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-1 text-[11px] leading-relaxed">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted/60">
        Know this
      </span>
      {facts.map((f, i) => (
        <span key={f.label} className="flex items-center gap-x-2">
          {i > 0 && <span aria-hidden className="text-muted/30">·</span>}
          <button
            type="button"
            title={f.reason}
            onClick={() => onNavigate(f.tab, f.anchor)}
            className={`rounded-sm font-mono tabular-nums underline-offset-2 transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 ${
              f.tone === "warning" ? "text-warning hover:text-warning" : "text-muted hover:text-foreground"
            }`}
          >
            {f.label}
          </button>
        </span>
      ))}
    </div>
  );
}
