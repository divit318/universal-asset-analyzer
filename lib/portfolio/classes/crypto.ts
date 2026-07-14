import { registerClass, coverage, lerpScore, shrinkToConfidence } from "../model/adapter";
import { marketValuation, measuredBeta, realizedVol } from "./market-base";
import { CLASS_FACTORS, mergeFactors } from "./reference/factor-sensitivities";
import type { PortfolioClassAdapter } from "../model/adapter";

/**
 * Crypto.
 *
 * Per lib/assets/crypto.ts, TVL / staking yield / active addresses / developer
 * activity / whale concentration are all `unavailable` — they need CoinGecko,
 * DeFiLlama or Glassnode, none of which we have. We declare them nowhere and
 * fabricate them nowhere. What IS real from Yahoo: price, market cap, and
 * realized volatility from history.
 *
 * The important modelling call: crypto's equity beta is ~0.4, NOT 0. Treating
 * crypto as an uncorrelated diversifier is the single most expensive error in
 * retail portfolio construction — it sells off WITH equities, harder, exactly when
 * liquidity dries up. Hence the large negative liquidityStress loading too.
 */
export const cryptoAdapter: PortfolioClassAdapter = {
  id: "crypto",
  valuationMode: "market",
  defaultLiquidity: "t0",
  unit: "coins",
  registryClass: "crypto",
  manualStalenessDays: null,

  value: marketValuation,
  // No staking-yield feed → no income. Saying "0% yield" for a staked position
  // would be a lie; saying "we can't see it" is the honest answer, and the UI
  // surfaces it as an unavailable metric rather than a zero.
  income: () => null,

  factors(raw, ctx) {
    const beta = measuredBeta(raw.symbol, ctx);
    return mergeFactors(
      CLASS_FACTORS.crypto,
      beta != null ? { equityBeta: beta } : undefined,
    );
  },

  metrics(raw, ctx) {
    const f = raw.symbol ? ctx.fundamentals.get(raw.symbol.toUpperCase()) : undefined;
    return {
      marketCap: f?.marketCap ?? null,
      volatility: realizedVol(raw.symbol, ctx),
      equityBeta: measuredBeta(raw.symbol, ctx),
    };
  },

  attributes(raw) {
    return {
      sector: "Digital Assets",
      geography: "Global",
      currency: raw.currency,
    };
  },

  /**
   * Scored on realized volatility and size only — the two things we can actually
   * see. Confidence is capped to reflect how thin that evidence is: we will not
   * present a two-input crypto score with the same authority as a five-input
   * equity score.
   */
  score(raw, ctx) {
    const f = raw.symbol ? ctx.fundamentals.get(raw.symbol.toUpperCase()) : undefined;
    const vol = realizedVol(raw.symbol, ctx);
    const mcap = f?.marketCap ?? null;

    const conf = coverage([vol, mcap]);
    if (conf === 0) return null;

    const why: string[] = [];
    let weighted = 0;
    let used = 0;

    if (mcap != null) {
      // $1B → weak, $500B+ → strong. Size is a genuine survivability proxy here.
      const s = lerpScore(Math.log10(Math.max(mcap, 1e6)), 9, 11.7);
      weighted += s * 0.5;
      used += 0.5;
    }
    if (vol != null) {
      const s = lerpScore(vol, 140, 40);
      weighted += s * 0.5;
      used += 0.5;
      if (vol >= 100) why.push(`Very high volatility (${vol.toFixed(0)}% annualized)`);
    }

    if (used === 0) return null;

    // Hard cap: with no on-chain data, a crypto score is never high-confidence.
    const cappedConf = Math.min(conf, 55);
    why.push("Limited data — no on-chain metrics available from free providers");

    return {
      score: Math.round(shrinkToConfidence(weighted / used, cappedConf)),
      confidence: Math.round(cappedConf),
      why: why.slice(0, 3),
    };
  },

  row: {
    primary: ["marketCap", "volatility"],
    secondary: ["equityBeta"],
  },
};

registerClass(cryptoAdapter);
