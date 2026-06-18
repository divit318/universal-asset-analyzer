/**
 * Context Layer — assembles the single CompanyContext bundle the copilot
 * reasons over. It fans out across every existing data source (Yahoo quote +
 * fundamentals, EDGAR statements + filings, profile, news, peers, the
 * platform's own score/risk/momentum engines, and the watchlist), running them
 * in parallel and degrading gracefully: any source that fails contributes a
 * `warning` instead of sinking the whole bundle.
 *
 * Bundles are cached per symbol with a short TTL so multi-turn conversations
 * and the predefined actions don't re-fetch the world on every message.
 */

import { getHistory, getQuote } from "../yahoo";
import { getFundamentals } from "../fundamentals";
import { getFinancialStatements } from "../statements";
import { getRecentFilings } from "../edgar";
import { getCompanyProfile } from "../profile";
import { getCompanyNews } from "../news";
import { getPeerComparison } from "../peers";
import { assessRisks, computeMomentum, computeScore } from "../scoring";
import { listWatchlist } from "../db";
import type { CompanyContext } from "./types";

/** Settle a best-effort source, recording a warning on failure. */
async function tryOr<T>(
  label: string,
  warnings: string[],
  fn: () => Promise<T>,
  fallback: T,
): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    warnings.push(`${label}: ${err instanceof Error ? err.message : "unavailable"}`);
    return fallback;
  }
}

const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { at: number; ctx: CompanyContext }>();

/**
 * Build (or return a cached) CompanyContext for a symbol. The live quote is the
 * one hard requirement — without it there's no company to analyze, so a quote
 * failure rejects. Everything else is best-effort.
 */
export async function buildCompanyContext(
  rawSymbol: string,
  opts: { fresh?: boolean } = {},
): Promise<CompanyContext> {
  const symbol = rawSymbol.trim().toUpperCase();
  if (!symbol) throw new Error("A symbol is required");

  const cached = cache.get(symbol);
  if (!opts.fresh && cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return cached.ctx;
  }

  const warnings: string[] = [];

  // The quote is required; fetch it first so we can fail fast.
  const quote = await getQuote(symbol);

  const [profile, fundamentals, statements, filings, news, peers, history] =
    await Promise.all([
      tryOr("profile", warnings, () => getCompanyProfile(symbol), null),
      tryOr("fundamentals", warnings, () => getFundamentals(symbol), null),
      tryOr("statements", warnings, () => getFinancialStatements(symbol), null),
      tryOr("filings", warnings, () => getRecentFilings(symbol, 10), []),
      tryOr("news", warnings, () => getCompanyNews(symbol, 8), []),
      tryOr("peers", warnings, () => getPeerComparison(symbol), null),
      tryOr("price history", warnings, () => getHistory(symbol, 420), []),
    ]);

  const momentum = computeMomentum(history);

  // The platform's own scoring/risk engines, when we have the inputs.
  let score: CompanyContext["score"] = null;
  let risks: CompanyContext["risks"] = [];
  if (fundamentals) {
    score = computeScore(fundamentals.snapshot, statements, fundamentals.analyst, momentum);
    risks = assessRisks(
      fundamentals.snapshot,
      statements,
      fundamentals.analyst,
      fundamentals.insider,
    );
  }

  let onWatchlist = false;
  try {
    onWatchlist = listWatchlist().some((w) => w.symbol === symbol);
  } catch {
    /* watchlist is non-critical context */
  }

  const ctx: CompanyContext = {
    symbol,
    name: quote.name || symbol,
    builtAt: new Date().toISOString(),
    quote,
    profile,
    snapshot: fundamentals?.snapshot ?? null,
    statements,
    analyst: fundamentals?.analyst ?? null,
    insider: fundamentals?.insider ?? null,
    score,
    risks,
    momentum,
    peers,
    filings: filings.map((f) => ({
      form: f.form,
      filedAt: f.filedAt,
      description: f.description,
      documentUrl: f.documentUrl,
    })),
    news,
    onWatchlist,
    warnings,
  };

  cache.set(symbol, { at: Date.now(), ctx });
  return ctx;
}

/** Drop a cached bundle (e.g. after a watchlist change). */
export function invalidateContext(symbol: string): void {
  cache.delete(symbol.trim().toUpperCase());
}
