import { registerClass } from "../model/adapter";
import { marketValuation, yieldIncome, measuredBeta, fundamentalScore } from "./market-base";
import { CLASS_FACTORS, SECTOR_FACTORS, mergeFactors } from "./reference/factor-sensitivities";
import type { PortfolioClassAdapter } from "../model/adapter";

export const equityAdapter: PortfolioClassAdapter = {
  id: "equity",
  valuationMode: "market",
  defaultLiquidity: "t0",
  unit: "shares",
  registryClass: "equity",
  manualStalenessDays: null,

  value: marketValuation,
  income: (raw, val, ctx) => yieldIncome(raw, val, ctx, "dividend"),

  factors(raw, ctx) {
    const f = raw.symbol ? ctx.fundamentals.get(raw.symbol.toUpperCase()) : undefined;
    // Measured beta beats the provider's stated beta, which beats the class default.
    const beta = measuredBeta(raw.symbol, ctx) ?? f?.beta ?? CLASS_FACTORS.equity.equityBeta!;
    const sector = f?.sector ?? null;
    return mergeFactors(
      CLASS_FACTORS.equity,
      sector ? SECTOR_FACTORS[sector] : undefined,
      { equityBeta: beta },
    );
  },

  metrics(raw, ctx) {
    const f = raw.symbol ? ctx.fundamentals.get(raw.symbol.toUpperCase()) : undefined;
    return {
      peRatio: f?.peRatio ?? null,
      priceToBook: f?.priceToBook ?? null,
      returnOnEquity: f?.returnOnEquity ?? null,
      revenueGrowth: f?.revenueGrowth ?? null,
      operatingMargins: f?.operatingMargins ?? null,
      debtToEquity: f?.debtToEquity ?? null,
      dividendYield: f?.dividendYield ?? null,
      marketCap: f?.marketCap ?? null,
      beta: measuredBeta(raw.symbol, ctx) ?? f?.beta ?? null,
    };
  },

  attributes(raw, ctx) {
    const f = raw.symbol ? ctx.fundamentals.get(raw.symbol.toUpperCase()) : undefined;
    return {
      sector: f?.sector ?? null,
      industry: f?.industry ?? null,
      geography: f?.country ?? null,
      currency: f?.currency ?? raw.currency,
    };
  },

  score(raw, ctx) {
    const f = raw.symbol ? ctx.fundamentals.get(raw.symbol.toUpperCase()) : undefined;
    return fundamentalScore(f, [
      { key: "returnOnEquity",   weight: 0.25, worst: 0,    best: 0.30, label: "return on equity" },
      { key: "revenueGrowth",    weight: 0.20, worst: -0.10, best: 0.30, label: "revenue growth" },
      { key: "operatingMargins", weight: 0.20, worst: 0,    best: 0.30, label: "operating margin" },
      // Lower is better → worst/best inverted.
      { key: "peRatio",          weight: 0.20, worst: 45,   best: 8,    label: "valuation" },
      { key: "debtToEquity",     weight: 0.15, worst: 250,  best: 20,   label: "balance sheet" },
    ]);
  },

  row: {
    primary: ["peRatio", "returnOnEquity", "revenueGrowth"],
    secondary: ["operatingMargins", "debtToEquity", "dividendYield", "beta"],
  },
};

registerClass(equityAdapter);
