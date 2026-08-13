/**
 * Asset mention resolution — turns "the company the user named" into a
 * verified, tradeable instrument, with an honest confidence about whether the
 * match is trustworthy enough to act on.
 *
 * Motivating failures (2026-08-10 assistant audit): the previous resolver took
 * Yahoo's top fuzzy hit blindly, so "Reliance" became Reliance, Inc. (RS — US
 * steel) instead of Reliance Industries, "dollar-rupee exchange rate" became
 * 6C=F (Canadian Dollar futures), "S&P 500 index" became ES=F (E-mini
 * futures), and the fictitious "Blorptech Industries" resolved to TEVA. All
 * four then executed as if they were what the user asked for.
 *
 * The fix is architectural, not a special-case list:
 *
 *   1. **Verify the name, don't trust the ranking.** Yahoo's fuzzy search is
 *      treated as a candidate GENERATOR only. Every candidate is re-scored
 *      against what the user actually said (token overlap on normalized
 *      names), so a hit that shares no distinctive word with the mention
 *      ("Blorptech" → Teva) simply does not qualify.
 *   2. **Resolution confidence is a separate signal from intent confidence.**
 *      The model saying "the user clearly wants to add something" tells us
 *      nothing about WHICH instrument they mean. This module owns the latter;
 *      lib/ai-app-assistant.ts combines the two into action eligibility (and
 *      documents that combination). Never collapse them back into one field.
 *   3. **Derivatives are opt-in.** Futures/options/warrants only qualify when
 *      the mention itself asks for them — "S&P 500 index" must never resolve
 *      to a futures contract just because one fuzzy-matched.
 *   4. **Ambiguity is surfaced, not swallowed.** When multiple DIFFERENT
 *      companies match the mention comparably well ("Reliance" → Reliance,
 *      Inc. AND Reliance Industries), the result says so, carries the best
 *      alternative for "did you mean…" copy, and callers must not
 *      auto-execute. Multiple listings of the SAME company (HDFC Bank on NSE
 *      and NYSE) are not ambiguity — the first listing in Yahoo's relevance
 *      order wins, which also naturally prefers the home listing.
 *
 * Pure scoring lives in rankCandidates() (unit-tested against captured Yahoo
 * payloads in tests/asset-resolution.test.ts); resolveAssetMention() is the
 * thin impure wrapper that fetches candidates via searchSymbols().
 */

import { searchSymbols } from "./yahoo";
import type { SymbolSuggestion } from "./types";

/**
 * How much the resolved instrument can be trusted to be what the user meant:
 *  - "exact":     the mention IS the ticker (user typed "TSLA").
 *  - "strong":    one company clearly matches the name; safe to act on.
 *  - "ambiguous": more than one distinct company matches comparably well;
 *                 present for explicit confirmation, never auto-execute.
 *  - "none":      nothing shares a distinctive name token with the mention;
 *                 do not offer an action at all.
 */
export type ResolutionConfidence = "exact" | "strong" | "ambiguous" | "none";

export interface ResolvedAsset {
  symbol: string;
  name: string;
  type: string | null;
  exchange: string | null;
  resolution: Exclude<ResolutionConfidence, "none">;
  /** Best comparably-matching DIFFERENT company — "did you mean…" material. */
  alternative?: { symbol: string; name: string };
}

export interface ResolveMentionOptions {
  /**
   * Allow futures/options/warrants to qualify even when the mention doesn't
   * ask for them. Default false — see rule 3 above.
   */
  allowDerivatives?: boolean;
}

/* -------------------------------------------------------------------------- */
/* Name normalization                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Corporate boilerplate that carries no identity: "Reliance, Inc." and
 * "Reliance Industries Limited" must compare as {reliance} vs
 * {reliance, industries}, not be equalized (or separated) by suffix noise.
 * Deliberately minimal — words like "industries", "group" or "bank" DO carry
 * identity ("Blorptech Industries" matching Teva Pharmaceutical *Industries*
 * on the generic word alone is exactly the bug this module exists to stop, so
 * generic words are stripped rather than counted as matches).
 */
const GENERIC_TOKENS = new Set([
  "inc", "incorporated", "corp", "corporation", "ltd", "limited", "plc",
  "co", "company", "the", "of", "and", "sa", "nv", "ag", "se", "ab", "as",
]);

/** Lowercased identity tokens of a name/mention, boilerplate stripped. */
export function nameTokens(raw: string): Set<string> {
  const tokens = raw
    .toLowerCase()
    // Keep "&" and "^" inside tokens so "s&p" and "^spx" survive; split on
    // everything else that isn't a letter/digit.
    .split(/[^a-z0-9&^]+/)
    .filter((t) => t.length > 0 && !GENERIC_TOKENS.has(t));
  return new Set(tokens);
}

function intersectionSize(a: Set<string>, b: Set<string>): number {
  let n = 0;
  for (const t of a) if (b.has(t)) n++;
  return n;
}

/* -------------------------------------------------------------------------- */
/* Candidate qualification                                                    */
/* -------------------------------------------------------------------------- */

const DERIVATIVE_TYPES = /future|option|warrant/i;

/**
 * Asset-kind words a mention can carry ("S&P 500 index", "Tesla stock",
 * "gold futures"). They are NOT identity tokens — stripped from both sides
 * before name matching — but they are a strong type signal: when the mention
 * names a kind and a type-matching candidate fully matches, candidates of
 * other types are not rivals ("S&P 500 index" means the index, not the
 * Schwab index FUND one extra word away).
 */
const KIND_WORDS: [word: RegExp, type: RegExp][] = [
  [/^(indexes|indices|index)$/, /index/i],
  [/^etfs?$/, /etf/i],
  [/^funds?$/, /fund/i],
  [/^futures?$/, /future/i],
  [/^options?$/, /option/i],
  [/^warrants?$/, /warrant/i],
  [/^(stocks?|shares?|equity|equities)$/, /equity/i],
  [/^(cryptos?|cryptocurrency|cryptocurrencies|coins?)$/, /crypto/i],
  [/^(currency|currencies|forex|fx)$/, /currency/i],
];

const DERIVATIVE_KINDS = /future|option|warrant/i;

/**
 * The ticker the user may have typed, matched against listing variants.
 *
 * Matching the full symbol is case-insensitive ("tsla" is unambiguous). But
 * matching a listing's suffix-less BASE requires the mention to be written
 * as a ticker (all-caps): NSE tickers are name-derived, so a name-cased
 * "Reliance" would otherwise silently "exactly match" RELIANCE.NS and skip
 * the ambiguity handling that mention needs — while an all-caps "RELIANCE"
 * or "BRK.B" is the user telling us the instrument.
 */
function isExactTicker(mention: string, symbol: string): boolean {
  const m = mention.trim();
  const norm = (s: string) => s.toUpperCase().replace(/\./g, "-");
  if (norm(m) === norm(symbol)) return true;
  const typedAsTicker = /^[A-Z0-9.\-]{1,10}$/.test(m);
  return typedAsTicker && norm(m) === norm(symbol.split(".")[0]);
}

interface ScoredCandidate {
  suggestion: SymbolSuggestion;
  /** Identity key: same-company listings share it, different companies don't. */
  coreKey: string;
  /** The candidate's identity tokens — kept for the derived-product check. */
  tokens: Set<string>;
  /** Mention identity tokens the candidate matched — match completeness. */
  shared: number;
  /** Candidate identity tokens NOT present in the mention — match looseness. */
  extras: number;
  /** Input (relevance) position, the tie-breaker. */
  order: number;
}

const FUND_TYPES = /etf|fund/i;

/** Every token of `sub` present in `sup`. */
function isSubset(sub: Set<string>, sup: Set<string>): boolean {
  for (const t of sub) if (!sup.has(t)) return false;
  return true;
}

/** "apple inc" ↔ "Apple Inc." — the mention IS the candidate's full official
 * name, punctuation aside. The strongest identity claim a name can make:
 * when the model expands a brand to the official corporate name and it
 * matches a listing verbatim, near-miss namesakes stop being rivals. */
function fullNameEquals(mention: string, candidateName: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9&]/g, "");
  const m = norm(mention);
  return m.length > 0 && m === norm(candidateName);
}

/**
 * A candidate whose name carries clearly MORE unexplained identity than it
 * shares with the mention is a passing reference, not the thing the user
 * named: "google" inside "CBOE EQUITY VIXON GOOGLE" or "Kurv Yield Premium
 * Strategy Google ETF" must not qualify. One extra word is always fine
 * ("Micron" → "Micron Technology"); beyond that the candidate has to match
 * at least as much as it adds. Kind-matched candidates are exempt — futures
 * contracts legitimately carry contract-month noise ("E-Mini S&P 500 Sep 26").
 */
function tooLoose(shared: number, extras: number): boolean {
  return extras > shared && extras > 1;
}

/**
 * Score and rank raw search hits against the user's mention. Pure — the whole
 * resolution policy is testable without the network.
 */
export function rankCandidates(
  mention: string,
  suggestions: SymbolSuggestion[],
  options: ResolveMentionOptions = {},
): ResolvedAsset | null {
  // Split the mention into identity tokens and asset-kind words ("index",
  // "futures", "stock") — kind words steer TYPE preference, not name identity.
  const kinds: RegExp[] = [];
  const mentionTokens = new Set<string>();
  for (const t of nameTokens(mention)) {
    const kind = KIND_WORDS.find(([word]) => word.test(t));
    if (kind) kinds.push(kind[1]);
    else mentionTokens.add(t);
  }
  const allowDerivatives = options.allowDerivatives || kinds.some((k) => DERIVATIVE_KINDS.test(k.source));

  const eligible = suggestions.filter(
    (s) => allowDerivatives || !DERIVATIVE_TYPES.test(s.type ?? ""),
  );

  // 1. Exact ticker beats everything — the user told us the instrument.
  const exact = eligible.find((s) => isExactTicker(mention, s.symbol));
  if (exact) {
    return {
      symbol: exact.symbol,
      name: exact.name,
      type: exact.type,
      exchange: exact.exchange,
      resolution: "exact",
    };
  }

  if (mentionTokens.size === 0) return null;

  const typeMatchesKind = (s: SymbolSuggestion) => kinds.some((k) => k.test(s.type ?? ""));

  // 2. Full name matches: the distinctive tokens they share must cover one
  //    side entirely (overlap coefficient of 1) — "Tesla" ⊂ "Tesla, Inc." and
  //    "Tesla Motors" ⊇ "Tesla, Inc." both qualify; "Blorptech Industries" vs
  //    "Teva Pharmaceutical Industries" shares only "industries", covering
  //    neither side, and does not.
  const fullMatches: ScoredCandidate[] = [];
  eligible.forEach((s, order) => {
    const candTokens = new Set<string>();
    for (const t of nameTokens(s.name)) {
      if (!KIND_WORDS.some(([word]) => word.test(t))) candTokens.add(t);
    }
    if (candTokens.size === 0) return;
    const shared = intersectionSize(mentionTokens, candTokens);
    if (shared < Math.min(mentionTokens.size, candTokens.size)) return;
    const extras = candTokens.size - shared;
    if (tooLoose(shared, extras) && !typeMatchesKind(s)) return;
    fullMatches.push({
      suggestion: s,
      coreKey: [...candTokens].sort().join(" "),
      tokens: candTokens,
      shared,
      extras,
      order,
    });
  });
  if (fullMatches.length === 0) return null;

  // 3. When the mention names a kind and a type-matching candidate fully
  //    matches, other types stop competing: "S&P 500 index" means ^SPX, not
  //    the Schwab index FUND one extra word away.
  const kindMatched = kinds.length > 0 ? fullMatches.filter((c) => typeMatchesKind(c.suggestion)) : [];
  const pool = kindMatched.length > 0 ? kindMatched : fullMatches;

  // 4. Group listings of the same company (identical identity tokens), then
  //    rank groups: most of the mention matched first ("Reliance Industries"
  //    must prefer the 2-token match over bare "Reliance, Inc."), tightest
  //    name second, Yahoo relevance third.
  const groups = new Map<string, ScoredCandidate[]>();
  for (const c of pool) {
    const g = groups.get(c.coreKey);
    if (g) g.push(c);
    else groups.set(c.coreKey, [c]);
  }
  const ranked = [...groups.values()]
    .map((members) => members.sort((a, b) => a.order - b.order)[0])
    .sort((a, b) => b.shared - a.shared || a.extras - b.extras || a.order - b.order);

  const best = ranked[0];
  // 5. A DIFFERENT company matching the mention as completely and nearly as
  //    tightly (within one identity token) is real ambiguity: "Reliance"
  //    fully matches both Reliance, Inc. (0 extras) and Reliance Industries
  //    (1 extra). "Apple" matches Apple Inc. (0 extras) and Apple Hospitality
  //    REIT (2 extras) — not a rival. Two carve-outs:
  //      - The mention IS the best candidate's full official name ("Apple
  //        Inc." verbatim) — the strongest possible identity claim, so
  //        namesakes stop competing.
  //      - A fund/ETF whose name merely WRAPS the best candidate's ("Bandhan
  //        Nifty 50 Index Fund" around "NIFTY 50") is a derived product
  //        tracking it, not a different reading of the mention.
  const rival = fullNameEquals(mention, best.suggestion.name)
    ? undefined
    : ranked.find(
        (r) =>
          r !== best &&
          r.shared === best.shared &&
          r.extras <= best.extras + 1 &&
          !(
            FUND_TYPES.test(r.suggestion.type ?? "") &&
            !FUND_TYPES.test(best.suggestion.type ?? "") &&
            isSubset(best.tokens, r.tokens)
          ),
      );

  return {
    symbol: best.suggestion.symbol,
    name: best.suggestion.name,
    type: best.suggestion.type,
    exchange: best.suggestion.exchange,
    resolution: rival ? "ambiguous" : "strong",
    ...(rival
      ? { alternative: { symbol: rival.suggestion.symbol, name: rival.suggestion.name } }
      : {}),
  };
}

/**
 * Resolve one user mention ("Tesla", "HDFC Bank", "USD/INR") to a verified
 * instrument, or null when nothing qualifies. Fetches a wide candidate set —
 * the old top-1 lookup is how Yahoo's fuzzy ranking became the (wrong)
 * decision-maker.
 *
 * Kind words are stripped into a SECOND search query: they are type signals
 * for ranking, but as search terms they poison Yahoo's results — "Nifty 50
 * index" returns index FUNDS (their names contain "index") while the index
 * itself, plain "NIFTY 50", doesn't surface at all. Both candidate sets are
 * merged before ranking, where the kind preference then does its job.
 */
export async function resolveAssetMention(
  mention: string,
  options: ResolveMentionOptions = {},
): Promise<ResolvedAsset | null> {
  const q = mention.trim();
  if (!q) return null;

  const stripped = q
    .split(/\s+/)
    .filter((w) => {
      const [token] = [...nameTokens(w)];
      return !(token && KIND_WORDS.some(([word]) => word.test(token)));
    })
    .join(" ")
    .trim();

  const queries = stripped && stripped.toLowerCase() !== q.toLowerCase() ? [q, stripped] : [q];
  const results = await Promise.all(queries.map((query) => searchSymbols(query, 8)));
  const seen = new Set<string>();
  const suggestions = results.flat().filter((s) => {
    if (seen.has(s.symbol)) return false;
    seen.add(s.symbol);
    return true;
  });
  return rankCandidates(q, suggestions, options);
}
