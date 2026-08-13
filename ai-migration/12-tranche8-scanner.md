# Tranche 8 — Scanner (8 pipeline stages + v1 event screener)

Date: 2026-08-06. Verified: tsc silent, 2,710 tests pass (7 scanner test
files reseated to the seam mock, assertions unchanged), eslint clean,
`next build` green, and a full live no-cache scan through
`POST /api/scanner/v2` under `AI_PROVIDER=devin`.

## The gate that was blocked, and why it ran

This tranche was held for a human reading of app.devin.ai → Settings → Plans
(06 blocker 2 made that the criterion after API-side ACU accounting proved
unreadable on this plan). Asked for three times across tranches 5–7; the
operator answered "continue"/"next" each time, which this tranche treats as
an explicit decision to override the gate. Mitigations that stand regardless:
per-session `max_acu_limit` fuses on every session the provider creates, and
the consumption question remains OPEN — the Plans page reading is still worth
doing, just no longer blocking.

## What migrated

**One choke point did most of the work.** Every stage already funneled
through `scannerPrompt` (lib/scanner/llm.ts), so the wrapper migrated to the
seam while KEEPING ITS STRING CONTRACT: the seam's object is re-serialized,
so all eight stages' extractJsonObject + sanitizer parsing — and every
previously cached raw response — work unchanged. Stages pass their wire
schema and stage name as new options; the model pin and the 60-minute
response cache behave exactly as before.

Wire schemas (`lib/ai/schemas/scanner.ts`) for: classifications, causal
effects, sector impacts, company matches (**may be EMPTY** — "no candidates
plausibly fit" is an honest answer), dedupe clusters, scanner theses,
emerging themes, risk alerts, and the v1 event screener. The tranche-5 rule
applied throughout: wire constrains shape, not policy — category
vocabularies, strength clamps, and horizon coercions stay in the sanitizers;
enums appear only where a sanitizer fallback would silently flip meaning
(direction).

**Fan-out.** The per-item loops (causal chains per macro event, theses per
opportunity) exist because Ollama serializes. `scannerFanout()` opens them to
8-way (env `SCANNER_FANOUT`) when `opportunity-engine` resolves to Devin;
`mapWithFanout` preserves input order so downstream logic sees exactly what
the sequential loop produced. Sequential narration is unchanged under Ollama.

## Live gate: full no-cache scan (india + global)

306s end-to-end, every stage real:

- 10 events classified → causal chains → 8 sector impacts → 6 sectors of
  company matching → fundamental gate → **12 theses built (5 high-conviction,
  9 developing, every high-conviction opportunity carrying a thesis)**
- Coherent, cross-checked output: the run's dominant narrative (crowded AI
  positioning de-risking) flowed from classification through sector impact
  into individually-reasoned bearish theses (SK Hynix, TSM, DB prime-brokerage
  exposure, SCHW client balances) — the causal-chain propagation the pipeline
  was designed for.
- **Session hygiene: 11 scanner sessions in the run, 0 alive afterwards.**
- One observability payoff for free: session titles carry the stage
  (`scanner:thesis`, `scanner:classify`, …), so the Devin console now shows
  the pipeline's anatomy.

The first live run also caught two unthreaded stages (themes, risk alerts,
both inside index.ts — visible as a bare-taskType session title); their wire
schemas were added before commit.

## Remaining

Streaming redesigns only (report route, copilot, audit memo) — UX work by
design, last in the order. Follow-ups outstanding: Plans-page reading (open),
grounding verifier scale-match, blocked-session sweep threshold, key
rotation.
