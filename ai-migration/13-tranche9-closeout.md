# Tranche 9 — Close-out: streaming redesign + filed follow-ups

Date: 2026-08-06. Verified: tsc silent, 2,713 tests pass, eslint clean,
`next build` green, live report stream under `AI_PROVIDER=devin`.

This tranche closes the migration plan. Everything in the agreed order is
done; what remains open requires a human and is listed at the end.

## 1. Streaming redesign: `/api/ai/report`

When the verdict task resolves to Devin, the route no longer parses a token
stream — there isn't one; a session delivers one schema-validated object. It
now runs the SAME `generateVerdict` the blocking route uses (same plan, same
assembler, content-keyed idempotency, warmer synergy) and replays the
finished report **section-by-section in the identical wire protocol**
(manifest → sections → done). The client cannot tell the transports apart.

Live: ADBE refresh=1 → manifest instantly, all 8 sections + done in **21s**,
`model: devin`, grounding high. Warmed/tracked symbols replay from cache in
~0s; the local path keeps its progressive token rendering untouched.

The deal is stated in the code comment: trading mid-generation token paint
for schema-validated, warmable, cache-shared sessions is deliberate. With
the warmer covering watchlist+portfolio, the common case is now *faster*
than the old stream's time-to-first-section (0s vs ~4s), and the cold case
is one 20–40s wait behind a per-section skeleton the manifest paints.

## 2. Streamed surfaces that deliberately STAY on the token stack

| Surface | Why it stays |
|---|---|
| Research copilot | `latency:"interactive"` — the guardrail's whole point. Runs hosted via the Devin CLI transport (3–8s, token-streamed). |
| Audit memo (`portfolio-audit`) | Long-form PROSE whose UX is progressive text; the CLI transport already streams it hosted. A session would add polling latency and remove the paint, for zero schema benefit (no structure to validate). |
| Compare stream (`/api/compare/stream`) | Same trade as the audit memo; the blocking compare path (tranche 5) is the session-backed, schema-validated twin. |

"All AI through Devin" holds either way — the token stack's first provider IS
Devin's CLI transport; Ollama remains the offline fallback only.

## 3. Follow-ups closed in this tranche

- **Grounding verifier unit-scale forgiveness** (`lib/ai/grounding.ts`):
  non-percent figures now match across 1e3/1e6/1e9 scales, so "$391B" is
  grounded by a millions-denominated table row. This was the cause of 5/9 IC
  agents being confidence-downgraded on correctly-reformatted figures (10
  §observed). Percents never scale. Test-pinned in
  `tests/ai-grounding.test.ts` including the still-flags-fabrication case.
- **Sweeper: blocked sessions reap at 5 min** instead of 20 — a disposable
  analyst session that asked a question can never become useful (the
  tranche-7 orphan class). The threshold clears the provider's corrective-
  turn window so no live session is reaped mid-correction.
- **Real bug found while doing it:** v1 list timestamps are ISO strings and
  the client dropped them, so on an `apk_` key every session read as age
  zero — the sweeper could never fire at all on this machine. Timestamps now
  parse at the translation edge. (The tranche-7 incident write-up said "the
  sweeper would have caught it"; on this key, it would NOT have. Corrected.)

## 4. Open items — all require a human

1. **Settings → Plans reading** (operator): ~200 sessions run; API-side ACU
   reads 0.0; the dashboard is the only ground truth. Override was recorded
   in 12; the question itself is still open.
2. **Key rotation** (operator): the `apk_user_` key was pasted into chat
   during Phase 4 and should be rotated in app.devin.ai → Settings.
3. **Coordination with the parallel line** (both operators): two machines
   commit to this repo; the tranche docs interleave cleanly but that is
   convention, not a lock.

## Migration ledger (final)

| Tranche | Surface | Gate |
|---|---|---|
| 1–2 | seam, movement, insight, calendar, watchlist | parity 15+8 symbols |
| 3 | verdict + warming; dual-key client | parity 6/6 direction agreement |
| 4 | portfolio thesis, home brief | parity 2/2 + 4/4 |
| 5 | compare ×2, simulator | identical ranking AND confidence |
| 6 | IC pipeline (4 calls, 9-way parallel) | live: 9 agents in 27s window |
| 7 | thematic (9 stages) | live: full framework, 273s |
| 8 | scanner (9 stages, 8-way fan-out) + v1 screener | live: full scan, 306s, 12 theses |
| 9 | report stream redesign; grounding + sweeper follow-ups | live: 8 sections in 21s |
