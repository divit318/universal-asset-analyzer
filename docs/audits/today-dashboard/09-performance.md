# 09. Performance audit

Measured against `next dev` (Turbopack) on the host machine, 2026-08-08. Dev-mode absolute numbers overstate compile costs but the API latencies are application code and reproduce warm. Tools: `docs/audits/today-dashboard/tools/waterfall.mjs`, `tools/perf.mjs` (3 warm runs), `curl` timings, and the dev server request log (dev.log).

## Baseline table (warm, median of 3)

| Metric | Value | Assessment |
|---|---|---|
| TTFB (document) | 80 ms | fine, page shell is static |
| FCP | 204 ms | fine, but it paints SKELETONS |
| DOMContentLoaded | 176 ms | fine |
| CLS | 0.00 | pass (skeleton layout matches) |
| TBT (long tasks) | 0 ms | pass |
| JS heap | 26 MB | fine |
| `/api/home` (the page's real gate) | 8.1 to 9.3 s WARM | FAIL. This is time-to-meaning |
| `/api/portfolio/report?objective=maximize_sharpe` | 8.0 to 9.0 s, fired in parallel on every load | FAIL, redundant |
| `/api/home/brief` | 8.5 s with cached prose; 23.3 s on generation (model call 14.7 s per dev.log) | FAIL, 8.5 s of it is redundant recompute |
| JS transferred (dev) | 7.68 MB over 30 scripts | dev-inflated; needs a prod build check |
| Time to first meaningful content (modules painted) | ~9 s warm, ~16.5 s cold | FAIL against any reasonable target |

## Findings

### PF-01 (critical): time-to-meaning is gated on one 8 to 9 second request, every load
`GET /api/home` runs `buildHomeDigest()` fresh on every request (`app/api/home/route.ts:17` with `dynamic = "force-dynamic"`; no caching layer anywhere in `lib/home/digest.ts`). The whole page renders skeletons until it lands. FCP of 204 ms is meaningless when meaning arrives at 9 s. The digest rebuilds `gatherContext()` and `buildPortfolioReport()` (the two heavy engines) from scratch each time; dev.log shows every `/api/home` at 8 to 9 s application-code time regardless of repetition, so no engine-level cache is absorbing this.

### PF-02 (critical): the same heavy report is built 3x per page load
One load of `/` triggers three independent builds of substantially the same data:
1. `buildHomeDigest()` server-side (`ctx` + `report` steps, digest.ts:165-169).
2. `GET /api/portfolio/report` from `lib/ios-context.tsx:164` (IOS provider mounted in the app layout), 8 to 9 s of identical `buildPortfolioReport()` work, in parallel.
3. `GET /api/home/brief` (`app/api/home/brief/route.ts:36-38`) rebuilds `gatherContext()` AND `buildPortfolioReport()` again before it can even consult its prose cache; measured 8.5 s when the model call was skipped entirely.
The report has a 5-minute freshness expectation elsewhere (`lib/portfolio/context.ts` notes the deleted route-level cache). There is no shared per-process memo, so the same holdings are re-fetched and the same engines re-scored three times concurrently.

### PF-03 (high): the brief "stream" is buffered, not streamed
`app/api/home/brief/route.ts:44-49` awaits the FULL `generateHomeBrief()` before enqueueing the first chunk. The NDJSON framing is cosmetic; the client gets headline, summary, note and done in one burst after up to 23 s. TTFT for the AI panel equals total generation time. (Cross-ref LQ audit.)

### PF-04 (high): no digest-level cache or conditional revalidation
The digest payload (80 KB) has no ETag, no Cache-Control, no fingerprint short-circuit, despite the build already computing a content fingerprint for the changes feed (`lib/home/digest.ts:360-388`). A refocus refresh re-pays the full 9 s.

### PF-05 (medium): market tape rides the digest, so its declared 60 s liveness costs a full engine rebuild
`registry.ts:164-166` declares a 60 s interval refresh for market-intelligence, but the only endpoint carrying tape data is the whole digest. Either the poll is unwired (code-health audit CH-18 confirms no runtime consumer) or it would re-run every engine each minute. Both are wrong. Quotes have a 15 s TTL in the platform registry and could be served from a light endpoint.

### PF-06 (medium): equityCurve step fetches 90 days of history per holding on every digest build
`lib/home/equity-curve.ts` (invoked digest.ts:178) walks every holding's history. It rides the platform `history` dataset cache when warm, but on a cold cache this serializes ~N provider calls inside the page's gate. The curve changes at most once per trading day; it is rebuilt per request.

### PF-07 (medium): `/api/home` payload carries dead weight
~30 KB of the 80 KB payload is slices no module renders (timeline, intelligence, threats detail, attribution, calibration; see CH-14/15 and PR-06). Serialization, transfer, and parse are paid on every load, including the 60 s polls the registry intends.

### PF-08 (low): four auxiliary fetches fire before hydration completes but the digest fetch waits for full hydration
The digest request leaves the browser ~11 s after navigation on cold dev loads (waterfall), because the fetch is issued from a client effect after the JS bundle compiles/loads. A server component or early inline fetch kickoff (link rel=preload or route handler priming) would overlap the engine build with hydration. In prod the gap is smaller but still serial: bundle -> hydrate -> fetch -> 9 s build.

### PF-09 (low): re-render behaviour is acceptable
`useDataset` dedupes cross-module subscriptions via `useSyncExternalStore`; the provider memo is broken (fresh object per render, CH-06) but render counts are small (one tree). Count-up animations (`use-count-up.ts`) tick ~20 frames per stat on every digest refresh; minor but gratuitous work (cross-ref DU audit on the animation itself).

## Targets (to hit in Wave 5)

| Metric | Baseline | Target |
|---|---|---|
| Warm time-to-meaning (modules painted) | ~9 s | < 1.5 s (served from last digest snapshot, revalidate in background) |
| `/api/home` warm server time | 8 to 9 s | < 300 ms cache hit; background rebuild <= 9 s unchanged |
| Brief TTFT (cached prose) | 8.5 s | < 500 ms (stop rebuilding engines to serve cached prose) |
| Redundant report builds per load | 3 | 1 |
| Digest payload | 80 KB | < 50 KB (drop dead slices) |

Mechanisms available without new dependencies: SQLite-backed digest snapshot (the fingerprint store already exists), stale-while-revalidate semantics in the route + `useDataset` refresh, a shared 5-minute report memo keyed on portfolio fingerprint (restoring what `lib/portfolio/context.ts` documents), and reusing the digest's `ctx`/`report` for the brief route via a short-lived cross-request memo.

## Post-implementation numbers

To be filled in Phase 6. (Verification section will compare this table.)
