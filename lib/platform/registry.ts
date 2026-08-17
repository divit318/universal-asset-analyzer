/**
 * Dataset Registry — the single source of truth for cache policy.
 *
 * Before this existed, cache lifetimes were scattered across five unrelated
 * implementations: a 15-minute history cache in lib/yahoo.ts, a 5-minute
 * CompanyContext cache in lib/ai/context.ts, a 24-hour SQLite fundamentals
 * cache used only by the Screener, a 15-minute `scanner_cache` table that any
 * unrelated write would prune, and EDGAR's CIK map. None of them knew about the
 * others, so the same Yahoo endpoint was hit three to five times per page load
 * and nothing could be invalidated coherently.
 *
 * Policies live here and nowhere else. There is deliberately no universal TTL:
 * a live quote and a 10-K have nothing in common except that they are both
 * "data", and pretending otherwise is how you end up either hammering the
 * provider or showing a stale price next to a buy button.
 *
 * Client-safe (pure data + pure functions).
 */

import type { CachePolicy, DatasetId } from "./types";

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export const DATASETS: Record<DatasetId, CachePolicy> = {
  /* ---------------------------------------------------------------- */
  /* Live market data — short TTLs, never persisted                     */
  /* ---------------------------------------------------------------- */

  // A quote is the one number a user might trade on, so it gets the shortest
  // life of anything here and NO stale-while-revalidate window: we would rather
  // make the caller wait 200ms than paint a stale price. The 15s TTL exists
  // purely to collapse the burst of identical quote lookups that a single page
  // load fires across five different API routes — within one page load, the
  // price genuinely has not changed. Deduplication (lib/platform/dedup.ts)
  // handles the concurrent case; this handles the near-simultaneous one.
  quote: { ttlMs: 15 * SECOND, swrMs: 0, persist: false, source: "yahoo", label: "Live quote", dependents: ["companyContext", "aiVerdict"] },
  "quotes.batch": { ttlMs: 15 * SECOND, swrMs: 0, persist: false, source: "yahoo", label: "Batch quotes" },

  // Daily bars only change once, after the close. The live day's final bar is
  // negligible against a multi-year series, so a generous TTL with a long SWR
  // window costs nothing and turns SPY/sector-ETF benchmark refetches — which
  // nearly every research, portfolio, and compare call makes — into map hits.
  history: { ttlMs: 15 * MINUTE, swrMs: 2 * HOUR, persist: true, source: "yahoo", label: "Price history", dependents: ["companyContext", "aiVerdict"] },

  /* ---------------------------------------------------------------- */
  /* Slow-moving company reference data                                 */
  /* ---------------------------------------------------------------- */

  // Sector, industry, headquarters, employee count. Changes essentially never.
  profile: { ttlMs: 24 * HOUR, swrMs: 7 * DAY, persist: true, source: "yahoo", label: "Company profile" },
  quoteSummary: { ttlMs: 4 * HOUR, swrMs: 12 * HOUR, persist: true, source: "yahoo", label: "Quote summary" },
  fundamentalsTimeSeries: { ttlMs: 24 * HOUR, swrMs: 3 * DAY, persist: true, source: "yahoo", label: "Fundamentals time series" },

  /* ---------------------------------------------------------------- */
  /* Fundamentals & derived analysis — the dependency spine             */
  /* ---------------------------------------------------------------- */

  // Statements are the root of the analytical chain. When a new filing lands,
  // invalidating `statements` must cascade to everything computed FROM them
  // (fundamentals → peers → context → the AI verdict) while leaving the
  // company profile, price history, and every other symbol untouched.
  statements: { ttlMs: 12 * HOUR, swrMs: DAY, persist: true, source: "yahoo", label: "Financial statements", dependents: ["fundamentals", "companyContext", "aiVerdict"] },
  fundamentals: { ttlMs: 4 * HOUR, swrMs: 12 * HOUR, persist: true, source: "yahoo", label: "Fundamentals snapshot", dependents: ["peers", "companyContext", "aiVerdict"] },
  peers: { ttlMs: 6 * HOUR, swrMs: 24 * HOUR, persist: true, source: "yahoo", label: "Peer comparison", dependents: ["companyContext"] },
  options: { ttlMs: 10 * MINUTE, swrMs: 30 * MINUTE, persist: false, source: "yahoo", label: "Options chain" },
  fundProfile: { ttlMs: 12 * HOUR, swrMs: DAY, persist: true, source: "yahoo", label: "Fund profile", dependents: ["aiVerdict"] },

  /* ---------------------------------------------------------------- */
  /* Filings & news                                                     */
  /* ---------------------------------------------------------------- */

  // A new 8-K/10-Q is exactly the event that should invalidate the analytical
  // chain, so `filings` declares statements as a dependent.
  filings: { ttlMs: 6 * HOUR, swrMs: DAY, persist: true, source: "sec_edgar", label: "SEC filings", dependents: ["statements", "companyContext", "aiVerdict"] },
  news: { ttlMs: 15 * MINUTE, swrMs: HOUR, persist: false, source: "yahoo", label: "Company news", dependents: ["companyContext"] },

  // Indian listings get their own per-symbol pipeline (lib/india-news.ts):
  // NSE corporate announcements are the India analogue of `filings` — official,
  // slow-moving, worth persisting; Google News India media coverage matches the
  // `news` cadence. Both feed the AI context, so both cascade into it.
  indiaAnnouncements: { ttlMs: 30 * MINUTE, swrMs: 3 * HOUR, persist: true, source: "nse_india", label: "NSE corporate announcements", dependents: ["companyContext"] },
  indiaNews: { ttlMs: 15 * MINUTE, swrMs: HOUR, persist: false, source: "google_news", label: "India company news", dependents: ["companyContext"] },
  // Official results metadata (filing timestamps, period, audited flag) plus
  // bank asset-quality figures extracted from the attached XBRL. Changes at
  // most once a quarter per company; generous life, always persisted.
  indiaResults: { ttlMs: 6 * HOUR, swrMs: DAY, persist: true, source: "nse_india", label: "NSE financial results" },
  // Board-meeting calendar (upcoming results dates). Sparse and slow-moving.
  indiaEvents: { ttlMs: 12 * HOUR, swrMs: 2 * DAY, persist: true, source: "nse_india", label: "NSE event calendar" },
  // Compact per-symbol ownership + ROE/ROCE extracts for the India screener
  // (lib/india-ownership.ts). Shareholding changes quarterly; long-lived by
  // design, written by the bounded trickle + research visits, never fetched
  // on read.
  indiaOwnership: { ttlMs: 7 * DAY, swrMs: 30 * DAY, persist: true, source: "screener_in", label: "India ownership extract" },
  // Dividend + split/bonus history from Yahoo chart events — effectively
  // static history that gains at most a few rows a year.
  corporateActions: { ttlMs: DAY, swrMs: 7 * DAY, persist: true, source: "yahoo", label: "Corporate actions" },

  // SEC's ticker→CIK index: one ~1MB file covering every registrant, and the
  // mandatory first hop of *every* EDGAR lookup. It is not asset-scoped, so it
  // is keyed once globally. The long TTL reflects how rarely the index changes
  // (a new listing, not a new filing); the long SWR window means the rare
  // refresh never blocks a filings request. Before this was a dataset it was a
  // process-lifetime memo in lib/edgar.ts, which meant a cold process fetched
  // the whole index once per concurrent caller and then never refreshed it for
  // the life of the server.
  cikMap: { ttlMs: 7 * DAY, swrMs: 30 * DAY, persist: true, source: "sec_edgar", label: "SEC ticker→CIK index" },

  /* ---------------------------------------------------------------- */
  /* India (screener.in)                                                */
  /* ---------------------------------------------------------------- */

  // The India equivalent of the whole US fundamentals chain, arriving as one
  // scrape. It is expensive (two HTML fetches + parse) and screener.in is
  // rate-sensitive, so it keeps the 6h life it had as a private Map in
  // lib/screener-in.ts — but now it is deduped, persisted across restarts, and
  // invalidatable like everything else.
  screenerIn: { ttlMs: 6 * HOUR, swrMs: DAY, persist: true, source: "screener_in", label: "screener.in company", dependents: ["companyContext", "aiVerdict"] },

  // One AMC's full scheme-level TER table for the latest published month
  // (AMFI publishes TER monthly; a value can only change with a month's lag).
  // Keyed per AMC, not per scheme: one ~1.5MB fetch covers every scheme the
  // house runs, so researching three HDFC funds costs one AMFI round-trip.
  // The fundProfile dataset consumes this, so it is declared as a dependent.
  amfiTer: { ttlMs: 3 * DAY, swrMs: 7 * DAY, persist: true, source: "amfi", label: "AMFI scheme TER", dependents: ["fundProfile"] },

  /* ---------------------------------------------------------------- */
  /* Market-wide                                                        */
  /* ---------------------------------------------------------------- */

  macro: { ttlMs: 30 * MINUTE, swrMs: 2 * HOUR, persist: true, source: "yahoo", label: "Macro / yield curve" },
  sectorRotation: { ttlMs: 30 * MINUTE, swrMs: 4 * HOUR, persist: false, source: "platform", label: "Sector rotation" },
  search: { ttlMs: 10 * MINUTE, swrMs: HOUR, persist: false, source: "yahoo", label: "Symbol search" },

  /* ---------------------------------------------------------------- */
  /* Derived context + AI                                               */
  /* ---------------------------------------------------------------- */

  companyContext: { ttlMs: 5 * MINUTE, swrMs: 15 * MINUTE, persist: false, source: "platform", label: "AI company context", dependents: ["aiVerdict"] },

  // An AI report is the single most expensive thing the platform produces —
  // measured at 115s of local inference for one equity verdict, against 0.04s to
  // replay it from here. It is persisted and long-lived precisely so that a
  // second look at a company costs nothing.
  //
  // What invalidates it: anything that could move the *thesis*. `filings`,
  // `statements`, and `fundamentals` all declare it (directly or through
  // `companyContext`), so a new 10-Q drops the verdict for that symbol alone.
  //
  // Note that `quote` also declares it, so an explicit
  // `invalidateAsset(sym, "quote")` would drop the verdict too. Nothing calls
  // that today — quotes expire on their own 15s TTL rather than by invalidation —
  // but if a caller ever adds it, be aware it discards a two-minute generation
  // for a price tick that does not change the argument.
  aiVerdict: { ttlMs: 6 * HOUR, swrMs: 24 * HOUR, persist: true, source: "platform", label: "AI investment verdict" },
  aiSection: { ttlMs: 6 * HOUR, swrMs: 24 * HOUR, persist: true, source: "platform", label: "AI report section" },

  // The most expensive artifact in the app by an order of magnitude: eight
  // sequential local-model calls, minutes of inference, for one theme. Keyed by
  // the normalized theme rather than a symbol, persisted, and given a long life
  // because a theme's dependency chain, bottleneck and policy backdrop do not
  // move in a day — while re-deriving them costs the user another ten minutes.
  // The SWR window is deliberately long for the same reason: serving yesterday's
  // report instantly beats blocking on a fresh one the user did not ask for.
  thematicReport: { ttlMs: 12 * HOUR, swrMs: 6 * DAY, persist: true, source: "platform", label: "Thematic report" },

  /* ---------------------------------------------------------------- */
  /* Composed page payloads (Today dashboard rebuild)                   */
  /* ---------------------------------------------------------------- */

  // The universal portfolio report: every engine over every holding. Audit
  // PF-02 measured it being built THREE TIMES in parallel on one homepage
  // load (digest, IOS context, brief route), 8-9s each. Two minutes of TTL
  // is well inside the tolerance of a surface whose own header stamps its
  // as-of; portfolio mutations invalidate it explicitly (see
  // app/api/portfolio routes). The digest depends on it, so invalidation
  // cascades.
  //
  // Persisted + long SWR (Phase 2, 2026-08-11): this report is also the GATE
  // in front of the Research Hub's AI verdict — the IOS profile (fit tier,
  // objective, sector gaps) is derived from it, and the verdict waits for the
  // profile. Measured cold: 15.2s; warm: 0.03s. With persist:false the 15.2s
  // was paid on every server restart and every ~12-minute idle gap, and the
  // verdict stream sat frozen behind it. Serving the persisted report
  // stale-while-revalidating keeps the gate at ~30ms: the fit TIER and sector
  // gaps it feeds move with portfolio composition (which invalidates this
  // explicitly on every mutation), not with a price tick, so a background
  // refresh is the correct freshness model here.
  portfolioReport: { ttlMs: 2 * MINUTE, swrMs: 24 * HOUR, persist: true, source: "platform", label: "Universal portfolio report", dependents: ["missionContext", "homeDigest", "portfolioThesis", "exposureModel"] },

  // The Exposure graph's routes: positions, issuers, and the quantified paths
  // between them. Derived entirely from `portfolioReport` plus fund
  // constituents, so it inherits that dataset's invalidation through the
  // dependency edge above — a trade changes the routes, a price tick does not.
  exposureModel: { ttlMs: 5 * MINUTE, swrMs: 24 * HOUR, persist: true, source: "platform", label: "Exposure routes", dependents: ["exposureDrivers"] },

  // Drivers: per-issuer industry profiles and the reference-fund co-membership
  // probes. Deliberately the longest TTL on this page — an industry
  // classification and a thematic ETF's top ten do not move intraday, and this
  // is the only expensive part of the feature (tens of provider round-trips on
  // a cold build). Kept OFF the first paint; see lib/exposure/index.ts.
  exposureDrivers: { ttlMs: 12 * HOUR, swrMs: 3 * DAY, persist: true, source: "platform", label: "Exposure drivers" },

  // The Portfolio page's AI thesis banner. Same policy family as `aiVerdict`
  // and for the same reason: a ~20s generation whose conclusions change with
  // the portfolio's COMPOSITION, not with a price tick. Keyed on the
  // composition hash (lib/portfolio/thesis.ts:compositionKey); every mutation
  // invalidates it through the portfolioReport dependency edge above, so the
  // 6h TTL only governs market-drift staleness. Previously cached in
  // scanner_cache, whose 15-minute read TTL silently re-ran the generation on
  // nearly every visit.
  portfolioThesis: { ttlMs: 6 * HOUR, swrMs: 24 * HOUR, persist: true, source: "platform", label: "Portfolio AI thesis" },

  // Mission-control context (legacy report + rotation + regime + alerts):
  // shared by the digest's ctx step and the brief route.
  missionContext: { ttlMs: 2 * MINUTE, swrMs: 10 * MINUTE, persist: false, source: "platform", label: "Mission-control context", dependents: ["homeDigest"] },

  // The whole homepage payload. Audit PF-01: time-to-meaning was gated on a
  // fresh 8-9s digest build on EVERY load. A 45s TTL keeps a working session
  // instant; the long SWR window means a morning open paints the last known
  // state in milliseconds while the rebuild runs behind it, which is exactly
  // the "show the last known state, honestly stamped" behaviour the north
  // star demands (the payload carries its own generatedAt).
  homeDigest: { ttlMs: 45 * SECOND, swrMs: 30 * MINUTE, persist: false, source: "platform", label: "Home digest" },

  /* ---------------------------------------------------------------- */
  /* Contextual research intelligence (the intel rail)                  */
  /* ---------------------------------------------------------------- */

  // The deterministic card set for one research context. Short-lived: its
  // inputs (quote, news, portfolio report) each carry their own policies, so
  // this exists only to make the rail's repeat polls and quick tab-hops free
  // rather than to extend any input's life. Never persisted — a card set is a
  // moment-in-time judgment, and suppression state (lib/db.ts intel_event) is
  // applied at serve time, not baked into the cache.
  intelCards: { ttlMs: 90 * SECOND, swrMs: 0, persist: false, source: "platform", label: "Contextual intel cards" },

  // The optional AI pass over the SAME context's settled facts. Kicked off in
  // the background after the deterministic set is served (never awaited by the
  // request path) and merged into later polls. Longer-lived because the facts
  // it reasons over move slowly and re-deriving it spends the user's AI plan.
  intelAi: { ttlMs: 30 * MINUTE, swrMs: 2 * HOUR, persist: true, source: "platform", label: "Contextual intel AI pass" },
};

export function policyFor(dataset: DatasetId): CachePolicy {
  return DATASETS[dataset];
}

/**
 * Build a stable cache key. Params are sorted so `{a,b}` and `{b,a}` collapse to
 * one key, and `undefined`/`null` params are dropped rather than stringified —
 * otherwise `history(AAPL, undefined)` and `history(AAPL)` would be two keys for
 * one request, silently halving the hit rate.
 */
export function cacheKey(
  dataset: DatasetId,
  params: Record<string, string | number | boolean | null | undefined> = {},
): string {
  const parts = Object.entries(params)
    .filter(([, v]) => v != null && v !== "")
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`);
  return parts.length > 0 ? `${dataset}:${parts.join(":")}` : dataset;
}

/**
 * Every dataset reachable from `dataset` through the dependents graph,
 * including itself. Cycle-safe.
 *
 * This is the function that makes invalidation surgical: `invalidate("AAPL",
 * "filings")` resolves to filings → statements → fundamentals → peers →
 * companyContext → aiVerdict, and stops there. Apple's price history and
 * Microsoft's anything are never touched.
 */
export function dependencyClosure(dataset: DatasetId): DatasetId[] {
  const seen = new Set<DatasetId>();
  const stack: DatasetId[] = [dataset];
  while (stack.length > 0) {
    const current = stack.pop() as DatasetId;
    if (seen.has(current)) continue;
    seen.add(current);
    for (const dep of DATASETS[current]?.dependents ?? []) {
      if (!seen.has(dep)) stack.push(dep);
    }
  }
  return [...seen];
}
