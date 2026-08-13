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
import { getStatementsWithFallback } from "../statements";
import { getRecentFilings } from "../edgar";
import { getIndianFilings, isIndianEquitySymbol } from "../india-news";
import { getCompanyProfile } from "../profile";
import { getCompanyNews } from "../news";
import { getPeerComparison } from "../peers";
import { assessRisks, classifyInvestmentPersonality, computeMomentum, computeScore } from "../scoring";
import { listAllNotes, listWatchlist } from "../db";
import { constituentsForSector } from "../sp500";
import { detectMarket } from "../market";
import { getLatestSectorRotation, findSectorRotationEntry } from "../sector-rotation";
import { getTimelineFeed } from "../timeline";
import { getOpportunityMapData } from "../opportunity-map";
import { getExposureModel } from "../exposure";
import { getDataset, invalidateAsset } from "../platform/data-layer";
import type { CompanyContext } from "./types";
import type { SectorRotationEntry } from "../types";

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

/**
 * Build (or return a cached) CompanyContext for a symbol. The live quote is the
 * one hard requirement — without it there's no company to analyze, so a quote
 * failure rejects. Everything else is best-effort.
 *
 * Caching and deduplication are the platform's job (`companyContext` dataset),
 * not this module's. That matters more here than anywhere else: building a
 * context fans out to nine providers, and the verdict route, the chat route, and
 * the IC report all ask for the same symbol's context at the same moment. The
 * bespoke Map cache this used to keep couldn't coalesce those — they all missed
 * together and all rebuilt the world. Now one build serves all three, and a new
 * filing invalidates it automatically via the registry's dependency graph.
 */
export async function buildCompanyContext(
  rawSymbol: string,
  opts: { fresh?: boolean } = {},
): Promise<CompanyContext> {
  const symbol = rawSymbol.trim().toUpperCase();
  if (!symbol) throw new Error("A symbol is required");

  const result = await getDataset<CompanyContext>(
    "companyContext",
    { symbol },
    () => assembleCompanyContext(symbol),
    { fresh: opts.fresh, symbol },
  );
  return result.data;
}

/**
 * The verdict's critical-path context: ONLY the sources the verdict prompt and
 * its deterministic inputs actually consume.
 *
 * The full {@link buildCompanyContext} fans out to nine-plus providers because
 * the copilot reasons over all of them. The verdict does not: its facts
 * (lib/ai/facts.ts buildEquityFacts) and score inputs need the quote,
 * fundamentals (snapshot/analyst/insider), statements, 1825d history, and the
 * top news headlines — nothing else. Phase 2 measured the verdict stream
 * blocking 1.2–2.9s on the full fan-out, waiting on peers/exposure/
 * timeline/opportunity-map data that never reaches the prompt.
 *
 * This is NOT a second context architecture: every fetch below is the same
 * lib call the full assembly makes, deduplicated and cached per dataset by the
 * platform, so a verdict build and a copilot build share every byte of
 * underlying work. The enrichment fields are left empty — no consumer on the
 * verdict path reads them (verified: the equity facts, every non-equity plan,
 * and the report route touch only what is fetched here).
 *
 * The score computation is bit-identical to the full context's: same inputs,
 * same window (1825d), same sector-rotation source — so the verdict can never
 * quote a score the Conviction tab doesn't show.
 */
export async function buildVerdictContext(rawSymbol: string): Promise<CompanyContext> {
  const symbol = rawSymbol.trim().toUpperCase();
  if (!symbol) throw new Error("A symbol is required");
  const warnings: string[] = [];

  const [quoteResult, fundamentals, statements, news, history] = await Promise.all([
    getQuote(symbol).then(
      (q) => ({ ok: true as const, quote: q }),
      (err: unknown) => ({ ok: false as const, err }),
    ),
    tryOr("fundamentals", warnings, () => getFundamentals(symbol), null),
    tryOr("statements", warnings, async () => {
      const { statements, error } = await getStatementsWithFallback(symbol);
      if (!statements && error) throw new Error(error);
      return statements;
    }, null),
    tryOr("news", warnings, () => getCompanyNews(symbol, 8), []),
    tryOr("price history", warnings, () => getHistory(symbol, 1825), []),
  ]);

  if (!quoteResult.ok) throw quoteResult.err;
  const quote = quoteResult.quote;

  const momentum = computeMomentum(history);

  let score: CompanyContext["score"] = null;
  let risks: CompanyContext["risks"] = [];
  let sectorRotationEntry: SectorRotationEntry | null = null;
  if (fundamentals) {
    const market = detectMarket(quote);
    const rotation = getLatestSectorRotation();
    sectorRotationEntry = findSectorRotationEntry(rotation, fundamentals.snapshot.sector);
    score = computeScore(fundamentals.snapshot, statements, fundamentals.analyst, momentum, sectorRotationEntry, market);
    risks = assessRisks(fundamentals.snapshot, statements, fundamentals.analyst, fundamentals.insider);
  }

  return {
    symbol,
    name: quote.name || symbol,
    builtAt: new Date().toISOString(),
    quote,
    profile: null,
    snapshot: fundamentals?.snapshot ?? null,
    statements,
    analyst: fundamentals?.analyst ?? null,
    insider: fundamentals?.insider ?? null,
    score,
    risks,
    momentum,
    personality: null,
    peers: null,
    filings: [],
    news,
    onWatchlist: false,
    savedNotes: [],
    warnings,
    ownership: fundamentals?.ownership ?? null,
    sectorRotation: sectorRotationEntry,
    recentTimelineEvents: [],
    relatedOpportunities: null,
    yourExposure: null,
  };
}

async function assembleCompanyContext(symbol: string): Promise<CompanyContext> {
  const warnings: string[] = [];

  // The quote is required, but it does NOT need to block the other eight
  // sources — none of them depend on it. Fetch everything at once and enforce
  // the requirement afterwards, rather than paying a serial round-trip for it.
  const [quoteResult, profile, fundamentals, statements, filings, news, peers, history, exposure] =
    await Promise.all([
      getQuote(symbol).then(
        (q) => ({ ok: true as const, quote: q }),
        (err: unknown) => ({ ok: false as const, err }),
      ),
      tryOr("profile", warnings, () => getCompanyProfile(symbol), null),
      tryOr("fundamentals", warnings, () => getFundamentals(symbol), null),
      // Same Yahoo-first/EDGAR-fallback chain the research page uses, so the
      // AI's score inputs are IDENTICAL to the page's (an EDGAR-only fetch
      // here made the narration quote subscores the Conviction tab never
      // showed, for any ticker EDGAR's XBRL tags don't cover).
      tryOr("statements", warnings, async () => {
        const { statements, error } = await getStatementsWithFallback(symbol);
        if (!statements && error) throw new Error(error);
        return statements;
      }, null),
      // Indian listings: NSE corporate announcements stand in for EDGAR
      // filings — same Filing shape, so the prompt renders them identically.
      tryOr("filings", warnings, () =>
        isIndianEquitySymbol(symbol) ? getIndianFilings(symbol, 10) : getRecentFilings(symbol, 10), []),
      tryOr("news", warnings, () => getCompanyNews(symbol, 8), []),
      tryOr("peers", warnings, () => getPeerComparison(symbol), null),
      // 1825d — the SAME window buildFundamentalsData feeds computeMomentum,
      // so the context's composite score is bit-identical to the page's.
      // (420d here produced a slightly different momentum blend, so the
      // narration could quote "50/100" beside a hero showing 51/100.)
      tryOr("price history", warnings, () => getHistory(symbol, 1825), []),
      tryOr("exposure", warnings, () => getExposureModel(), null),
    ]);

  if (!quoteResult.ok) throw quoteResult.err;
  const quote = quoteResult.quote;

  const momentum = computeMomentum(history);

  // The platform's own scoring/risk engines, when we have the inputs.
  // Market-aware + sector-rotation-aware, matching /api/fundamentals so the
  // copilot's view of the score is consistent with what the page displays.
  let score: CompanyContext["score"] = null;
  let risks: CompanyContext["risks"] = [];
  let personality: CompanyContext["personality"] = null;
  let sectorRotationEntry: SectorRotationEntry | null = null;
  if (fundamentals) {
    const market = detectMarket(quote);
    const rotation = getLatestSectorRotation();
    sectorRotationEntry = findSectorRotationEntry(rotation, fundamentals.snapshot.sector);
    score = computeScore(fundamentals.snapshot, statements, fundamentals.analyst, momentum, sectorRotationEntry, market);
    risks = assessRisks(
      fundamentals.snapshot,
      statements,
      fundamentals.analyst,
      fundamentals.insider,
    );
    personality = classifyInvestmentPersonality(score, fundamentals.snapshot, momentum);
  }

  // Investment Timeline — reads the persisted feed only (no live sync, unlike
  // /api/timeline) so a copilot chat turn never blocks on a fresh crawl; the
  // Details tab's TimelinePreviewCard is what keeps the feed warm.
  let recentTimelineEvents: CompanyContext["recentTimelineEvents"] = [];
  try {
    recentTimelineEvents = getTimelineFeed("symbol", symbol).events
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, 5);
  } catch {
    /* timeline is non-critical context */
  }

  // Opportunity Map — cheap, cached-scanner-result read only, never a live scan.
  let relatedOpportunities: CompanyContext["relatedOpportunities"] = null;
  try {
    const map = getOpportunityMapData();
    const node = map.nodes.find((n) => n.symbol === symbol);
    const cluster = node ? map.clusters.find((c) => c.nodeIds.includes(node.id)) : undefined;
    if (node && cluster) {
      const siblings = cluster.nodeIds
        .filter((id) => id !== node.id)
        .map((id) => map.nodes.find((n) => n.id === id)?.symbol)
        .filter((s): s is string => s != null)
        .slice(0, 5);
      relatedOpportunities = { theme: node.theme, siblings };
    }
  } catch {
    /* opportunity map is non-critical context */
  }

  /* What the reader's own book already owns of this name, every route counted.
     Read off the exposure model fetched above — the copilot should know that a
     "should I buy?" question is being asked by someone who already holds 2.3%
     of it, 1.4% of that inside a fund they bought for something else. */
  let yourExposure: CompanyContext["yourExposure"] = null;
  if (exposure) {
    const issuer = exposure.issuers.find((i) => i.symbol === symbol.toUpperCase());
    if (issuer) {
      const routes = exposure.edges
        .filter((e) => e.to === issuer.id && (e.kind === "IS" || e.kind === "CONTAINS"))
        .map((e) => ({
          via: e.kind === "IS" ? "direct" : e.from.slice("position:".length),
          pct: e.bookPct ?? 0,
        }))
        .sort((a, b) => b.pct - a.pct);
      yourExposure = {
        effectivePct: issuer.effectivePct,
        directPct: issuer.directPct,
        routes,
      };
    }
  }

  let onWatchlist = false;
  try {
    onWatchlist = listWatchlist().some((w) => w.symbol === symbol);
  } catch {
    /* watchlist is non-critical context */
  }

  // Cross-stock memory: include saved notes for this symbol AND any notes for
  // peer symbols so the copilot's analysis is informed by prior conclusions.
  let savedNotes: Array<{ symbol: string; content: string; createdAt: string }> = [];
  try {
    const allNotes = listAllNotes();
    const peerSymbols = new Set<string>(
      peers?.sector ? constituentsForSector(peers.sector).map((c) => c.symbol) : []
    );
    savedNotes = allNotes
      .filter((n) => n.symbol === symbol || peerSymbols.has(n.symbol))
      .slice(0, 10)
      .map((n) => ({ symbol: n.symbol, content: n.content, createdAt: n.createdAt }));
  } catch {
    /* notes are non-critical */
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
    personality,
    peers,
    filings: filings.map((f) => ({
      form: f.form,
      filedAt: f.filedAt,
      description: f.description,
      documentUrl: f.documentUrl,
    })),
    news,
    onWatchlist,
    savedNotes,
    warnings,
    ownership: fundamentals?.ownership ?? null,
    sectorRotation: sectorRotationEntry,
    recentTimelineEvents,
    relatedOpportunities,
    yourExposure,
  };

  return ctx;
}

/**
 * Drop a cached bundle (e.g. after a watchlist change).
 *
 * Dependency-aware: this clears the context *and* the AI verdict derived from
 * it (see the registry's `companyContext → aiVerdict` edge), because a verdict
 * built on a context that no longer holds is exactly the kind of quietly-stale
 * output the platform exists to prevent. Price history, profile, and every other
 * symbol are untouched.
 */
export function invalidateContext(symbol: string): void {
  invalidateAsset(symbol.trim().toUpperCase(), "companyContext");
}
