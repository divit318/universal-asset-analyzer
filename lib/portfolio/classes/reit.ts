import { registerClass } from "../model/adapter";
import { marketValuation, yieldIncome, measuredBeta, fundamentalScore, riskModelFor } from "./market-base";
import type { PortfolioClassAdapter } from "../model/adapter";

/**
 * REITs trade like equities and behave like leveraged bonds. Scoring them purely
 * on equity fundamentals (today's behaviour) misses the two things that actually
 * drive them: yield and rate sensitivity.
 *
 * Per the asset registry (lib/assets/reit.ts), cap rate / occupancy / same-store
 * NOI are `unavailable` from our providers — they live in REIT supplementals. We
 * do NOT invent them. P/FFO is approximated as marketCap ÷ operatingCashflow, and
 * that proxy is null for mortgage REITs. The honest metric set is what's below.
 */
export const reitAdapter: PortfolioClassAdapter = {
  id: "reit",
  valuationMode: "market",
  defaultLiquidity: "t0",
  unit: "shares",
  registryClass: "reit",
  manualStalenessDays: null,

  value: marketValuation,
  income: (raw, val, ctx) => yieldIncome(raw, val, ctx, "distribution"),

  // Unchanged in substance — measured beta over the REIT reference, plus rate and
  // cap-rate exposure — but resolved through the one shared classifier, so a REIT
  // FUND bought as an ETF (SCHH, VNQ) now lands on this same model instead of
  // being stress-tested as a broad equity fund.
  factors(raw, ctx) {
    return riskModelFor(raw, ctx).factors;
  },

  metrics(raw, ctx) {
    const f = raw.symbol ? ctx.fundamentals.get(raw.symbol.toUpperCase()) : undefined;
    // P/FFO proxy, bounded to a plausibility band — the same 3-100x guard the
    // screener applies (lib/assets/reit.ts), because OCF isn't rent for mortgage
    // REITs and the raw ratio comes out as nonsense there.
    const mcap = f?.marketCap ?? null;
    const ocf = f?.operatingCashflow ?? null;
    let priceToFFO: number | null = null;
    if (mcap != null && ocf != null && ocf > 0) {
      const r = mcap / ocf;
      priceToFFO = r >= 3 && r <= 100 ? r : null;
    }

    return {
      priceToFFO,
      dividendYield: f?.dividendYield ?? null,
      debtToEquity: f?.debtToEquity ?? null,
      priceToBook: f?.priceToBook ?? null,
      beta: measuredBeta(raw.symbol, ctx) ?? f?.beta ?? null,
    };
  },

  attributes(raw, ctx) {
    const f = raw.symbol ? ctx.fundamentals.get(raw.symbol.toUpperCase()) : undefined;
    return {
      sector: "Real Estate",
      industry: f?.industry ?? null,
      riskModel: riskModelFor(raw, ctx).label,
      geography: f?.country ?? null,
      currency: f?.currency ?? raw.currency,
    };
  },

  score(raw, ctx) {
    const f = raw.symbol ? ctx.fundamentals.get(raw.symbol.toUpperCase()) : undefined;
    return fundamentalScore(f, [
      { key: "dividendYield", weight: 0.40, worst: 0,   best: 0.07, label: "yield" },
      { key: "debtToEquity",  weight: 0.35, worst: 300, best: 50,   label: "leverage" },
      { key: "priceToBook",   weight: 0.25, worst: 4,   best: 0.8,  label: "valuation" },
    ]);
  },

  row: {
    primary: ["dividendYield", "priceToFFO", "debtToEquity"],
    secondary: ["priceToBook", "beta"],
  },
};

registerClass(reitAdapter);
