"use client";

import { useEffect, useMemo, useState } from "react";
import type { FundHolding, FundProfileData } from "@/lib/types";
import { analyzeOverlap, OVERLAP_BANDS, type OverlapPosition, type OverlapVerdict } from "@/lib/research-engines/fund/overlap";
import { useIOSSafe } from "@/lib/ios-context";
import { useDataset } from "@/lib/platform/client/use-dataset";
import { ValueBar } from "@/app/_components/value-bar";
import { BasisMark, BasisLegend } from "./basis";

/**
 * Portfolio impact — the question a generic ETF page structurally cannot answer:
 * not "what does this fund hold" but "what does buying it do to what I already
 * own".
 *
 * ── Why this costs nothing on load ────────────────────────────────────────
 * The user's positions are already in memory: IOSProvider loads the portfolio
 * report once per session for the whole app, and this reads it out of that
 * context. The overlap itself is arithmetic in `useMemo`. So the card is fully
 * populated in the same frame the fund data arrives — no fetch, no AI, no
 * spinner.
 *
 * The one exception is look-through. A user who owns VOO owns Apple whether or
 * not "AAPL" appears in their ledger, and direct matching alone would report
 * that as new exposure. Resolving it needs those funds' holdings, so it runs as
 * a DEFERRED enhancement: gated on the user actually holding funds, fired on
 * idle after first paint, served from the same platform cache the fund page
 * itself reads. The card renders complete direct-overlap results before it
 * lands and upgrades in place when it does — the analysis is never blocked on
 * it, and funds it couldn't see through are named rather than assumed empty.
 */

const VERDICT_STYLE: Record<OverlapVerdict, { label: string; className: string }> = {
  reinforces:  { label: "Reinforces what you own", className: "border-warning/40 bg-warning/10 text-warning" },
  partial:     { label: "Part duplicate",          className: "border-border bg-surface-2 text-muted" },
  diversifies: { label: "Mostly new exposure",     className: "border-positive/40 bg-positive/10 text-positive" },
  // A fund that itemises nothing (most bond funds) gets a stated non-answer,
  // never the green "mostly new exposure" that zero-of-zero matches would
  // otherwise earn it.
  unknown:     { label: "Not measurable",          className: "border-border bg-surface-2 text-faint" },
};

/** Held funds worth looking through, largest first. Bounded to match the route's cap. */
const LOOK_THROUGH_LIMIT = 8;

/**
 * Position size used when the fit engine recommends none.
 *
 * A "wait" or "avoid" call sets `suggestedAllocationPct` to 0, and projecting a
 * 0% purchase collapses every figure in this card to its current value — the
 * projection column reads 5.5% → 5.5%, the sector shift rounds to nothing, and
 * the analysis goes blank in precisely the case where the reader most wants to
 * know WHY they're being told to wait. So the projection falls back to a
 * nominal position and says, in the caption, that it is illustrative.
 */
const ILLUSTRATIVE_ALLOCATION_PCT = 5;

/** Sector-attribute values that name a wrapper or an asset class, not a sector. */
const PLACEHOLDER_SECTORS = new Set(["diversified", "cash", "other", "unknown", "n/a", "—", "-"]);

export function PortfolioImpactCard({
  symbol,
  fund,
  suggestedAllocationPct,
}: {
  symbol: string;
  fund: FundProfileData;
  /** The trade the rest of the page recommends, so the projection describes it. */
  suggestedAllocationPct: number | null;
}) {
  const ios = useIOSSafe();

  /* ── Positions, straight out of the already-loaded portfolio report ─────── */
  const positions: OverlapPosition[] = useMemo(() => {
    const holdings = ios?.report?.holdings ?? [];
    return holdings
      // The researched fund itself is a top-up, not an overlap — the position
      // action card upstream already covers "you own this".
      .filter((h) => (h.symbol ?? "").toUpperCase() !== symbol.toUpperCase())
      .map((h) => {
        const sector = h.attributes?.sector ?? null;
        return {
          symbol: h.symbol,
          name: h.name,
          weightPct: h.weight,
          // The portfolio model parks non-equity lines under placeholder sector
          // attributes ("Diversified" for a broad fund, "Cash" for cash). They
          // are not sectors, and letting them through printed rows like
          // "Diversified 22.8% → 21.7%" in a sector list — which is just the
          // arithmetic of dilution wearing a sector's name. Dropping them
          // leaves every real sector's projection unchanged, since those are
          // computed against total book weight either way.
          sector: sector && !PLACEHOLDER_SECTORS.has(sector.toLowerCase()) ? sector : null,
          isFund: h.assetClass === "etf",
        };
      });
  }, [ios?.report, symbol]);

  /* ── Deferred look-through into funds the user holds ────────────────────── */
  const heldFundSymbols = useMemo(
    () =>
      positions
        .filter((p) => p.isFund && p.symbol)
        .sort((a, b) => b.weightPct - a.weightPct)
        .slice(0, LOOK_THROUGH_LIMIT)
        .map((p) => p.symbol!.toUpperCase()),
    [positions],
  );

  // Off the critical path, exactly as IOSProvider defers the portfolio report:
  // nothing on this page should contend with first paint for an enhancement.
  const [idle, setIdle] = useState(false);
  useEffect(() => {
    if (heldFundSymbols.length === 0) return;
    const ric = (window as unknown as {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
    }).requestIdleCallback;
    const run = () => setIdle(true);
    const handle = ric ? ric(run, { timeout: 3000 }) : window.setTimeout(run, 400);
    return () => {
      const cic = (window as unknown as { cancelIdleCallback?: (h: number) => void }).cancelIdleCallback;
      if (ric && cic) cic(handle); else clearTimeout(handle);
    };
  }, [heldFundSymbols.length]);

  const lookThroughKey = heldFundSymbols.join(",");
  const lookThroughEntry = useDataset<{ holdings: Record<string, FundHolding[]> }>(
    "fundLookThrough",
    lookThroughKey || null,
    async (signal) => {
      const res = await fetch(`/api/fund/holdings?symbols=${encodeURIComponent(lookThroughKey)}`, { signal });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Look-through failed");
      return json as { holdings: Record<string, FundHolding[]> };
    },
    { enabled: idle && heldFundSymbols.length > 0 },
  );

  const recommendedAlloc = suggestedAllocationPct != null && suggestedAllocationPct >= 0.05
    ? suggestedAllocationPct
    : null;
  const allocationIsIllustrative = recommendedAlloc == null;

  const result = useMemo(
    () =>
      analyzeOverlap({
        fundHoldings: fund.holdings,
        fundSectorWeights: fund.sectorWeights,
        positions,
        addAllocationPct: recommendedAlloc ?? ILLUSTRATIVE_ALLOCATION_PCT,
        lookThrough: lookThroughEntry.data?.holdings,
      }),
    [fund.holdings, fund.sectorWeights, positions, recommendedAlloc, lookThroughEntry.data],
  );

  // No portfolio, nothing to say. An empty "0 overlaps" card is noise.
  if (positions.length === 0) return null;

  const style = VERDICT_STYLE[result.verdict];
  const topMatches = result.matches.slice(0, 5);
  const shifts = result.sectorShifts.filter((s) => Math.abs(s.deltaPct) >= 0.5).slice(0, 3);

  return (
    <section className="card-lift flex flex-col gap-4 rounded-xl border border-border bg-surface p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h3 className="text-sm font-semibold">Portfolio impact</h3>
          <p className="text-caption text-muted">
            Against the {positions.length} position{positions.length === 1 ? "" : "s"} you hold today
          </p>
        </div>
        <span className={`inline-flex w-fit items-center rounded-lg border px-2.5 py-1 text-xs font-semibold ${style.className}`}>
          {style.label}
          <BasisMark basis="read" />
        </span>
      </div>

      <p className="text-sm leading-6 text-muted">
        {result.headline}
        <BasisMark basis="read" />
      </p>

      {/* ── The headline number: a FLOOR on overlap, with its denominator ──── */}
      {result.matches.length > 0 && (
        <div className="flex flex-col gap-1.5 rounded-lg border border-border bg-surface-2 p-3.5">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-caption font-medium uppercase tracking-wider text-muted">
              Already-owned share of {symbol}
            </span>
            <span className="font-mono text-sm font-semibold tabular-nums text-foreground">
              ≥ {result.overlapWeightPct.toFixed(1)}%
              <BasisMark basis="calc" />
            </span>
          </div>
          <ValueBar value={Math.min(100, result.overlapWeightPct)} barClassName="bg-warning/70" trackClassName="bg-surface-3" />
          <p className="text-micro leading-5 text-faint">
            At least {result.overlapWeightPct.toFixed(1)}% of the fund&apos;s assets sit in companies you already have
            exposure to — {result.overlapOfDisclosedPct.toFixed(0)}% of the {result.disclosedWeightPct.toFixed(1)}% it
            itemises. Undisclosed holdings can only push the true figure higher, never lower.
            {result.recycledCapitalPct >= 0.1 && (
              <>
                {" "}Of the {result.addAllocationPct.toFixed(1)}% you&apos;d be adding, roughly{" "}
                <span className="text-muted">{result.recycledCapitalPct.toFixed(1)}pp</span> goes straight back into
                names you already hold.
              </>
            )}
          </p>
        </div>
      )}

      {/* ── Name-level overlap, with the projected book after the trade ────── */}
      {topMatches.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-caption font-medium uppercase tracking-wider text-muted">Largest overlaps</span>
            <span className="text-micro text-faint">
              if you add {symbol} at {result.addAllocationPct.toFixed(1)}% of the book
              {allocationIsIllustrative ? " (illustrative — no allocation is recommended today)" : ""}
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[26rem] text-left">
              <thead>
                <tr className="text-micro uppercase tracking-widest text-faint">
                  <th className="pb-1.5 font-semibold">Name</th>
                  <th className="pb-1.5 text-right font-semibold">In {symbol}</th>
                  <th className="pb-1.5 text-right font-semibold">You hold</th>
                  <th className="pb-1.5 text-right font-semibold">After</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {topMatches.map((m) => (
                  <tr key={m.symbol} className="text-sm">
                    <td className="py-1.5">
                      <span className="font-mono text-accent">{m.symbol}</span>
                      {m.indirectWeightPct > 0 && (
                        <span
                          className="ml-1.5 text-micro text-faint"
                          title={`Held inside ${m.viaFunds.join(", ")}`}
                        >
                          via {m.viaFunds.join(", ")}
                        </span>
                      )}
                    </td>
                    <td className="py-1.5 text-right font-mono tabular-nums text-muted">{m.fundWeightPct.toFixed(1)}%</td>
                    <td className="py-1.5 text-right font-mono tabular-nums text-muted">{m.currentWeightPct.toFixed(1)}%</td>
                    <td className="py-1.5 text-right font-mono tabular-nums text-foreground">
                      {m.projectedWeightPct.toFixed(1)}%
                      <span className={`ml-1 text-micro ${m.deltaPct >= 0 ? "text-warning" : "text-positive"}`}>
                        {m.deltaPct >= 0 ? "+" : ""}{m.deltaPct.toFixed(1)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Sector-level shift — complete on both sides, unlike name overlap ── */}
      {shifts.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <span className="text-caption font-medium uppercase tracking-wider text-muted">
            What it does to your sector mix
            <BasisMark basis="calc" />
          </span>
          <ul className="flex flex-col gap-1">
            {shifts.map((s) => (
              <li key={s.sector} className="flex items-baseline justify-between gap-3 text-sm">
                <span className="text-muted">{s.sector}</span>
                <span className="font-mono tabular-nums text-foreground">
                  {s.currentPct.toFixed(1)}% → {s.projectedPct.toFixed(1)}%
                  <span className={`ml-1.5 text-micro ${s.deltaPct >= 0 ? "text-warning" : "text-positive"}`}>
                    {s.deltaPct >= 0 ? "+" : ""}{s.deltaPct.toFixed(1)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ── What this analysis can and cannot see ──────────────────────────── */}
      <div className="flex flex-col gap-1 border-t border-border/60 pt-3">
        <p className="text-micro leading-5 text-faint">
          Projections assume the purchase is funded with new money, so existing weights dilute by the
          amount added.
          {result.holdingsDisclosed
            ? ` “Reinforces” means at least ${OVERLAP_BANDS.reinforces}% of the fund's itemised weight is already owned; below ${OVERLAP_BANDS.partial}% it reads as new exposure.`
            : " The sector projection above is still exact — sector weights are reported in full even when individual positions are not."}
          {result.lookThroughApplied && " Names you hold inside other ETFs are included."}
          {result.unlookedFunds.length > 0 &&
            ` Holdings inside ${result.unlookedFunds.join(", ")} could not be resolved, so any overlap through ${result.unlookedFunds.length === 1 ? "it" : "them"} is not counted.`}
          {lookThroughEntry.status === "loading" && " Checking the funds you hold for hidden overlap…"}
        </p>
        <BasisLegend />
      </div>
    </section>
  );
}
