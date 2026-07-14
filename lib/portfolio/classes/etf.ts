import { registerClass, coverage, lerpScore, shrinkToConfidence } from "../model/adapter";
import { marketValuation, yieldIncome, measuredBeta } from "./market-base";
import { CLASS_FACTORS, mergeFactors } from "./reference/factor-sensitivities";
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

  factors(raw, ctx) {
    const f = raw.symbol ? ctx.fundamentals.get(raw.symbol.toUpperCase()) : undefined;
    const beta = measuredBeta(raw.symbol, ctx) ?? f?.beta ?? CLASS_FACTORS.etf.equityBeta!;

    // A bond ETF is a bond, whatever its wrapper says. When the provider gives us
    // a real duration, this fund gets a bond's rate sensitivity — not an equity's.
    // Without this, a Treasury ETF is stress-tested as a stock.
    const duration = f?.duration ?? null;
    if (duration != null && Number.isFinite(duration) && duration > 0) {
      return mergeFactors(CLASS_FACTORS.bond, { rates: -duration, equityBeta: beta });
    }

    return mergeFactors(CLASS_FACTORS.etf, { equityBeta: beta });
  },

  metrics(raw, ctx) {
    const f = raw.symbol ? ctx.fundamentals.get(raw.symbol.toUpperCase()) : undefined;
    return {
      expenseRatio: f?.expenseRatio ?? null,
      dividendYield: f?.dividendYield ?? null,
      beta: measuredBeta(raw.symbol, ctx) ?? f?.beta ?? null,
      duration: f?.duration ?? null,
      marketCap: f?.marketCap ?? null,
    };
  },

  attributes(raw, ctx) {
    const f = raw.symbol ? ctx.fundamentals.get(raw.symbol.toUpperCase()) : undefined;
    return {
      sector: f?.sector ?? "Diversified",
      geography: f?.country ?? null,
      currency: f?.currency ?? raw.currency,
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
