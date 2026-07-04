# PROGRESS.md — Principal Engineer Session (2026-07-04)

Session goal: raise repo-wide engineering quality toward institutional-grade
(correctness → dedup → performance → API consistency → AI quality → error
handling → tests → cross-feature integration), preserving local-first AI.

## Baseline (commit 0b6b443)
- `npx tsc --noEmit` — clean
- `npm run lint` — 0 errors, 49 warnings (mostly unused vars)
- `npm run test` — 302/302 passing (33 files)
- Dev server running on :3000, Ollama on :11434 (mistral:latest)
- Prior-session working tree (76 files, +8284/−3059) committed as checkpoint
  so this session's diffs are separable.

## Verification commands (confirmed from package.json)
- Typecheck: `npx tsc --noEmit`
- Lint: `npm run lint` (eslint)
- Test: `npm run test` (vitest run)
- Build: `npm run build`

## System map (from ARCHITECTURE.md + PROJECT_ROADMAP.md, verified against lib/)
- Scoring: `lib/composite.ts` (single source of truth) — tests/composite.test.ts
- Screening: `lib/fundamental-screener.ts` + `lib/dataset.ts` (24h SQLite cache)
- Signals: `lib/event-screener.ts`; Scanner pipeline in `lib/scanner/*`
  (causal-engine, thesis-builder, signals, sector-impact, index: assessMarketRegime)
- Sector Rotation: `lib/sector-rotation.ts` (canonical SECTOR_ETFS; snapshots in
  `sector_rotation_snapshot`)
- Movement Explainer: `lib/movement-explainer.ts` (15-min scanner_cache TTL)
- Opportunity Engine: `lib/opportunity-engine.ts` (profiles consumed by
  Opportunity Map; scanner cache key `v2::true:true`)
- Portfolio: `lib/portfolio-analytics.ts` (client+server dual-use — must never
  transitively import lib/db.ts), `lib/ai-portfolio-manager.ts`
- Watchlist Intelligence: `lib/ai-watchlist.ts computeWatchlistAlerts`
- Timeline: `lib/timeline.ts` (`timeline_event` table)
- Knowledge Graph: `lib/knowledge-graph/*` (build/traverse/recommend; on-demand)
- Opportunity Map: `lib/opportunity-map.ts` (thin reshaping of Scanner profiles)
- Intelligence hub: `app/intelligence` (merged Graph/Map/Timeline per July 2026
  merge; legacy routes exist — verify they are redirects, not duplicates)
- IC: `lib/ic-agents.ts` (9 domains) + ic-questions/signals/thesis/valuation
- DCF: `lib/fundamentals.ts`; Quant: `engine/daily_run.py` → parquet (read-only)
- AI: `lib/ollama.ts` only (OLLAMA_HOST/OLLAMA_MODEL env); prompt builders in
  lib/ai*.ts; "AI explains, engines decide"
- State: `lib/db.ts` only (node:sqlite)

## Plan (ordered)
1. ✅ Baseline verification + checkpoint commit
2. ✅ System map
3. ⏳ Audit: correctness/security, duplication, perf, test gaps, integration
4. Implement backlog items highest-leverage first, verify each, commit each

## Audit findings / backlog

### P0 — correctness / policy / duplication
1. **AI provider layer violates local-only policy + is fragmented.**
   `lib/ai.ts` ("unified provider layer") contains code paths to Ollama Cloud
   (`https://ollama.com/api`, `OLLAMA_API_KEY`) and the Anthropic API
   (`ANTHROPIC_API_KEY`) — both paid external providers. This contradicts:
   AGENTS.md ("lib/ollama.ts — Never external APIs"), lib/ai/ollama.ts's own
   contract ("no code path to any hosted/paid provider"), and the user's
   standing constraint (memory: UAA AI must be 100% local Ollama).
   Additionally there are FOUR separate Ollama HTTP clients:
   lib/ai/ollama.ts (canonical, retry+typed errors+streaming),
   lib/ollama.ts (raw fetch /api/generate), lib/ai.ts (raw fetch),
   app/api/screener/nl/route.ts + app/api/calendar/ai-brief/route.ts (raw fetch).
   Default model duplicated 5× ("llama3.2" ×4, "mistral" ×1).
   **Fix**: add non-streaming `generate()` + `DEFAULT_MODEL` to lib/ai/ollama.ts;
   make lib/ai.ts a thin local-only façade (runPrompt/analyzeAsset signatures
   unchanged — 23 call sites untouched); refactor both rogue routes onto it;
   drop unused `@anthropic-ai/sdk` dependency (zero imports found).

2. **Hand-rolled LLM JSON extraction duplicated 5×** while lib/json-extract.ts
   exists for exactly this: app/api/screener/nl (local extractJson),
   app/api/ai/portfolio-brief, app/api/ai/verdict, lib/thematic-engine.ts:593,
   lib/ic-agents.ts extractAgentJson strategies 1–2 (strategy 3 prose-fallback
   is domain-specific, keep). **Fix**: route all through lib/json-extract.ts.
   lib/json-extract.ts has NO test file — add tests/json-extract.test.ts.

### P1 — needs user decision (engine replacement — out of autonomous scope)
3. **Two scoring engines**: lib/composite.ts (screener/opportunity/sector-rotation)
   vs lib/scoring.ts (fundamentals/compare/report/portfolio/watchlist/ai-context,
   rich multi-factor ScoreResult). ARCHITECTURE.md calls composite.ts the
   "single source of truth for scoring" — stale claim. Consolidating means
   replacing an engine → requires user sign-off per session rules. Documented,
   not acted on.

### P2 — smaller
4. 49 lint warnings (unused vars) — mechanical cleanup, do near session end.
5. ARCHITECTURE.md AI section stale after item 1 (analyzeWithOllama flow).
6. app/api/calendar/ai-brief accepts unbounded `events` array from client —
   harmless locally (single-user), but cap for hygiene while refactoring.

## Decisions log
- 2026-07-04: Committed prior-session uncommitted tree as checkpoint 0b6b443
  (all checks green) so session diffs are reviewable. Reversible via git.

## Completed this session

### 1. AI layer consolidated to a single local-only client (P0 items 1+2+6)
- `lib/ai/ollama.ts` gained `generate()` (non-streaming /api/chat with retry,
  typed errors, system/temperature/timeout opts) + `DEFAULT_MODEL` — now truly
  "the only module that talks HTTP to Ollama".
- `lib/ai.ts` rewritten as a thin local-only façade. **Removed the Ollama
  Cloud and Anthropic API code paths** (violated AGENTS.md "never external
  APIs", lib/ai/ollama.ts's own contract, and the user's standing local-only
  constraint). Public signatures unchanged → all 23 call sites untouched.
- `lib/ollama.ts` reduced to the pure prompt builder (raw fetch removed).
- `app/api/screener/nl` + `app/api/calendar/ai-brief` refactored off raw
  fetch onto the shared client; nl route now uses `listInstalledModels()`
  and shared `extractJson`; ai-brief caps client-supplied events at 200.
- Dropped unused `@anthropic-ai/sdk` dependency.
- JSON extraction deduplicated: portfolio-brief route, verdict route,
  thematic-engine, and ic-agents (strategies 1–2) now use `lib/json-extract.ts`.
- **Real bug found & fixed** by new tests: `extractJson` returned the inner
  *object* for single-element arrays (`[{…}]`) because the object span won
  unconditionally — thematic-engine's tier mappings expect an array. Now the
  enclosing container wins; a stray `[1]` in prose still yields the object.
- New `tests/json-extract.test.ts` (9 tests).
- Verified: tsc clean, lint 0 errors, 311/311 tests, live POSTs to both
  refactored endpoints returned correct output (criteria JSON + weekly brief).

### 2. Unified symbol validation across all API routes (security + dedup)
- New `normalizeSymbol()`/`isValidSymbol()` in lib/market.ts (client-safe,
  zero-dep). Charset `[A-Z0-9.\-&^=]{1,15}` covers BRK.B, RELIANCE.NS, M&M,
  BTC-USD, ^GSPC, GC=F while excluding "/", whitespace, quotes — symbols are
  interpolated into external URLs, cache keys, and (engine/detail) a generated
  Python script, so the charset gate doubles as injection protection.
- **Security fix**: /api/engine/detail interpolated an unvalidated symbol into
  a Python script executed server-side — a crafted URL (reachable via CSRF
  against localhost) was a script-injection vector. Now 400s (live-verified).
- 12 previously-unvalidated routes now validate: fundamentals, quote,
  screener-in, compare-history, notes (GET+POST), compare, dcf, report, peers,
  engine/detail, research/context, ai/verdict.
- 10 routes that each had their own copy of SYMBOL_RE now import the shared
  validator (research, research/chat, knowledge-graph, movement, portfolio,
  timeline ×3, watchlist ×2). Old strict regex also rejected legitimate
  tickers like M&M / ^GSPC; unified charset fixes that.
- Verified: tsc clean, lint 0 errors, 311/311 tests, live: valid AAPL quote
  200, path-traversal symbols filtered, engine/detail injection attempt 400.
