/**
 * The Tape — pure clustering, dedupe, noise filtering, and recency logic for
 * The Wire's raw headline feed (`ScannerResult.newsItems`).
 *
 * Distinct from lib/scanner/dedup.ts by design: that module is an LLM batch
 * call capped at 20 items that produces the pipeline's MarketEvents; this one
 * is deterministic, runs client-side over the full uncapped feed, and costs
 * nothing. One real-world event covered by five outlets must render as one
 * row with a "5 sources" expander, not five rows.
 *
 * Everything here is a pure function of (items, now) — no fetches, no DB, no
 * component state — so the thresholds below are testable facts, not tuning
 * folklore buried in a component.
 */

import type { NewsItem } from "../types";
import { storyIdFor } from "../story-id";

/* -------------------------------------------------------------------------- */
/* Tunable constants (exported so tests pin behavior and the UI can cite them) */
/* -------------------------------------------------------------------------- */

/** Two articles more than this far apart are never the same story. */
export const CLUSTER_WINDOW_MS = 48 * 60 * 60 * 1000;

/** Similarity needed to merge on title alone (no shared ticker/entity). */
export const TITLE_SIMILARITY_MIN = 0.6;

/**
 * Similarity needed when the pair already shares a ticker or a distinctive
 * entity token — "Chevron reports second quarter results" and "Chevron records
 * highest quarterly profit in six years" share little vocabulary beyond the
 * anchor, so the anchored bar is deliberately lower.
 */
export const ANCHORED_SIMILARITY_MIN = 0.3;

/**
 * A token is a usable entity anchor only if it appears in at most this share
 * of the corpus — "chevron" anchors, "stocks" does not. The absolute floor
 * keeps the rule sane on small feeds, where one heavily-covered story can
 * itself be a third of the corpus.
 */
export const DISTINCTIVE_DF_MAX_RATIO = 0.3;
export const DISTINCTIVE_DF_FLOOR = 6;

/**
 * Tokens that must never anchor a merge no matter how rare they are in a
 * given feed — market-vocabulary that different stories legitimately share.
 * An anchor plus ANCHORED_SIMILARITY_MIN is enough to merge, so this list is
 * what stops "Apple Q2 earnings" and "Chevron Q2 earnings" from being one row.
 */
const GENERIC_ANCHORS = new Set([
  "stock", "market", "share", "investor", "earning", "profit", "revenue",
  "price", "trade", "trading", "buy", "sell", "rally", "fall", "rise",
  "q1", "q2", "q3", "q4", "quarter", "year", "month", "week", "day",
  "billion", "million", "percent", "report", "result", "record", "beat",
  "miss", "estimat", "analyst", "wall", "street", "new", "big", "top",
]);

/** Items older than this get a muted stale badge; a LIVE tape must say so. */
export const STALE_AFTER_MS = 72 * 60 * 60 * 1000;

/** Noise score at or above this marks a story filtered (never deleted). */
export const NOISE_THRESHOLD = 2;

/* -------------------------------------------------------------------------- */
/* Title normalisation                                                         */
/* -------------------------------------------------------------------------- */

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "with", "as",
  "at", "by", "its", "is", "are", "be", "was", "were", "has", "have", "had",
  "will", "would", "could", "should", "may", "might", "from", "after", "before",
  "over", "under", "amid", "about", "into", "than", "that", "this", "these",
  "those", "it", "they", "their", "our", "your", "his", "her", "he", "she",
  "we", "you", "i", "not", "no", "so", "but", "if", "while", "when", "what",
  "how", "why", "who", "which", "up", "down", "out", "off", "just", "more",
  "most", "very", "can", "do", "does", "did", "here", "there", "all", "some",
]);

/** "(NYSE: CVX)", "(EQX)", "TSX: OLA" — tickers restated inside headlines. */
const TICKER_MENTION_RE =
  /\(\s*(?:nyse american|nyse|nasdaq|tsx|tsxv|amex|nse|bse)?\s*:?\s*[A-Z]{1,6}(?:\.[A-Z]{1,3})?\s*\)|\b(?:nyse american|nyse|nasdaq|tsx|tsxv|amex|nse|bse)\s*:\s*[A-Z]{1,6}(?:\.[A-Z]{1,3})?\b/gi;

/** Trailing " - MINING.COM", " | Reuters" style source suffixes (≤4 words). */
const SOURCE_SUFFIX_RE = /\s+[-–—|]\s+(?:[\w.&']+\s*){1,4}$/;

/** Light stemmer — enough to make "quarterly"/"quarter", "reports"/"report" agree. */
function stem(word: string): string {
  if (word.length <= 3) return word;
  return word
    .replace(/'s$/, "")
    .replace(/(ies)$/, "y")
    .replace(/(es|ed|ing|ly)$/, "")
    .replace(/s$/, "");
}

/** Lowercased, punctuation/ticker/source-suffix stripped token set. */
export function normalizeTitle(headline: string): string[] {
  const cleaned = headline
    .replace(TICKER_MENTION_RE, " ")
    .replace(SOURCE_SUFFIX_RE, " ")
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[^a-z0-9\s']/g, " ");
  const tokens: string[] = [];
  for (const raw of cleaned.split(/\s+/)) {
    const w = raw.replace(/^'+|'+$/g, "");
    if (!w || STOPWORDS.has(w)) continue;
    const s = stem(w);
    if (s && !STOPWORDS.has(s)) tokens.push(s);
  }
  return tokens;
}

/**
 * Overlap coefficient (|A∩B| / min(|A|,|B|)) rather than Jaccard: a terse wire
 * headline and a long SEO rewrite of the same story should still score high.
 */
export function titleSimilarity(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const setA = new Set(a);
  const setB = new Set(b);
  let shared = 0;
  for (const t of setA) if (setB.has(t)) shared++;
  return shared / Math.min(setA.size, setB.size);
}

/* -------------------------------------------------------------------------- */
/* Source priority — who gets to be the canonical headline                     */
/* -------------------------------------------------------------------------- */

/**
 * Lower tier wins. Primary wires and filings over mainstream press, both over
 * aggregators and SEO content mills.
 */
const SOURCE_TIERS: { pattern: RegExp; tier: number }[] = [
  {
    pattern:
      /reuters|bloomberg|associated press|business wire|pr newswire|globenewswire|newswire|accesswire|\bcnw\b|sec filing|edgar|nse india|bse india/i,
    tier: 0,
  },
  {
    pattern:
      /wall street journal|wsj|financial times|cnbc|barron|economic times|globe and mail|yahoo finance|marketwatch|cnn business|cbs news|moneycontrol|mint\b|nikkei|mining\.com/i,
    tier: 1,
  },
  {
    pattern:
      /google news|marketscreener|benzinga|zacks|simply wall|motley fool|24\/7 wall|seeking alpha|gobankingrates|insider monkey|stocktwits|newsbreak/i,
    tier: 3,
  },
];

export function sourceTier(source: string): number {
  for (const { pattern, tier } of SOURCE_TIERS) {
    if (pattern.test(source)) return tier;
  }
  return 2; // unknown outlets sit between the mainstream press and the mills
}

/* -------------------------------------------------------------------------- */
/* Noise rules — configurable scoring, never silent deletion                   */
/* -------------------------------------------------------------------------- */

export interface NoiseRule {
  id: string;
  label: string;
  weight: number;
  /** Rule matches only if every provided pattern matches. */
  headline?: RegExp;
  source?: RegExp;
}

export const DEFAULT_NOISE_RULES: NoiseRule[] = [
  {
    id: "sports",
    label: "Sports",
    weight: 3,
    headline:
      /\b(nfl|nba|mlb|nhl|premier league|champions league|super bowl|world cup|olympics|touchdown|quarterback|playoffs?|grand slam|home run)\b/i,
  },
  {
    id: "personal-finance",
    label: "Personal finance",
    weight: 2,
    headline:
      /\b(credit cards?|credit score|social security check|retire (early|at \d+)|retirement (savings|accounts?|savers)|401\(k|roth ira|net worth by age|side hustle|paycheck to paycheck|emergency fund|dave ramsey|suze orman)\b/i,
  },
  {
    id: "listicle-screener",
    label: "Screener listicle",
    weight: 2,
    // Leading-number listicles tolerate up to two adjectives ("2 Unstoppable
    // Growth ETFs…"); superlative screeners ("The Cheapest ETFs for…") and
    // "worth buying" bait are the same genre without the number.
    headline:
      /^(?:the\s+)?\d+\s+(?:\w+\s+){0,2}(stocks?|etfs?|funds?|cryptos?|dividends?)\b|\b(top|best|cheapest)\s+(?:\d+\s+)?(stocks?|etfs?|funds?|dividend stocks?)\b|\b(stocks?|etfs?|funds?)\s+(to buy|worth buying|to watch)\b|\byou (won'?t believe|need to see)\b/i,
  },
  {
    id: "content-mill-advice",
    label: "Content-mill advice",
    // Weight 2 so an advice-framed headline from a known mill filters on its
    // own — at weight 1 this rule could never trip the threshold unaided.
    weight: 2,
    source: /motley fool|gobankingrates|24\/7 wall|insider monkey|newsbreak/i,
    headline:
      /\b(if you|should you|here'?s (what|how much)|why you should|mistakes?|need to know|worth buying|your money|passive income)\b/i,
  },
];

export interface NoiseVerdict {
  score: number;
  matched: string[]; // rule ids
  filtered: boolean;
}

export function classifyNoise(item: NewsItem, rules: NoiseRule[] = DEFAULT_NOISE_RULES): NoiseVerdict {
  let score = 0;
  const matched: string[] = [];
  for (const rule of rules) {
    const headlineOk = rule.headline ? rule.headline.test(item.headline) : true;
    const sourceOk = rule.source ? rule.source.test(item.source) : true;
    if (headlineOk && sourceOk) {
      score += rule.weight;
      matched.push(rule.id);
    }
  }
  return { score, matched, filtered: score >= NOISE_THRESHOLD };
}

/* -------------------------------------------------------------------------- */
/* Clustering                                                                  */
/* -------------------------------------------------------------------------- */

export type TapeBucket = "hour" | "today" | "yesterday" | "earlier";

/**
 * Duration-based buckets, not calendar-midnight ones: deterministic in every
 * timezone and honest for a feed whose items carry ISO timestamps from many
 * markets. "Today" = the last 24h, "Yesterday" = 24-48h.
 */
export const TAPE_BUCKET_LABELS: Record<TapeBucket, string> = {
  hour: "Last hour",
  today: "Today",
  yesterday: "Yesterday",
  earlier: "Earlier",
};

const BUCKET_ORDER: TapeBucket[] = ["hour", "today", "yesterday", "earlier"];

export function bucketFor(publishedAt: string, now: number): TapeBucket {
  const age = now - new Date(publishedAt).getTime();
  if (!Number.isFinite(age) || age < 0) return "today";
  if (age <= 60 * 60 * 1000) return "hour";
  if (age <= 24 * 60 * 60 * 1000) return "today";
  if (age <= CLUSTER_WINDOW_MS) return "yesterday";
  return "earlier";
}

export interface TapeStory {
  /** Stable across rebuilds of the same articles (hash of member URLs). */
  id: string;
  canonical: NewsItem;
  /** All member articles, canonical first, then by source tier and recency. */
  items: NewsItem[];
  /** Evidence ids of the member articles — the forward-trace handle. */
  storyIds: string[];
  sourceCount: number;
  tickers: string[];
  earliestAt: string;
  latestAt: string;
  stale: boolean;
  bucket: TapeBucket;
  noise: NoiseVerdict;
}

export interface TapeView {
  /** Visible stories, bucket-ordered (newest bucket first), newest first within. */
  stories: TapeStory[];
  /** Noise-flagged stories — shown only behind the "show filtered (N)" toggle. */
  filtered: TapeStory[];
  totalArticles: number;
  /** Articles absorbed into multi-source rows (totalArticles − rendered rows). */
  clusteredArticles: number;
  /** The `now` this view was computed against — render ages relative to this. */
  builtAt: number;
}

/** FNV-1a — tiny stable hash for deterministic story ids. */
function hashId(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

interface WorkingItem {
  item: NewsItem;
  tokens: string[];
  tickers: Set<string>;
  timeMs: number;
  noise: NoiseVerdict;
}

function normalizeTicker(t: string): string {
  return t.toUpperCase().replace(/\.(NS|BO)$/, "");
}

/** Decide whether two articles describe the same story. */
function sameStory(
  a: WorkingItem,
  b: WorkingItem,
  distinctive: Set<string>,
): boolean {
  if (Math.abs(a.timeMs - b.timeMs) > CLUSTER_WINDOW_MS) return false;

  const sim = titleSimilarity(a.tokens, b.tokens);
  if (sim >= TITLE_SIMILARITY_MIN) return true;
  if (sim < ANCHORED_SIMILARITY_MIN) return false;

  for (const t of a.tickers) if (b.tickers.has(t)) return true;
  for (const tok of a.tokens) {
    if (distinctive.has(tok) && b.tokens.includes(tok)) return true;
  }
  return false;
}

/**
 * Cluster the raw feed into stories, classify noise, and bucket by recency.
 * Pure: same (items, now, rules) in, same TapeView out.
 */
export function buildTape(
  items: NewsItem[],
  opts: { now?: number; rules?: NoiseRule[] } = {},
): TapeView {
  const now = opts.now ?? Date.now();
  const rules = opts.rules ?? DEFAULT_NOISE_RULES;

  // Exact duplicates first: the same article can arrive twice (two holdings'
  // feeds, a flaky upstream). Clustering would merge them into one story but
  // still render a phantom "2 sources" expander of identical rows — and the
  // duplicate would double-count in totalArticles. Tickers union so a shared
  // article keeps every symbol that surfaced it.
  const byKey = new Map<string, NewsItem>();
  for (const item of items) {
    const key = item.url || `${item.headline}\u0000${item.source}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, item);
    } else if (item.tickers.some((t) => !existing.tickers.includes(t))) {
      byKey.set(key, { ...existing, tickers: [...new Set([...existing.tickers, ...item.tickers])] });
    }
  }
  const deduped = [...byKey.values()];

  const working: WorkingItem[] = deduped.map((item) => ({
    item,
    tokens: normalizeTitle(item.headline),
    tickers: new Set(item.tickers.map(normalizeTicker)),
    timeMs: new Date(item.publishedAt).getTime() || now,
    noise: classifyNoise(item, rules),
  }));

  // Corpus document frequency → which tokens are distinctive enough to anchor.
  const df = new Map<string, number>();
  for (const w of working) {
    for (const tok of new Set(w.tokens)) df.set(tok, (df.get(tok) ?? 0) + 1);
  }
  const maxDf = Math.max(DISTINCTIVE_DF_FLOOR, Math.floor(working.length * DISTINCTIVE_DF_MAX_RATIO));
  const distinctive = new Set(
    [...df.entries()]
      .filter(([tok, count]) => count <= maxDf && !GENERIC_ANCHORS.has(tok))
      .map(([tok]) => tok),
  );

  // True single-linkage via union-find over all pairs — a one-pass greedy
  // assignment is order-dependent (an SEO rewrite processed before the wire
  // copy it links to would strand earlier variants in a second cluster).
  // Feeds are ≤~100 items, so O(n²) comparisons are trivial.
  const parent = working.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < working.length; i++) {
    for (let j = i + 1; j < working.length; j++) {
      if (find(i) !== find(j) && sameStory(working[i], working[j], distinctive)) {
        parent[find(j)] = find(i);
      }
    }
  }
  const byRoot = new Map<number, WorkingItem[]>();
  working.forEach((w, i) => {
    const root = find(i);
    const members = byRoot.get(root) ?? [];
    members.push(w);
    byRoot.set(root, members);
  });
  const clusters = [...byRoot.values()];

  const stories = clusters.map((members): TapeStory => {
    const byPriority = [...members].sort(
      (a, b) =>
        sourceTier(a.item.source) - sourceTier(b.item.source) ||
        a.timeMs - b.timeMs, // original reporting over the re-write
    );
    const canonical = byPriority[0].item;
    const latest = Math.max(...members.map((m) => m.timeMs));
    const earliest = Math.min(...members.map((m) => m.timeMs));
    const tickers = [...new Set(members.flatMap((m) => [...m.tickers]))];
    // A story is noise only if every one of its sources is — one legitimate
    // outlet covering it rescues the row.
    const least = members.reduce((a, b) => (a.noise.score <= b.noise.score ? a : b)).noise;

    return {
      id: hashId(members.map((m) => m.item.url || m.item.headline).sort().join("\n")),
      canonical,
      items: byPriority.map((m) => m.item),
      storyIds: byPriority.map((m) => m.item.storyId ?? storyIdFor(m.item)),
      sourceCount: members.length,
      tickers,
      earliestAt: new Date(earliest).toISOString(),
      latestAt: new Date(latest).toISOString(),
      stale: now - latest > STALE_AFTER_MS,
      bucket: bucketFor(new Date(latest).toISOString(), now),
      noise: least,
    };
  });

  const order = (s: TapeStory) => BUCKET_ORDER.indexOf(s.bucket);
  stories.sort((a, b) => order(a) - order(b) || b.latestAt.localeCompare(a.latestAt));

  const visible = stories.filter((s) => !s.noise.filtered);
  const filtered = stories.filter((s) => s.noise.filtered);

  return {
    stories: visible,
    filtered,
    totalArticles: deduped.length,
    clusteredArticles: deduped.length - stories.length,
    builtAt: now,
  };
}
