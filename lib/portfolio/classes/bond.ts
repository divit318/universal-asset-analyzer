import { registerClass, coverage, lerpScore, shrinkToConfidence } from "../model/adapter";
import { marketValuation, yieldIncome, riskModelFor } from "./market-base";
import type { PortfolioClassAdapter } from "../model/adapter";

/**
 * Bonds — the class the current engine gets most wrong.
 *
 * Today a bond fund has no FundamentalsSnapshot, so it scores a fabricated 50, has
 * no GICS sector so it lands in "Unknown", contributes NOTHING to factor exposure,
 * and is shocked a flat -20% in every crisis scenario — when in a real flight to
 * quality Treasuries RALLY. The one asset most people hold to protect a portfolio
 * is modelled as a slightly worse stock.
 *
 * What's real (per lib/assets/bond.ts): individual CUSIP bonds have no free feed at
 * all, so what we can genuinely hold and analyse is bond *funds*.
 *
 * ⚠️ CORRECTION (2026-07-29). This file used to say that Yahoo's
 * `topHoldings.bondHoldings` gives a real duration and maturity, and it took them at
 * face value. It does not: probed against live data it reports 3.55 years for TLT
 * (true ≈ 16), 3.88 for a floating-rate fund (true ≈ 0.02), 1.30 for TIP (true ≈
 * 6.5) and nothing at all for VCLT. Duration is now MEASURED from the fund's own
 * returns against the 10-year Treasury yield, with a curated per-category reference
 * as the fallback — see classes/reference/risk-models.ts. Coupon and callability
 * remain `unavailable`; we don't invent them.
 */
/**
 * Keep the provider's average maturity only where it is consistent with the fund's
 * modelled duration. Duration ≤ maturity always holds for a cash bond, and the two
 * cannot be wildly far apart for a real portfolio; outside that, the field is one of
 * the demonstrably broken ones (see ContextFundamentals.duration) and reporting it
 * would put a wrong number next to a right one.
 */
function plausibleMaturity(maturity: number | null, duration: number | null): number | null {
  if (maturity == null || !Number.isFinite(maturity) || maturity <= 0) return null;
  if (duration == null) return maturity;
  if (maturity < duration * 0.9) return null;
  return maturity <= duration * 3 + 2 ? maturity : null;
}

export const bondAdapter: PortfolioClassAdapter = {
  id: "bond",
  valuationMode: "market",
  // Bond funds settle in days, not same-day like a listed equity.
  defaultLiquidity: "t1",
  // NOTE: `face` means quantity is face value and the quote is a % of par.
  // Bond FUNDS are bought in shares; a user holding a fund should record shares.
  // marketValuation() branches on unit, so both are handled correctly.
  unit: "shares",
  registryClass: "bond",
  manualStalenessDays: null,

  value: marketValuation,
  income: (raw, val, ctx) => yieldIncome(raw, val, ctx, "coupon"),

  /**
   * Three things changed here, all of them corrections:
   *
   *  1. DURATION IS MEASURED, NOT READ OFF A FIELD. The provider's
   *     `bondHoldings.duration` claims 3.55 for TLT (true ≈ 16), 3.88 for a
   *     floating-rate fund (true ≈ 0.02) and 1.30 for TIP (true ≈ 6.5). Rate
   *     sensitivity now comes from the fund's own returns regressed on the 10-year
   *     yield, with the category's curated duration as the fallback.
   *  2. CREDIT-SPREAD SENSITIVITY SCALES WITH DURATION. Spread duration ≈ effective
   *     duration, so a 13-year corporate fund loses ~13% per 1pp of widening while
   *     a 2-year one loses ~2%. A flat number per rating bucket — what this
   *     replaces — cannot express that, and it under-stated long credit badly.
   *  3. EQUITY BETA IS USED WHEN IT EXISTS. High-yield and EM funds have a real,
   *     measurable equity beta (~0.45); the old code pinned every bond fund at 0.1.
   *
   * Inflation-linked funds get rates −D and inflation +D, so a scenario where
   * inflation outruns the policy response makes TIPS GAIN. The old model gave them
   * inflation −0.8: the wrong sign on the one bond people own for inflation.
   */
  factors(raw, ctx) {
    return riskModelFor(raw, ctx).factors;
  },

  metrics(raw, ctx) {
    const f = raw.symbol ? ctx.fundamentals.get(raw.symbol.toUpperCase()) : undefined;
    // The modelled effective duration — the same number the stress test uses.
    const duration = riskModelFor(raw, ctx).duration;
    return {
      duration,
      // Average maturity, SUPPRESSED when it cannot be true of a fund with this
      // duration. The provider reported 9.8 years for a 1-3 year Treasury fund
      // (SHY), 10.0 for a floating-rate fund (USFR) and 8.0 for a 20-year+ fund
      // (TLT). A maturity below the duration is impossible for a cash bond, and one
      // several times the duration is not a portfolio anyone runs — either way it is
      // a bad number, and "—" is the honest rendering of a bad number.
      maturity: plausibleMaturity(f?.maturity ?? null, duration),
      // `dividendYield` arrives from the provider as a FRACTION (0.0432), but the
      // portfolio model's `yield` metric is in PERCENT everywhere else — cash
      // reports APY as 4.32, real estate reports capRatePercent, and so on. It is
      // converted here, at the boundary, so one metric key never carries two
      // different units. (Before this, the display layer guessed from magnitude
      // and got a 100x error on anything above 1.)
      yield: f?.dividendYield != null ? f.dividendYield * 100 : null,
      expenseRatio: f?.expenseRatio ?? null,
    };
  },

  attributes(raw, ctx) {
    const f = raw.symbol ? ctx.fundamentals.get(raw.symbol.toUpperCase()) : undefined;
    return {
      sector: "Fixed Income",
      creditQuality: f?.creditQuality ?? null,
      geography: f?.country ?? null,
      currency: f?.currency ?? raw.currency,
      riskModel: riskModelFor(raw, ctx).label,
    };
  },

  /**
   * A bond is scored on yield, duration risk and credit quality — the things a bond
   * actually is. Not on P/E.
   */
  score(raw, ctx) {
    const f = raw.symbol ? ctx.fundamentals.get(raw.symbol.toUpperCase()) : undefined;
    if (!f) return null;

    const y = f.dividendYield != null
      ? (f.dividendYield > 1 ? f.dividendYield : f.dividendYield * 100)
      : null;

    // Scored on the SAME duration the stress test uses, not the provider field.
    const duration = riskModelFor(raw, ctx).duration;
    const inputs = [y, duration, f.expenseRatio];
    const conf = coverage(inputs);
    if (conf === 0) return null;

    const why: string[] = [];
    let weighted = 0;
    let used = 0;

    if (y != null) {
      const s = lerpScore(y, 0, 7);
      weighted += s * 0.5;
      used += 0.5;
      if (y >= 4.5) why.push(`Attractive ${y.toFixed(2)}% yield`);
    }
    if (duration != null) {
      // Long duration is not "bad" in the abstract — it's rate RISK. Score it as
      // risk: shorter = safer. The optimizer, not the scorer, decides whether the
      // portfolio wants that risk.
      const s = lerpScore(duration, 20, 2);
      weighted += s * 0.3;
      used += 0.3;
      if (duration >= 10) why.push(`High rate sensitivity (${duration.toFixed(1)}y duration)`);
    }
    if (f.expenseRatio != null) {
      const s = lerpScore(f.expenseRatio, 0.8, 0.03);
      weighted += s * 0.2;
      used += 0.2;
    }

    if (used === 0) return null;
    return {
      score: Math.round(shrinkToConfidence(weighted / used, conf)),
      confidence: Math.round(conf),
      why: why.slice(0, 3),
    };
  },

  row: {
    primary: ["yield", "duration", "maturity"],
    secondary: ["expenseRatio"],
  },
};

registerClass(bondAdapter);
