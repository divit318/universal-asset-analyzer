/**
 * Assistant deterministic fast paths — requests the app can answer without a
 * model call at all.
 *
 * "Open my portfolio" was taking a ~6s LLM round trip to produce a navigation
 * the DESTINATIONS table already fully describes. This layer answers the
 * unambiguous cases in <10ms and hands EVERYTHING else to the model — the
 * boundary is deliberately strict (an exact match on a small alias table
 * after normalization), never a fuzzy keyword net: a request this layer isn't
 * certain about is the model's job, and a wrong instant answer would cost far
 * more trust than 6 seconds. Pure and fully unit-tested.
 *
 * Two shapes are handled:
 *   1. Plain navigation ("open the screener", "go to my watchlist").
 *   2. "What do I own?" — answered from the local ledger (symbols only; P&L
 *      needs live quotes and stays with the Portfolio page).
 */

export type FastPathDestination =
  | "portfolio"
  | "watchlist"
  | "screener"
  | "calendar"
  | "engine"
  | "thematic"
  | "journal"
  | "wire";

export interface FastPathNavigate {
  kind: "navigate";
  destination: FastPathDestination;
}

export interface FastPathHoldings {
  kind: "holdings";
}

/** Portfolio metrics questions answerable from the deterministic report —
 * top positions, performance/P&L, sector exposure. The caller answers them
 * from the warm portfolio snapshot, or falls through to the model (with the
 * same data in its context) when the snapshot isn't ready in budget. */
export interface FastPathPortfolioMetric {
  kind: "portfolio-metric";
  metric: "top-positions" | "performance" | "sector-exposure";
}

export type FastPathMatch = FastPathNavigate | FastPathHoldings | FastPathPortfolioMetric;

/** What each destination may be called. Exact post-normalization matches only. */
const DESTINATION_ALIASES: Record<FastPathDestination, string[]> = {
  portfolio: ["portfolio", "holdings", "positions"],
  watchlist: ["watchlist", "watch list"],
  screener: ["screener", "stock screener"],
  calendar: ["calendar", "earnings calendar"],
  engine: ["engine", "quant engine"],
  thematic: ["thematic"],
  journal: ["journal", "decision journal"],
  wire: ["wire", "the wire", "news wire"],
};

/** Leading verb phrases that mean "navigate to". */
const NAV_PREFIX =
  /^(?:please\s+)?(?:open|show(?:\s+me)?|go\s+to|goto|take\s+me\s+to|navigate\s+to|bring\s+up|view|see|check|where(?:'s|\s+is))\s+/;

const HOLDINGS_QUESTIONS = new Set([
  "what do i own",
  "what do i hold",
  "what am i holding",
  "what stocks do i own",
  "what stocks do i have",
  "which stocks do i own",
  "what are my holdings",
  "show my holdings",
  "list my holdings",
  "my holdings",
]);

/** Exact post-normalization matches per metric — same strictness as
 * navigation: parameterized or open-ended phrasings go to the model. */
const PORTFOLIO_METRIC_QUESTIONS: Record<FastPathPortfolioMetric["metric"], string[]> = {
  "top-positions": [
    "what are my biggest positions",
    "what are my largest positions",
    "my biggest positions",
    "my largest positions",
    "what are my top holdings",
    "my top holdings",
    "what is my biggest position",
    "what is my largest position",
    "what's my biggest position",
    "what's my largest position",
    "what is my biggest holding",
    "what's my biggest holding",
  ],
  performance: [
    "how is my portfolio doing",
    "how's my portfolio doing",
    "how is my portfolio performing",
    "how is my portfolio",
    "what is my total p&l",
    "what's my total p&l",
    "what is my p&l",
    "what's my p&l",
    "what is my total pnl",
    "what's my total pnl",
    "portfolio performance",
    "how am i doing",
  ],
  "sector-exposure": [
    "what is my biggest sector exposure",
    "what's my biggest sector exposure",
    "what is my largest sector exposure",
    "what's my largest sector exposure",
    "what is my sector exposure",
    "what's my sector exposure",
    "my sector exposure",
    "what am i most exposed to",
    "how diversified am i",
    "am i diversified",
  ],
};

function normalize(question: string): string {
  return question
    .toLowerCase()
    .replace(/[?!.,]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Match a question to a deterministic action, or null when the model should
 * handle it. Pure.
 */
export function matchFastPath(question: string): FastPathMatch | null {
  let q = normalize(question);
  if (!q || q.length > 60) return null;

  if (HOLDINGS_QUESTIONS.has(q)) return { kind: "holdings" };
  for (const [metric, phrasings] of Object.entries(PORTFOLIO_METRIC_QUESTIONS) as [
    FastPathPortfolioMetric["metric"],
    string[],
  ][]) {
    if (phrasings.includes(q)) return { kind: "portfolio-metric", metric };
  }

  // Strip one navigation verb, then possessives/articles: "take me to my
  // watchlist" → "watchlist". A remainder that isn't exactly an alias — extra
  // words, a company name, a condition — is NOT a fast path.
  q = q.replace(NAV_PREFIX, "");
  q = q.replace(/^(?:the|my)\s+/, "").replace(/\s+(?:page|tab|module|view)$/, "");

  for (const [destination, aliases] of Object.entries(DESTINATION_ALIASES) as [FastPathDestination, string[]][]) {
    if (aliases.includes(q)) return { kind: "navigate", destination };
  }
  return null;
}
