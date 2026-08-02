# Phase 5 — Implementation Results & Amendment Compliance

Date: 2026-08-02. Commit: `cd9a2dd` (platform + first migrated call site).
Verification: `tsc` clean, **2,594 tests pass** (20 new), `eslint` clean,
`next build` green. AI_PROVIDER defaults to `ollama` — nothing changes for
the app until the flag (or a per-task pin) is flipped.

---

## Amendment 1 — session lifecycle

**Audit of the 9 spike sessions: 0/9 alive.** Honest note: the smoke run's
session initially outlived its harvest — the first spike version only
terminated on timeout. That WAS the bug you suspected; it was caught and
fixed during the spike (terminate-on-success), and the smoke session was
terminated manually. The production provider was built with the lesson
baked in:

- `lib/ai/providers/devin/provider.ts` terminates in a **`finally` block** —
  success, Zod failure, timeout, caller abort, thrown error.
- **Sweeper** (`lib/ai/providers/devin/sweeper.ts`): lists org sessions
  tagged `uaa` still alive >20 min, terminates them; kicked (rate-limited to
  10-min intervals) after every Devin run. Covers SIGKILL between create and
  finally.
- **`waiting_for_user` without output** (Devin asks a clarifying question):
  ONE corrective message ("do not ask; state the assumption in the output"),
  then the task budget expires it and the finally terminates. It cannot poll
  forever.
- Post-implementation audit across everything ever created (84 spike + 15
  parity = **99 sessions): 0 alive.**

## Amendment 2 — concurrency ceiling

Fan-out on the identical task, all `fast` mode:

| Concurrency | Success | p50 | max | 429s / rejections |
|---|---|---|---|---|
| 10 | 10/10 | 22.2s | 35.5s | 0 |
| 25 | 25/25 | 22.1s | 48.8s | 0 |
| 40 | 40/40 | 22.1s | 35.6s | 0 |

**No ceiling found up to 40.** p50 flat at ~22s from 1-way to 40-way;
creation latency stable (~1.1s); zero rate-limit responses; no queueing
detectable. The tail (see below) appears at every concurrency level equally,
so it is per-session generation variance, not contention. **The Screener
migration is unblocked at up-to-40 fan-out** (75 sessions were created in
~4 minutes total during the test). Ceiling above 40 remains unmeasured —
re-test before any design that assumes >40.

## Amendment 3 — tail, not p50

Observed distribution over 99 sessions: p50 ~22s, **max 48.8s** (2.2x p50);
~20% of runs land in a 32–49s band. Accordingly:

- Nothing serves inline: the movement route keeps its existing async
  contract, and `enqueueAnalysis` + `/api/ai/jobs/[id]` is the pattern for
  new pending→ready UIs.
- `devinTimeoutMs` in the task registry is sized off **max**, not median:
  movement = 240s (~5× worst observed). Defaults for unmeasured tasks: 8 min
  standard / 15 min background — to be tightened per task as their own
  observed maxima accumulate.

## Amendment 4 — parity across real variety (15 symbols)

`scripts/ai-parity.ts`, both providers, same dossiers, run 2026-08-02
(record: `bench-out/parity/parity-2026-08-02T12-37-50-731Z.json`).
Degenerates behaved as designed — BGFV produced a dossier with **zero news
and zero price history**; RELIANCE.NS/7203.T/GLD got largely irrelevant
generic news; PG/PEP moves were small and ambiguous.

**Both providers: 15/15 schema-valid successes. Invented evidence: none on
either side.** The grounding checker flagged exactly one Devin driver
(7203.T): its "evidence" was *"None of the six listed headlines mention
7203.T, Toyota Motor Corporation, autos, or Japan"* — a heuristic false
positive that is in fact the discipline WORKING: Devin explicitly disclosed
the evidence gap instead of inventing a driver, and scored confidence 22.

| Symbol | news | move% | Devin conf/drv | Ollama conf/drv | persist agree | conf Δ |
|---|---|---|---|---|---|---|
| AAPL | 6 | −8.3 | 62/4 | 75/3 | yes | −13 |
| MSFT | 6 | +19.4 | 32/4 | 75/3 | yes | −43 |
| NVDA | 6 | +2.2 | 45/4 | 85/3 | yes | −40 |
| JPM | 6 | −1.2 | 32/4 | 60/3 | no | −28 |
| XOM | 6 | +0.4 | 45/4 | 60/4 | yes | −15 |
| TSLA | 6 | +0.6 | 32/4 | 65/3 | no | −33 |
| KOSS | 6 | +0.6 | 22/4 | 50/2 | yes | −28 |
| BGFV | 0 | n/a | **5**/2 | 20/2 | yes | −15 |
| NSRGY | 6 | +2.4 | 27/4 | 65/3 | no | −38 |
| RELIANCE.NS | 6 | +2.2 | 22/4 | 65/3 | no | −43 |
| 7203.T | 6 | +3.4 | 22/4 | 60/2 | no | −38 |
| CRCL | 6 | −4.7 | 55/4 | 70/3 | yes | −15 |
| PG | 6 | −2.8 | 62/4 | 75/4 | yes | −13 |
| PEP | 6 | −0.2 | 35/4 | 55/2 | yes | −20 |
| GLD | 6 | −0.8 | 25/4 | 60/2 | no | −35 |

Findings, honestly stated:

1. **The evidence-citing discipline held under thin evidence.** Devin's
   confidence tracks dossier quality tightly: 5 on the empty dossier, 22–27
   where the news is irrelevant to the subject, 55–62 where the story is
   real. It discloses thinness in the summary rather than inventing drivers.
2. **Ollama's confidence is compressed and optimistic** (50–85 almost
   regardless of evidence; 65 on NSRGY/RELIANCE where the news explains
   little; 20 vs Devin's 5 on the literally-empty BGFV dossier). This is the
   known 7B/14B calibration weakness, now measured.
3. **Consequence: a systematic confidence distribution shift** (Devin
   −13 to −43 vs Ollama on every symbol). Any UI band thresholds tuned to
   Ollama's distribution (e.g. "high conviction ≥70") will fire less often
   under Devin. This is a *calibration improvement* but a *presentation
   regression risk* — flag when migrating confidence-consuming surfaces.
4. Persistence agreement 9/15; driver-direction conflicts on overlapping
   categories in 7/15 (mostly `news`/`volume` bearish-vs-neutral). Two
   different models legitimately disagree at the margins; exact field
   equality was never the bar. **Pass criteria met: 15/15 valid on both,
   zero invented facts on both.**

Latency, same work: Devin 15 symbols **concurrently in ~22s wall**
(11.7–21.6s each); Ollama sequentially in **~8.5 min wall** (20.4–46.6s
each, serialized by the daemon).

## Amendment 5 — ACU accounting

`scripts/devin/acu-check.mjs` appends to `ai-migration/acu-log.jsonl`.
Reading at 2026-08-02T12:27:58Z, after 84 sessions (now 99):

```
org_daily_total_acus: 0.0
consumption_by_date: []
uaa_sessions_with_nonzero_acus: 0/84
```

**Plainly: ACU accounting still reads 0.0 several hours after the first
sessions.** Not assuming free — the 24h re-check is pending:
`node --env-file=.env.local scripts/devin/acu-check.mjs` tomorrow, and the
log will show the delta against the 99 known sessions. `max_acu_limit`
stays hard-capped (4 default) on every session regardless.

## What shipped (see commit cd9a2dd for the full list)

- `lib/ai/analysis-provider.ts` — seam + `resolveProvider` (guardrail tested:
  interactive tasks cannot route to Devin without an explicit pin)
- `lib/ai/providers/devin/{client,schema,provider,sweeper}.ts`
- `lib/ai/providers/ollama-analysis.ts` — adapter; token-level stack untouched
- `lib/ai/analysis.ts` — cache-aware façade + durable jobs; `ai_job`/`ai_result`
  tables in `lib/db.ts`; `/api/ai/jobs/[id]`
- `lib/ai/schemas/movement.ts` — wire + tolerant-parse views (v1)
- **Movement explainer migrated** — first call site behind the flag;
  its tests pass unmodified under AI_PROVIDER=ollama
- `UAA Analyst` playbook synced (DEVIN_PLAYBOOK_ID in .env.local);
  `scripts/devin/sync-devin-assets.mjs`; `scripts/ai-parity.ts`;
  `scripts/devin/acu-check.mjs`

## Next in the agreed order (each gated on its own parity run)

financial-insight → calendar-brief → watchlist digest → verdict + cache
warming → portfolio thesis → home brief → compare → simulator → scanner
(fan-out ≤40 validated) → IC report (parallel agents) → thematic →
streaming redesigns. Policy-text amendments (AGENTS.md, lib/ai/ARCHITECTURE.md,
docs/devin-integration.md still say "local-only") ship with the first PR that
flips a default to Devin.
