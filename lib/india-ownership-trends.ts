/**
 * Multi-quarter ownership trend math — the ONE implementation shared by the
 * screener (lib/india-ownership.ts), the Research Hub ownership tab, the
 * Results Radar and results notifications.
 *
 * Pure and dependency-free by design: no cache, no db, no fetch — safe to
 * import from client components and server modules alike. Every function is
 * deterministic over the disclosed SEBI shareholding series; nothing here
 * interpolates, estimates, or bridges missing quarters.
 */

/** One disclosed quarter of the SEBI shareholding pattern — exact values, never interpolated. */
export interface OwnershipObservation {
  period: string;               // "Jun 2026", as disclosed
  promoter: number | null;      // % — null when the company has no promoter / undisclosed
  fii: number | null;
  dii: number | null;
}

export interface OwnershipTrends {
  /**
   * SIGNED streak of consecutive disclosed quarters: +3 = rose each of the
   * last 3 QoQ steps (≥0.05pp each), −2 = fell each of the last 2, 0 = the
   * latest step was flat. Null when the history is missing or has fewer than
   * two disclosed observations for the holder.
   */
  promoterStreak: number | null;
  fiiStreak: number | null;
  diiStreak: number | null;
  /**
   * Percentage-point change over the last 4 disclosed QoQ steps (needs 5
   * observations — both endpoints must be REAL disclosures, never estimated).
   */
  promoterChange4Q: number | null;
  fiiChange4Q: number | null;
  diiChange4Q: number | null;
}

/** Moves smaller than this (pp) are disclosure noise, not accumulation/selling. */
export const STREAK_NOISE_PP = 0.05;

/** Signed run-length of consecutive steps ≥0.05pp in one direction, newest backwards. */
export function streakOfSeries(vals: number[] | null): number | null {
  if (!vals || vals.length < 2) return null;
  let dir = 0;
  let count = 0;
  for (let i = vals.length - 1; i > 0; i--) {
    const step = vals[i] - vals[i - 1];
    const sign = step > STREAK_NOISE_PP ? 1 : step < -STREAK_NOISE_PP ? -1 : 0;
    if (count === 0) {
      if (sign === 0) return 0;
      dir = sign;
      count = 1;
    } else if (sign === dir) {
      count++;
    } else {
      break;
    }
  }
  return dir * count;
}

/** pp change over the last `n` steps; null unless both endpoints are real. */
export function changeOverN(vals: number[] | null, n: number): number | null {
  if (!vals || vals.length < n + 1) return null;
  return Number((vals[vals.length - 1] - vals[vals.length - 1 - n]).toFixed(2));
}

/**
 * The contiguous disclosed tail of one holder's series — a null observation
 * BREAKS the series at that point (trends never bridge a gap).
 */
export function contiguousTail(
  history: OwnershipObservation[] | undefined,
  key: "promoter" | "fii" | "dii",
): number[] | null {
  if (!history || history.length < 2) return null;
  const vals: number[] = [];
  for (let i = history.length - 1; i >= 0; i--) {
    const v = history[i][key];
    if (v == null) break;
    vals.unshift(v);
  }
  return vals.length >= 2 ? vals : null;
}

/** All trend figures from a disclosed history. */
export function trendsFromHistory(history: OwnershipObservation[] | undefined): OwnershipTrends {
  const promoter = contiguousTail(history, "promoter");
  const fii = contiguousTail(history, "fii");
  const dii = contiguousTail(history, "dii");
  return {
    promoterStreak: streakOfSeries(promoter),
    fiiStreak: streakOfSeries(fii),
    diiStreak: streakOfSeries(dii),
    promoterChange4Q: changeOverN(promoter, 4),
    fiiChange4Q: changeOverN(fii, 4),
    diiChange4Q: changeOverN(dii, 4),
  };
}

/**
 * True when the latest disclosure period ("Jun 2026") is recent enough for
 * ownership context to accompany CURRENT events (~two disclosure cycles).
 */
export function isOwnershipCurrent(period: string | null | undefined, now = Date.now()): boolean {
  if (!period) return false;
  const t = Date.parse(`28 ${period} UTC`);
  return Number.isFinite(t) && now - t < 200 * 86_400_000;
}

const signedPp = (v: number) => `${v > 0 ? "+" : ""}${v.toFixed(1)}pp`;

/**
 * The single most significant ownership signal as one prose clause, or null
 * when nothing clears the bar. Used by the Results Radar and notifications.
 * Descriptive only — never implies causation for a result or price move.
 */
export function ownershipContextLine(t: OwnershipTrends): string | null {
  if (t.fiiStreak != null && t.fiiStreak <= -3) return `FII selling for ${-t.fiiStreak} consecutive quarters`;
  if (t.fiiStreak != null && t.fiiStreak >= 3) return `FII accumulation for ${t.fiiStreak} consecutive quarters`;
  if (t.promoterChange4Q != null && t.promoterChange4Q <= -2)
    return `promoter stake ${signedPp(t.promoterChange4Q)} over the last 4 disclosed quarters`;
  if (t.promoterChange4Q != null && t.promoterChange4Q >= 1)
    return `promoter stake ${signedPp(t.promoterChange4Q)} over the last 4 disclosed quarters`;
  if (t.diiStreak != null && t.diiStreak >= 3) return `DII accumulation for ${t.diiStreak} consecutive quarters`;
  return null;
}

/**
 * Up to two compact chips for table cells ("FII ↓3Q", "Prom +1.4pp/4Q").
 * Ordered by salience; empty when nothing clears the noise bar.
 */
export function ownershipTrendChips(t: OwnershipTrends): string[] {
  const chips: string[] = [];
  if (t.fiiStreak != null && Math.abs(t.fiiStreak) >= 2) {
    chips.push(`FII ${t.fiiStreak > 0 ? "↑" : "↓"}${Math.abs(t.fiiStreak)}Q`);
  } else if (t.fiiChange4Q != null && Math.abs(t.fiiChange4Q) >= 1) {
    chips.push(`FII ${signedPp(t.fiiChange4Q)}/4Q`);
  }
  if (t.promoterChange4Q != null && Math.abs(t.promoterChange4Q) >= 1) {
    chips.push(`Prom ${signedPp(t.promoterChange4Q)}/4Q`);
  } else if (t.promoterStreak != null && Math.abs(t.promoterStreak) >= 2) {
    chips.push(`Prom ${t.promoterStreak > 0 ? "↑" : "↓"}${Math.abs(t.promoterStreak)}Q`);
  }
  if (chips.length < 2 && t.diiStreak != null && Math.abs(t.diiStreak) >= 3) {
    chips.push(`DII ${t.diiStreak > 0 ? "↑" : "↓"}${Math.abs(t.diiStreak)}Q`);
  }
  return chips.slice(0, 2);
}
