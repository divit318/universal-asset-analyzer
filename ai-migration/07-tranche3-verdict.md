# Tranche 3 — Verdict + Cache Warming (+ dual-key client)

Date: 2026-08-05. Verified: tsc silent, 2,674 tests pass, eslint clean,
`next build` green (see commit). Global `AI_PROVIDER` unchanged.

## What migrated

**`generateVerdict`** (`lib/ai/verdict.ts`) — the blocking verdict behind
`/api/ai/verdict` and every exporter — now runs through the analysis seam:

- `lib/ai/schemas/verdict.ts` v2: `VerdictWireSchema` (strict, Draft-7-able,
  mirrors the SCHEMA_BLOCK prompt contract — headline first, verdict last,
  preserving the documented streaming order) + `VerdictParseSchema`, a
  deliberate PASS-THROUGH bag. Verdict defaulting is plan-dependent
  (`coerceFields` fills gaps from `defaultFields(plan)`), so the schema does
  not duplicate it — one defaulting implementation, two transports. The
  Phase 4 spike's v1 BUY/HOLD/SELL schema moved into
  `scripts/devin-spike-v1compat.ts`; SCHEMA_VERSION bumped to 2 so v1-keyed
  cache rows cannot satisfy v2 readers.
- Failure semantics preserved asymmetrically ON PURPOSE: token-stack
  unparseable output still assembles plan defaults (pre-migration behavior);
  a Devin session failure produces the offline fallback, which `cacheVerdict`
  refuses to persist.
- The streamed twin (`/api/ai/report`) is untouched — streaming redesigns are
  the last item in the agreed order.

**Cache warming** (`lib/ai/verdict-warmer.ts`, started from
`instrumentation.ts`): sweeps watchlist ∪ portfolio every
`UAA_VERDICT_WARM_INTERVAL_MS` (default 6h = the aiVerdict fresh window,
0 disables, floor 15 min), read-through `getVerdict` so warmed rows are
EXACTLY what the route serves. Two restraints: warms only when the task
resolves to Devin (a background warm through the serializing local daemon
would starve interactive users), and warms only the un-personalized variant.

**Dual-key client** (`lib/ai/providers/devin/client.ts`): routes by credential
prefix (`cog_` → v3, `apk_` → legacy v1) and translates v1's status vocabulary
at the edge (`blocked` → waiting_for_user, `expired` → exit), so the
provider's hardened lifecycle exists once. v1 drops
`structured_output_required`/`devin_mode`/`resumable`, has a singular
`/message` endpoint, offset pagination, and no ACU field. Verified live
end-to-end on this machine's `apk_` key (parity AAPL movement, 23.9s, session
dead afterwards).

## Parity gate (6 symbols incl. degenerates; record in bench-out/parity/)

| Symbol | Devin (sessions API, v1 key) | Token stack | Direction agree |
|---|---|---|---|
| AAPL | neutral / conf medium / 29.4s | neutral / conf high / 27.8s | ✔ |
| NVDA | bullish / high / 45.6s | bullish / high / 14.0s | ✔ |
| PG | neutral / high / 26.7s | neutral / high / 12.4s | ✔ |
| KOSS (microcap) | bearish / medium / 26.6s | bearish / medium / 14.2s | ✔ |
| GLD (fund plan) | neutral / medium / 25.6s | neutral / medium / 9.4s | ✔ (horizon differs: medium vs long) |
| RELIANCE.NS (non-US) | neutral / medium / 25.9s | neutral / medium / 14.0s | ✔ |

**12/12 schema-valid; 6/6 verdict-direction agreement; 0 wire-incompleteness
flags; 0 ungrounded-number flags on either side.** Confidence is an ENUM in
this schema, so the numeric-confidence distribution shift (blocker 1) does not
apply to this surface; the only enum divergence was AAPL medium-vs-high.

**Read the comparison column honestly:** under this tree's default provider
chain the "ollama" adapter's router resolved to the **Devin CLI transport**
(`claude-opus-5-medium` / `claude-sonnet-5-low` — visible in the parity log),
not the local daemon. So this gate demonstrates sessions-API ≈ CLI-transport
equivalence, and the pre-hosted-era Ollama behavior is exercised by the
unchanged unit tests rather than by this run. On a machine pinned
`AI_PROVIDER_ORDER=ollama` the same harness measures true local parity.

Tail note: NVDA's 45.6s is another ~2× p50 tail observation (amendment 3
holds); verdict tasks stay on the 8-min standard floor.

## Also in this tranche

- Removed `scripts/devin-spike-sessions.ts` — byte-identical merge duplicate
  of the pre-fix spike, superseded by `devin-spike-v1compat.ts`.
- Fixed the merge-introduced generic-mock tsc error in
  `tests/ai-analysis-facade.test.ts`.
- Blocker 1 disposition (per the recommendation in 06, adopting option (b)):
  thresholds untouched; the verdict surface consumes enums and needed no
  retune at its gate.
- Screener migration remains blocked on the Settings > Plans reading
  (blocker 2) — unchanged.

## Next in the agreed order

portfolio thesis → home brief → compare → simulator → scanner (fan-out ≤40
validated) → IC report → thematic → streaming redesigns.
