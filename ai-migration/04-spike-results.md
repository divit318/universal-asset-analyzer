# Phase 4 — Spike Results: Devin v3 sessions running a real UAA analysis

Date: 2026-08-02. Script: `scripts/devin-spike.ts`. Task: **movement
explainer** for AAPL (migration step 1 in `03-architecture.md`) — evidence
gathered by the app's own deterministic code (`lib/yahoo`, `lib/news`,
`windowReturn`/`volumeAnomaly` from `lib/movement-explainer`), narrative
synthesis by a Devin session with `structured_output_schema` (Zod v4 →
JSON Schema Draft 7, 1,220 bytes), `structured_output_required: true`,
`devin_mode: "fast"`, `resumable: false`, `max_acu_limit: 4`,
`knowledge_ids: []`, no repos. Dossier: 1,514 chars of live Yahoo data.
Raw records: `bench-out/devin-spike/*.json` (untracked, like all bench-out).

## Numbers (9/9 sessions succeeded; no retries, no corrective turns)

| Batch | Runs | Outcome | Time-to-valid-output | First-attempt schema-valid |
|---|---|---|---|---|
| Smoke | 1 | ok | 18.2s | 1/1 |
| Sequential (variance) | 5 | ok ×5 | **21.6 / 21.6 / 21.7 / 22.3 / 35.6s** (p50 21.7s) | **5/5** |
| Concurrent ×3 (fan-out check) | 3 | ok ×3 | 22.0 / 22.1 / 35.5s | 3/3 |

Notes on the numbers:

- **Session creation is ~0.6–1.2s**; the session transitions to
  `running/working` within ~4–5s and delivers validated structured output at
  the next poll (~18s). Reported totals include poll granularity
  (3s/5s/8s backoff) and ~3–4s of post-success cleanup (terminate + ACU
  re-read), so true time-to-output is **~15–30s**, p50 ≈ 18s.
- **Variance is tight**: 7 of 9 runs landed 18–22s; two outliers at ~35s
  (one extra poll cycle — the model took one more turn of work).
- **Concurrency shows no queueing penalty**: 3 parallel sessions ≈ the
  sequential p50. This validates the IC fan-out design (pattern P3).
- **ACU consumed**: every session reported `acus_consumed: 0.0`, and the org
  daily consumption endpoint reported `{"total_acus": 0.0}` immediately after
  the runs. Either accounting lags by more than the measurement window or
  these micro-sessions round below display precision. Honest statement:
  **cost per analysis measured ≤0.05 ACU-scale, not yet precisely known** —
  re-check `GET /consumption/daily` tomorrow. Bounded regardless by
  `max_acu_limit: 4`.
- **Schema validation: 9/9 valid on first attempt** — platform-side JSON
  Schema enforcement plus our Zod parse (which also enforces semantic guards:
  min lengths, enum membership, 0–100 range, 1–4 drivers). The corrective-turn
  path never fired.

## Output quality (see structured results in bench-out records)

Grounded and disciplined: every driver's `evidence` field quotes an actual
headline/fact from the dossier; the summary explicitly flags that the
evidence is headline-only and caps confidence at 62 accordingly — precisely
the behavior UAA's house rules demand and that 7B local models routinely
violated. Run-to-run outputs are semantically consistent (same 4 drivers,
same confidence, same persistence across all 9 runs; wording varies).

## API contract facts confirmed empirically

1. `structured_output` appears on `GET session` while the session is still
   `running/waiting_for_user` — sessions deliver the output then wait for
   further messages. The provider must treat `structured_output present +
   Zod-valid` as success rather than waiting for `exit`, then terminate the
   disposable session itself (`DELETE /sessions/{id}` → HTTP 200).
2. `status_detail` never showed `finished` in these runs; the observed
   sequence was `running/working → running/waiting_for_user` (with output).
   The architecture's success condition (§3.4) is updated by this finding.
3. No 429s at 3-way concurrency; creation latency stable (~1s).

## Comparison vs. Ollama baseline (same class of task)

| Metric | Ollama today (measured, Phase 1) | Devin (this spike) |
|---|---|---|
| Movement/verdict-class one-shot | ~103s (verdict, warm qwen3:14b); minutes cold | **~18–22s p50** |
| First-attempt schema validity | fragile (defaults-coercion exists for a reason; silent `{}` incident) | 9/9, platform-validated |
| Concurrency | serialized by Ollama; duplicates coalesced to protect queue | 3-way parallel, no penalty |
| Cost | $0 | ~0 measured (lag caveat above), ceiling 4 ACU/session |

The spike **beats the warm local model on latency** for this task class —
which was not assumed by the architecture (it budgeted minutes). The async
job model remains correct for the deep tier (IC agents will run longer than
22s), but the pending→ready UX may be needed less often than designed.

## Verdict

Green. Proceed to Phase 5 with the approved migration order. Two design
adjustments carried forward:

1. Success condition = `structured_output` present + Zod-valid (do not wait
   for `exit`/`finished`); terminate disposable sessions after harvest.
2. Keep per-task `devinTimeoutMs` defaults, but interactive-adjacent tasks
   (movement, insight, calendar) can plausibly serve *inline* at ~20s —
   revisit the guardrail per-task once real per-task numbers accumulate.
