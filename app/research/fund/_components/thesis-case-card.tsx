"use client";

import { useMemo } from "react";
import type { FundProfileData, HistoryPoint, ScoreResult } from "@/lib/types";
import { parseMandate } from "@/lib/research-engines/fund/exposure";
import { buildThesisCase, type EvidenceLine } from "@/lib/research-engines/fund/evidence";
import { analyzeRegimeBehavior } from "@/lib/research-engines/fund/behavior";
import { BasisMark, BasisLegend } from "./basis";

/**
 * Thesis → evidence → verdict.
 *
 * The conclusion here is the score the conviction card already shows, and every
 * line under it is one of the factors that produced it — so this is the audit
 * trail of the call rather than a second opinion about it. Written by
 * lib/research-engines/fund/evidence.ts, not by a model: a deterministic case
 * cannot contradict its own headline, which is the failure mode that makes
 * generated research prose untrustworthy.
 *
 * The two capture ratios are folded in as extra evidence because they measure
 * something the fund scorer has no input for, and they are frequently the most
 * important thing on the page — a fund can score well on cost and category
 * performance while taking 130% of the market's downside.
 */
export function ThesisCaseCard({
  name,
  fund,
  score,
  history,
  benchmarkHistory,
  benchmarkLabel,
  usListed,
}: {
  name: string;
  fund: FundProfileData;
  score: ScoreResult;
  history: HistoryPoint[];
  benchmarkHistory: HistoryPoint[];
  benchmarkLabel: string;
  usListed: boolean;
}) {
  const regime = useMemo(
    () => analyzeRegimeBehavior(history, benchmarkHistory, benchmarkLabel),
    [history, benchmarkHistory, benchmarkLabel],
  );

  const thesisCase = useMemo(() => {
    const supports: EvidenceLine[] = [];
    const against: EvidenceLine[] = [];
    if (regime.upCapturePct != null && regime.downCapturePct != null) {
      const line = {
        label: "Capture profile",
        detail: `${Math.round(regime.upCapturePct)}% up capture against ${Math.round(regime.downCapturePct)}% down capture vs ${benchmarkLabel}`,
        strength: 0.8,
      };
      // The asymmetry IS the judgement: taking less downside than upside is a
      // point in favour, the reverse is a point against, and near-parity is
      // neither and so is not claimed as either.
      const spread = regime.upCapturePct - regime.downCapturePct;
      if (spread > 5) supports.push(line);
      else if (spread < -5) against.push(line);
    }
    return buildThesisCase({
      name,
      score,
      mandate: parseMandate(fund.category, usListed),
      extras: { supports, against },
    });
  }, [name, score, fund.category, usListed, regime, benchmarkLabel]);

  return (
    <section className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-5">
      <div className="flex flex-col gap-1.5">
        <span className="text-micro font-semibold uppercase tracking-widest text-faint">Thesis</span>
        <p className="text-sm leading-6 text-foreground">
          {thesisCase.thesis}
          <BasisMark basis="read" />
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <EvidenceColumn title="Supporting evidence" tone="positive" lines={thesisCase.supports} />
        <EvidenceColumn title="Against" tone="negative" lines={thesisCase.against} />
      </div>

      <div className="rounded-lg border border-border/60 bg-surface-2 px-4 py-3">
        <span className="text-micro font-semibold uppercase tracking-widest text-faint">Verdict</span>
        <p className="mt-1 text-sm leading-6 text-muted">
          {thesisCase.verdict}
          <BasisMark basis="read" />
        </p>
      </div>

      <BasisLegend />
    </section>
  );
}

function EvidenceColumn({
  title,
  tone,
  lines,
}: {
  title: string;
  tone: "positive" | "negative";
  lines: EvidenceLine[];
}) {
  const color = tone === "positive" ? "text-positive" : "text-negative";
  const dot = tone === "positive" ? "bg-positive/60" : "bg-negative/60";
  return (
    <div className="flex flex-col gap-2">
      <span className={`text-caption font-semibold uppercase tracking-wider ${color}`}>{title}</span>
      {lines.length === 0 ? (
        <p className="text-caption text-faint">
          Nothing in the scored evidence lands on this side.
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {lines.slice(0, 4).map((l) => (
            <li key={l.label} className="flex gap-2 text-sm leading-5 text-muted">
              <span aria-hidden="true" className={`mt-1.5 h-1 w-1 shrink-0 rounded-full ${dot}`} />
              <span>
                {l.detail}
                <BasisMark basis="calc" />
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
