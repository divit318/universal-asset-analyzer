# Tranche 6 — IC Report (9 agents + synthesis + thesis + valuation proposal)

Date: 2026-08-05. Verified: tsc silent, 2,697 tests pass, eslint clean,
`next build` green, and a full live report through the route under
`AI_PROVIDER=devin`.

## What migrated

All four model calls in the IC pipeline now run through the analysis seam,
with wire schemas in `lib/ai/schemas/ic.ts`:

| Call | Task(s) | Wire schema notes |
|---|---|---|
| `lib/ic-agents.ts` runAgent (×9 domains) | ic-agent-analysis / accounting-red-flags / scenario-analysis / risk-review | `dataLimitations` nullable — "null or a sentence" is the prompt's contract |
| `lib/ic-synthesis.ts` | investment-thesis | `disagreements` may be EMPTY — a min-items would order the model to fabricate conflict |
| `lib/ic-thesis.ts` | investment-thesis | keyCatalysts/keyRisks/keyDrivers 3–5 |
| `lib/ic/valuation-inputs.ts` | scenario-analysis | every number nullable: null = "use the deterministic default"; the validation boundary clamps to bands regardless |

Supporting changes:

- **`AnalysisRequest.model`** — the IC report's model picker override now
  flows through the seam; the token-stack adapter honors it exactly as
  `runPrompt` did, and the Devin provider ignores it (a session has no model
  knob; pretending otherwise would be a lie the picker UI repeats).
- **Provider-aware fan-out** — `runAgentNetwork`'s sequential dispatch exists
  because Ollama serializes generations. When the agent tasks resolve to
  Devin, the default becomes all-9-at-once (fan-out ≤40 validated in 05).
- String-parsing halves split into bag-shaped workers shared by both entry
  points (`normalizeAgentBag`, `parseThesisBag`), same pattern as
  `parseSelectionBag`; `extractAgentJson`/`parseThesis` remain for the string
  path and delegate.
- `devinTimeoutMs: 300_000` declared for the five deep IC tasks.
- Tests: `ic-agents.test.ts` and `ic-synthesis.test.ts` reseated to the
  runAnalysis mock (same recording surface); all pass unchanged.

## Gate: full live report, AAPL, through `/api/ic-report`

167s end-to-end; every stage completed; `done` emitted. The stage that
justified this migration:

- **All 9 agents completed inside a 27-second window** (22:01:17 →
  22:01:45) — genuinely parallel sessions. Under the serializing local
  daemon this stage alone ran 9 × 20–60s sequentially.
- 9/9 findings schema-valid; every agent produced exactly 5 insights;
  grounding levels high/medium across the board; synthesis found **5 real
  disagreements** (e.g. positions across agents on the same underlying
  question); thesis formed; valuation proposal within bands.
- **Session hygiene: 0 of 15 recent sessions alive** after the run — the
  finally-terminate + sweeper discipline held across a 12-session pipeline.

### Observed behavior worth recording (not a defect, but visible)

The report surface showed every agent at `confidence: low`, while the stored
session outputs are a mix of medium/low. Two stacked causes, both
pre-existing policy applying as designed:

1. The models honestly return medium/low because each agent's **data slice is
   deliberately narrow** — their own `dataLimitations` name exactly what's
   missing ("no capex, M&A, buyback data…"). This is the calibration behavior
   the parity work documented (06 blocker 1): honest models under thin
   evidence say so.
2. The **citation-enforcement downgrade** (`grounding.unsupportedNumbers > 0
   → downgrade one step`) fired on 5/9 agents, turning medium into low. Spot
   checks suggest some flags are unit-reformatting artifacts ("$4.54T" vs the
   dossier's raw number) — the parity harness gained scaled-match tolerance
   for exactly this (06 "harness upgrades"), but `lib/ai/grounding.ts`'s
   production checker has NOT. Flagged as a candidate follow-up: port the
   scaled-match tolerance to the production verifier. Not done in this
   tranche — it changes behavior for both providers and deserves its own
   test-pinned change.

## Remaining

scanner (**still gated on the Settings > Plans reading**) → streaming
redesigns. Everything else in the agreed order is migrated.
