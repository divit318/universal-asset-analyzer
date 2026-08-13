"use client";

import { useMemo } from "react";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import type { FundProfileData, HistoryPoint, ScoreResult } from "@/lib/types";
import { deriveVerdictTriggers } from "@/lib/research-engines/fund/triggers";
import { RECOMMENDATION_LABEL } from "@/lib/recommendation";
import { BasisMark, BasisLegend } from "./basis";

/**
 * "What would change the verdict?" — the card that turns a report into
 * something worth coming back to.
 *
 * Every threshold shown is solved out of the live scorer (see
 * lib/research-engines/fund/triggers.ts), not chosen: each line is the actual
 * value at which that input, moving alone, would carry the composite across a
 * band edge. That is why the numbers are odd rather than round — they are
 * answers, not targets.
 *
 * Two columns, four lines each at most, nearest-first. Anything longer stops
 * being a watchlist and becomes a wall.
 */
export function VerdictTriggersCard({
  fund,
  history,
  score,
}: {
  fund: FundProfileData;
  history: HistoryPoint[];
  score: ScoreResult;
}) {
  // A few hundred evaluations of a pure scorer — cheap, but no reason to repeat
  // it on every unrelated re-render of the page.
  const t = useMemo(
    () => deriveVerdictTriggers(fund, history, { composite: score.composite, recommendation: score.recommendation }),
    [fund, history, score.composite, score.recommendation],
  );

  if (t.upgrades.length === 0 && t.downgrades.length === 0) return null;

  return (
    <section className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-5">
      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-semibold">What would change this verdict</h3>
        <p className="text-caption text-muted">
          Solved from the scorer itself — the point at which each factor, moving on its own, flips the call.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {t.upgrades.length > 0 && t.upgradeTo && (
          <div className="flex flex-col gap-2">
            <span className="inline-flex items-center gap-1.5 text-caption font-semibold uppercase tracking-wider text-positive">
              <ArrowUpRight className="h-3.5 w-3.5" strokeWidth={2.25} />
              Upgrades to {RECOMMENDATION_LABEL[t.upgradeTo]} at {t.upgradeAt}
            </span>
            <ul className="flex flex-col gap-1.5">
              {t.upgrades.map((u) => (
                <li key={u.lever} className="text-sm leading-5 text-muted">
                  {u.lever} reaches{" "}
                  <span className="font-mono text-foreground">{u.to}</span>
                  <span className="text-faint"> (now {u.from})</span>
                  <BasisMark basis="calc" />
                </li>
              ))}
            </ul>
          </div>
        )}

        {t.downgrades.length > 0 && t.downgradeTo && (
          <div className="flex flex-col gap-2">
            <span className="inline-flex items-center gap-1.5 text-caption font-semibold uppercase tracking-wider text-negative">
              <ArrowDownRight className="h-3.5 w-3.5" strokeWidth={2.25} />
              Drops to {RECOMMENDATION_LABEL[t.downgradeTo]} at {t.downgradeAt}
            </span>
            <ul className="flex flex-col gap-1.5">
              {t.downgrades.map((d) => (
                <li key={d.lever} className="text-sm leading-5 text-muted">
                  {d.lever} slips to{" "}
                  <span className="font-mono text-foreground">{d.to}</span>
                  <span className="text-faint"> (now {d.from})</span>
                  <BasisMark basis="calc" />
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-1 border-t border-border/60 pt-3">
        <p className="text-micro leading-5 text-faint">
          Each condition holds every other factor still, so two of them moving together needs less of either.
          Factors our data source doesn&apos;t report for this fund are excluded rather than assumed.
        </p>
        <BasisLegend />
      </div>
    </section>
  );
}
