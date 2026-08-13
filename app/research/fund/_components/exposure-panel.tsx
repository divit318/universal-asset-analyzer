"use client";

import type { FundExposure } from "@/lib/research-engines/fund/exposure";
import { CollapsibleSection } from "@/app/_components/collapsible-section";
import { BasisMark, BasisLegend } from "./basis";

/**
 * The "see why" layer under the conviction score: why this fund behaves the way
 * it does, in terms of what it actually holds.
 *
 * Collapsed by default and deliberately so — the score and the portfolio impact
 * are the answer, and this is the evidence behind the one-sentence read already
 * printed in the masthead (FundOrientation). Opening it is the path from
 * "54/100, Hold" to understanding.
 *
 * Nothing here restates a figure shown elsewhere without doing something with
 * it. Sector weights get their chart on the Anatomy tab; what appears here is
 * the arithmetic those weights imply — cluster shock, single-name shock, how
 * much of the fund the disclosure even covers.
 */
export function ExposurePanel({ exposure }: { exposure: FundExposure }) {
  const c = exposure.concentration;

  const rows: { label: string; value: string; note?: string }[] = [];
  if (c.largest) {
    rows.push({
      label: "Largest position",
      value: `${c.largest.symbol || c.largest.name} · ${c.largest.weightPercent.toFixed(1)}%`,
      note: c.largestNameShockPct != null ? `−20% in it ≈ −${c.largestNameShockPct.toFixed(1)}pp on the fund` : undefined,
    });
  }
  if (c.top5Pct != null) rows.push({ label: "Top 5", value: `${c.top5Pct.toFixed(1)}%` });
  if (c.top10Pct != null) rows.push({ label: "Top 10", value: `${c.top10Pct.toFixed(1)}%` });
  if (c.clusterPct != null && c.clusterSectors.length > 0) {
    rows.push({
      label: c.clusterSectors.length === 1 ? "Dominant sector" : `Top ${c.clusterSectors.length} sectors`,
      value: `${c.clusterPct.toFixed(1)}%`,
      note: c.clusterShockPct != null ? `−10% across them ≈ −${c.clusterShockPct.toFixed(1)}pp` : undefined,
    });
  }
  if (c.sectorHhi != null) {
    rows.push({
      label: "Sector concentration",
      value: String(c.sectorHhi),
      // Stated in the reader's terms rather than left as a bare index: an HHI
      // means nothing without knowing that 10000 is one sector and ~900 is eleven
      // equal ones.
      note: "Herfindahl, 0–10,000 · an evenly split 11-sector fund scores ~900",
    });
  }

  // A fund that itemises neither holdings nor sectors (GLD, most single-
  // commodity trusts) leaves nothing here but the caveat paragraph. The
  // masthead's one-line read already covers those; an expander that opens onto
  // a disclaimer is worse than no expander.
  if (exposure.bets.length === 0 && rows.length === 0) return null;

  return (
    <CollapsibleSection
      title="What you're actually buying"
      subtitle="The implicit bets behind the score — concentration, cluster risk and mandate"
    >
      <div className="flex flex-col gap-4">
        {exposure.bets.length > 0 && (
          <ul className="flex flex-col gap-2.5">
            {exposure.bets.map((b) => (
              <li key={b.text} className="flex gap-2.5 text-sm leading-6 text-muted">
                <span aria-hidden="true" className="mt-2 h-1 w-1 shrink-0 rounded-full bg-accent/60" />
                <span>
                  {b.text}
                  <BasisMark basis={b.basis} />
                </span>
              </li>
            ))}
          </ul>
        )}

        {rows.length > 0 && (
          <dl className="grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-2">
            {rows.map((r) => (
              <div key={r.label} className="flex flex-col gap-0.5 bg-surface p-3">
                <dt className="text-micro font-semibold uppercase tracking-widest text-faint">{r.label}</dt>
                <dd className="font-mono text-sm tabular-nums text-foreground">
                  {r.value}
                  <BasisMark basis="calc" />
                </dd>
                {r.note && <p className="text-micro leading-4 text-muted">{r.note}</p>}
              </div>
            ))}
            {/* Completes a part-filled last row — the grid's hairlines are a
                bg-border sheet, so a gap in it reads as a stray filled block. */}
            {rows.length % 2 === 1 && <div aria-hidden="true" className="hidden bg-surface sm:block" />}
          </dl>
        )}

        {/* The coverage caveat, stated once, where the numbers above are read.
            Our provider discloses roughly the ten largest positions — not the
            whole portfolio — and every figure above is scoped to that. */}
        <p className="text-micro leading-5 text-faint">
          Position figures cover the {c.disclosedCount} holdings our data source discloses
          ({c.disclosedWeightPct.toFixed(1)}% of assets); the remainder of the portfolio is not itemised.
          Sector weights are complete. Shock figures are arithmetic on weights alone — they assume nothing
          else moves and ignore correlation.
        </p>
        <BasisLegend />
      </div>
    </CollapsibleSection>
  );
}
