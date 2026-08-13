"use client";

/**
 * The concentration ribbon — the first thing on screen and the whole product in
 * one sentence.
 *
 * "Your top 5 effective positions are 32.4% of book. Your position list shows
 * 19.4%." That single comparison is the reason the feature exists, so it gets
 * the page's one piece of headline typography and sits above everything else,
 * including the findings.
 *
 * The comparison holds the NAMES fixed and varies the measurement. Comparing
 * the effective top five against the *stated* top five would be two different
 * name sets and therefore not a comparison at all — the gap has to be
 * attributable to be worth printing.
 */

import type { ExposureGraph } from "@/lib/exposure/types";
import type { GraphIndex } from "@/lib/exposure/query";
import { Pct, TONE_COLOR } from "./primitives";
import type { Navigate } from "./nav";

export function Ribbon({
  graph,
  index,
  navigate,
}: {
  graph: ExposureGraph;
  index: GraphIndex;
  navigate: Navigate;
}) {
  const { concentration } = graph;
  const top = concentration.topIssuerIds
    .map((id) => index.issuerById.get(id))
    .filter((x): x is NonNullable<typeof x> => x != null);

  if (top.length === 0) {
    return (
      <div className="border-y border-hairline px-1 py-5 text-sm text-muted">
        No equity issuer exposure could be resolved from this portfolio yet.
      </div>
    );
  }

  // The bar is scaled to the whole book, so the "everything else" remainder is
  // visible: a top five that fills half the bar reads as concentration without
  // the reader doing arithmetic.
  const rest = Math.max(0, 100 - concentration.effectivePct);

  return (
    <div className="space-y-3 border-y border-hairline px-1 py-5">
      {/* Labels sit UNDER the bar, not inside it. A ticker printed on a
          coloured band has to survive both themes and both route colours at
          once, and there is no single text colour that does — so the bar
          carries proportion and the row beneath carries the words. */}
      <div className="space-y-1">
        <div className="flex h-6 w-full overflow-hidden rounded-sm bg-surface-3">
          {top.map((issuer) => {
            const directShare = issuer.effectivePct > 0 ? issuer.directPct / issuer.effectivePct : 0;
            return (
              <button
                key={issuer.id}
                onClick={() => navigate({ nodeId: issuer.id, view: "trace" })}
                title={`${issuer.symbol} — ${issuer.effectivePct.toFixed(2)}% effective, ${issuer.directPct.toFixed(2)}% held directly`}
                className="relative min-w-0 border-r border-background transition-opacity duration-[var(--duration-feedback)] hover:opacity-80"
                style={{ width: `${issuer.effectivePct}%`, background: TONE_COLOR.fund }}
                aria-label={`${issuer.symbol}, ${issuer.effectivePct.toFixed(2)} percent effective`}
              >
                {/* The chosen part of each name, drawn inside its own band. */}
                <span
                  aria-hidden
                  className="absolute inset-y-0 left-0"
                  style={{ width: `${directShare * 100}%`, background: TONE_COLOR.direct }}
                />
              </button>
            );
          })}
          <div style={{ width: `${rest}%` }} title={`Everything else — ${rest.toFixed(1)}% of book`} />
        </div>

        <div className="flex w-full">
          {top.map((issuer) => (
            <button
              key={issuer.id}
              onClick={() => navigate({ nodeId: issuer.id, view: "trace" })}
              className="min-w-0 truncate pr-1 text-left font-mono text-[10px] font-medium text-muted transition-colors duration-[var(--duration-feedback)] hover:text-foreground"
              style={{ width: `${issuer.effectivePct}%` }}
            >
              {issuer.symbol}
            </button>
          ))}
          <span
            className="truncate pl-1 text-right font-mono text-[10px] text-faint"
            style={{ width: `${rest}%` }}
          >
            everything else {rest.toFixed(0)}%
          </span>
        </div>
      </div>

      <p className="text-[15px] leading-snug text-foreground">
        Your top {top.length} effective positions are{" "}
        <span className="font-mono font-semibold">
          <Pct value={concentration.effectivePct} dp={1} />
        </span>{" "}
        of book. Your position list shows{" "}
        <span className="font-mono text-muted">
          <Pct value={concentration.statedPct} dp={1} />
        </span>
        .
        {concentration.hiddenPp > 0.05 ? (
          <>
            {" "}
            <span className="text-muted">
              The other{" "}
              <span className="font-mono text-chart-1">{concentration.hiddenPp.toFixed(1)}pp</span>{" "}
              arrived inside funds you bought for something else.
            </span>
          </>
        ) : null}
      </p>
    </div>
  );
}

/**
 * The coverage stamp. Placed in the header, not a footnote: an effective-exposure
 * figure quoted without saying how much of the book it could see into is a claim
 * about the whole portfolio made from a fraction of it.
 */
export function CoverageStamp({ graph }: { graph: ExposureGraph }) {
  const { coverage } = graph;
  const analysed = coverage.fundsAnalyzed;
  const opaque = coverage.fundsOpaque.length;

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-muted">
      <span className="font-mono">
        {analysed}/{analysed + opaque} fund lines looked through
      </span>
      {opaque > 0 ? (
        <>
          <span className="text-faint">·</span>
          <span className="text-warning" title={coverage.fundsOpaque.join(", ")}>
            {opaque} opaque
          </span>
        </>
      ) : null}
      <span className="text-faint">·</span>
      <span className="font-mono" title="Share of book that maps to at least one issuer">
        {coverage.issuerMappedPct.toFixed(0)}% issuer-mapped
      </span>
      <span className="text-faint">·</span>
      <span className="font-mono">
        as of{" "}
        {new Date(coverage.asOf).toLocaleTimeString(undefined, {
          hour: "2-digit",
          minute: "2-digit",
        })}
      </span>
    </div>
  );
}
