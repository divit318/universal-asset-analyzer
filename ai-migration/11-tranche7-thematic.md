# Tranche 7 — Thematic Engine (9 stage calls)

Date: 2026-08-05. Verified: tsc silent, 2,697 tests pass (48 thematic tests
reseated to the seam mock, unchanged assertions), eslint clean, `next build`
green, live run through `/api/thematic` under `AI_PROVIDER=devin`.

## What migrated

All nine `runPrompt` calls in `lib/thematic-engine.ts` (future state,
dependency chain + its terse retry, bottleneck, supply/demand, commodity
framework, policy, structural advantage, tier mapping) now run through one
`runStage` helper on the analysis seam, with per-stage wire schemas in
`lib/ai/schemas/thematic.ts`.

Structural notes:

- **Array-answering stages.** The sessions API's `structured_output` must be
  an object, but two stage prompts ask for bare JSON arrays. Their wire
  schemas wrap the array ({nodes}/{mappings}); the token stack keeps
  answering bare arrays; a `listFrom` unifier accepts both. The seam's parse
  view for this engine is the new `LooseJsonSchema` (object | array).
- **`coerceParsedObject`** extracted from `extractJsonObject`
  (lib/json-extract.ts) so the defaults-coercion half serves parsed values
  directly — one implementation, string and seam entry points.
- **`assertParseable` deleted, contract preserved by construction:** garbage
  now throws inside the provider (adapter's extractJson locally; schema
  validation on sessions), so `withFallback` still separates "AI failed"
  (tracked stage failure) from "valid JSON missing fields" (stage defaults).
- **One accepted trade, documented at the site:** the tier-mapping stage's
  string-level truncation salvage (`extractJsonObjectsLoose`) needed raw
  text the seam doesn't expose. On sessions, truncation is impossible (wire
  validation); on the local path a truncated response is now a tracked stage
  failure instead of a salvaged partial. The salvage only ever mattered for
  the small-local-model tail, which is now the fallback configuration.
- The "string null" lesson lives on: `estimatedCapitalUSD` is nullable on the
  wire AND still passes through `coerceOptionalText`, which catches models
  spelling absence as the string "null".
- `devinTimeoutMs: 300_000` for `thematic-analysis`.

## Gate: live run, "grid-scale energy storage", refresh=true

273s end-to-end, POST 200, all scoring stages real and sensible:

| Stage | Result |
|---|---|
| Future state | 9/10 inevitability |
| Dependency chain | 6/6 tiers mapped |
| Bottleneck | 8/10 at Tier 4 (raw materials — correct for storage chemistry) |
| Supply/demand | growing / balanced / mid-cycle, scored vs 4 live proxies |
| Commodity | 6/10 |
| Policy | 7/10 against 15 live theme headlines |
| Structural advantage | 8/10, leader China (correct for batteries) |
| Company mapping | started against 140 screener candidates (see incident) |

### Incident, recorded honestly: one orphaned session

The run surfaced a real edge in the lifecycle discipline. Sequence: the route
answered 200 at ~270s; the request signal then aborted an in-flight
tier-mapping call (`category: "cancelled"` logged 16s after the response);
the provider's finally-terminate raced the handler-context teardown and the
DELETE never landed — leaving one session in `blocked` (waiting-for-user,
which consumes ~nothing per the billing docs).

This is exactly the "killed between create and finally" class the org sweeper
exists for (05 amendment 1), and it would have been reaped at the >20-min
threshold; I terminated it manually first (DELETE → 200 "terminated
successfully", confirming v1 DELETE works fine on blocked sessions).

**Follow-up candidates, not smuggled in here:** (a) sweep `blocked`
uaa-sessions on a shorter threshold than 20 min — a blocked disposable
session can never become useful; (b) revisit the interplay between the
thematic route's `maxDuration = 300` and per-stage session budgets, since the
largest stage (mapping, biggest prompt in the app at ~5-9KB + 140 candidates)
ran 51s + a 45s corrective turn.

## Remaining in the agreed order

scanner (**gated on the Settings > Plans reading**) → streaming redesigns.
