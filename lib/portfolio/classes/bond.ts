import { registerClass, coverage, lerpScore, shrinkToConfidence } from "../model/adapter";
import { marketValuation, yieldIncome } from "./market-base";
import { CLASS_FACTORS, CREDIT_SPREAD_BETA, mergeFactors } from "./reference/factor-sensitivities";
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
 * all, so what we can genuinely hold and analyse is bond *funds*, where Yahoo's
 * `topHoldings` really does return `bondHoldings.duration` / `.maturity` and a full
 * `bondRatings` breakdown. Duration and credit quality are therefore MEASURED, and
 * they drive the two factor sensitivities that matter. Coupon and callability stay
 * `unavailable` — we don't invent them.
 */
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

  factors(raw, ctx) {
    const f = raw.symbol ? ctx.fundamentals.get(raw.symbol.toUpperCase()) : undefined;

    // The real number, straight from the provider. A 7-year duration means a +1pp
    // rate move is a -7% price move. This is not an estimate.
    const duration = f?.duration ?? null;
    const rates = duration != null && Number.isFinite(duration) && duration > 0
      ? -duration
      : CLASS_FACTORS.bond.rates!;

    // Credit quality decides the SIGN of credit-spread sensitivity: Treasuries gain
    // when spreads blow out (flight to quality), junk loses badly.
    const quality = (f?.creditQuality ?? "").toLowerCase();
    const creditSpread = CREDIT_SPREAD_BETA[quality] ?? CLASS_FACTORS.bond.creditSpread!;

    return mergeFactors(CLASS_FACTORS.bond, { rates, creditSpread });
  },

  metrics(raw, ctx) {
    const f = raw.symbol ? ctx.fundamentals.get(raw.symbol.toUpperCase()) : undefined;
    return {
      duration: f?.duration ?? null,
      maturity: f?.maturity ?? null,
      yield: f?.dividendYield ?? null,
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

    const inputs = [y, f.duration, f.expenseRatio];
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
    if (f.duration != null) {
      // Long duration is not "bad" in the abstract — it's rate RISK. Score it as
      // risk: shorter = safer. The optimizer, not the scorer, decides whether the
      // portfolio wants that risk.
      const s = lerpScore(f.duration, 20, 2);
      weighted += s * 0.3;
      used += 0.3;
      if (f.duration >= 10) why.push(`High rate sensitivity (${f.duration.toFixed(1)}y duration)`);
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
