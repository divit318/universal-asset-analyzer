"use client";

import { useMemo } from "react";
import type { FundProfileData } from "@/lib/types";
import { deriveFundExposure } from "@/lib/research-engines/fund/exposure";
import { LoadingMark } from "@/app/_components/loading-mark";
import { BasisMark } from "./basis";

/**
 * The fund's orientation layer — "what are you actually buying?" — rendered in
 * the masthead, in the same slot and with the same reasoning as
 * CompanyOrientation for equities: the reader should know what the instrument
 * IS before being shown numbers about it. Funds previously had no such layer at
 * all; the page went straight from a ticker to a score.
 *
 * One sentence and a chip row, nothing more. The interpretation this summarises
 * — the implicit bets, the concentration arithmetic — lives one click away on
 * the Conviction tab (ExposurePanel), so the masthead stays scannable and the
 * same facts are never printed twice.
 *
 * Computed in render from data the page already holds. No fetch, no AI.
 */
export function FundOrientation({
  fund,
  loading,
  usListed,
}: {
  fund: FundProfileData | null;
  loading: boolean;
  usListed: boolean;
}) {
  const exposure = useMemo(
    () => (fund ? deriveFundExposure(fund, usListed) : null),
    [fund, usListed],
  );

  if (!exposure && loading) {
    return (
      <div className="flex items-center gap-2 border-t border-border px-5 py-3 text-caption text-muted">
        <LoadingMark size={13} label="Reading fund exposure" />
        Reading what this fund actually holds…
      </div>
    );
  }
  if (!exposure || (!exposure.headline && exposure.chips.length === 0)) return null;

  return (
    <div className="flex flex-col gap-2 border-t border-border px-5 py-3">
      {exposure.headline && (
        <p className="max-w-4xl text-sm leading-relaxed text-muted">
          <span className="font-medium text-foreground">What you&apos;re actually buying:</span>{" "}
          {exposure.headline}
          <BasisMark basis="read" />
        </p>
      )}
      {exposure.chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {exposure.chips.map((c) => (
            <span key={c.label} className="text-caption text-muted">
              <span className="text-micro font-semibold uppercase tracking-widest text-faint">{c.label}</span>{" "}
              <span className="text-foreground">{c.value}</span>
              <BasisMark basis={c.basis} />
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
