import { registerClass, coverage, lerpScore, shrinkToConfidence } from "../model/adapter";
import { marketValuation, yieldIncome, measuredBeta, riskModelFor } from "./market-base";
import type { PortfolioClassAdapter } from "../model/adapter";

/**
 * ETFs are scored on what actually distinguishes one from another — cost and the
 * exposure it buys — NOT on P/E and ROE. Running an ETF through the equity scorer
 * (which is what happens today) scores the fund's *look-through* fundamentals as
 * if the fund were a company, which is meaningless: SPY does not have a balance
 * sheet to be leveraged.
 */
export const etfAdapter: PortfolioClassAdapter = {
  id: "etf",
  valuationMode: "market",
  defaultLiquidity: "t0",
  unit: "shares",
  registryClass: "etf",
  manualStalenessDays: null,

  value: marketValuation,
  income: (raw, val, ctx) => yieldIncome(raw, val, ctx, "distribution"),

  /**
   * "ETF" is a WRAPPER, not a risk model. VCLT, VXUS, GLD, SCHH, BIL and a
   * money-market fund all arrive here with quoteType ETF, and they behave nothing
   * alike. The classifier reads what the fund actually holds — see
   * reference/risk-models.ts — so a corporate bond ETF gets duration and credit
   * exposure, a gold trust gets the gold complex, a REIT fund gets cap rates, an
   * international fund gets currency risk, and a T-bill fund gets modelled as cash.
   *
   * This replaces `if (fundamentals.duration != null) treat as a bond`, which
   * misfired in both directions on live data.
   */
  factors(raw, ctx) {
    return riskModelFor(raw, ctx).factors;
  },

  metrics(raw, ctx) {
    const f = raw.symbol ? ctx.fundamentals.get(raw.symbol.toUpperCase()) : undefined;
    return {
      expenseRatio: f?.expenseRatio ?? null,
      dividendYield: f?.dividendYield ?? null,
      beta: measuredBeta(raw.symbol, ctx) ?? f?.beta ?? null,
      // The MODELLED effective duration, not the provider's field: for a bond ETF
      // Yahoo reports 3.55 on TLT and 3.88 on a floating-rate fund. Showing one
      // number here and stress-testing another would be two authorities for the
      // same quantity.
      duration: riskModelFor(raw, ctx).duration,
      marketCap: f?.marketCap ?? null,
    };
  },

  attributes(raw, ctx) {
    const f = raw.symbol ? ctx.fundamentals.get(raw.symbol.toUpperCase()) : undefined;
    return {
      sector: f?.sector ?? "Diversified",
      geography: f?.country ?? null,
      currency: f?.currency ?? raw.currency,
      // Traceability: which risk model this holding was stress-tested under.
      riskModel: riskModelFor(raw, ctx).label,
    };
  },

  score(raw, ctx) {
    const f = raw.symbol ? ctx.fundamentals.get(raw.symbol.toUpperCase()) : undefined;
    if (!f) return null;

    const inputs = [f.expenseRatio, f.dividendYield];
    const conf = coverage(inputs);
    if (conf === 0) return null;

    const why: string[] = [];
    let weighted = 0;
    let used = 0;

    if (f.expenseRatio != null) {
      // 0.03% (a broad index fund) → ~100; 1.0%+ → 0. Cost is the one thing about a
      // fund that is knowable in advance and compounds with certainty.
      const s = lerpScore(f.expenseRatio, 1.0, 0.03);
      weighted += s * 0.7;
      used += 0.7;
      if (f.expenseRatio <= 0.10) why.push(`Low cost (${f.expenseRatio.toFixed(2)}% expense ratio)`);
      if (f.expenseRatio >= 0.75) why.push(`Expensive (${f.expenseRatio.toFixed(2)}% expense ratio)`);
    }
    if (f.dividendYield != null) {
      const y = f.dividendYield > 1 ? f.dividendYield : f.dividendYield * 100;
      const s = lerpScore(y, 0, 5);
      weighted += s * 0.3;
      used += 0.3;
    }

    if (used === 0) return null;
    return {
      score: Math.round(shrinkToConfidence(weighted / used, conf)),
      confidence: Math.round(conf),
      why: why.slice(0, 3),
    };
  },

  row: {
    primary: ["expenseRatio", "dividendYield", "beta"],
    secondary: ["duration", "marketCap"],
  },
};

registerClass(etfAdapter);
