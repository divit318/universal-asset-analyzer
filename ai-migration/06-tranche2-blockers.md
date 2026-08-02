# Tranche 2 — Blocker Reports & Migrations (insight / calendar / watchlist)

Date: 2026-08-02. Verified: tsc clean, **2,597 tests pass**, eslint clean,
`next build` green. `AI_PROVIDER=ollama` global unchanged.

---

## BLOCKER 1 — Confidence calibration (REPORT ONLY; no decision taken)

### 1a. Where a confidence score drives behavior

Full audit (grep `confidence|conviction` across app/ + lib/, every branch
read). The critical distinction that emerged: most branching thresholds
consume **engine-computed** confidence (data coverage, deterministic
scorers), which the provider migration does not touch. The LLM-produced
confidences are a smaller set:

**LLM-produced confidence, BRANCHED on (the actual blast radius):**

| file:line | score | threshold | fires above/below | surface |
|---|---|---|---|---|
| `lib/opportunity-engine.ts:178-180` | event-signal confidence (LLM) + score | score≥70 **&& confidence≥55** → "High" conviction label; score≥50 → "Medium"; else "Low" | conviction label | Opportunity Engine |
| `lib/event-screener.ts:189` | signal confidence (LLM) | `>= minConfidence` (caller param) | signal kept vs dropped | Event screener |
| `app/ic-report/_components/shared.tsx:52-59`, `valuation-tab.tsx:120` | IC agent confidence (**enum** high/medium/low from LLM) | high→positive / medium→warning / low→negative | chip color | IC Report |
| `lib/ic-agents.ts:319-322` | same enum | unsupported numbers present → downgrade high→medium→low | confidence downgrade | IC Report |
| `app/research/_components/decision-hero.tsx:229-230` | verdict confidence (enum from LLM) | high/medium/low → color band | Research hero |
| `app/research/_components/chart-workspace/ai-dock.tsx:187-190`, `app/_components/ai-assistant.tsx:387` | chart-qa / assistant enums | badge color / pending state | interactive tier (stays Ollama) |

**LLM-produced confidence, RENDERED RAW only (no branch — shift is visible
but breaks nothing):** movement explainer card (`movement-explainer-card.tsx:199`),
portfolio why-own-this (`why-own-this.tsx:73`), scanner thesis confidence.

**Engine-computed confidence (NOT affected by provider choice; listed to
scope the audit):** conviction-breakdown bands ≥70/≥45 (scoring engine),
screener results `<60 provisional` (data coverage), portfolio fit ≥60/<40
bars and <70 inline display, recommend.ts `<55` sell-gating, cash.ts
eligibility, timeline scoreConfidence, attention-queue exponent, grounding
verifier ≥0.85/≥0.6 bands, export color bands ≥70/≥45, conviction-book
`composite × confidence` product.

Tranche-2 relevance: **financial insight, calendar brief, and the watchlist
digest carry no confidence field anywhere** (audited: `WatchlistDigest` has
none; both text tasks are prose) — so this tranche was not blocked.

### 1b. The shift, quantified (15-symbol parity set, explain-movement)

Confidences: Ollama mean **62.7** (range 20–85), Devin mean **34.9** (range
5–62). Delta per symbol: mean **−27.8**, median −28, range −13…−43 — the
shift is systematic, not noise (Devin is lower on all 15 of 15).

Existing-threshold crossings on the same 15 analyses:

| Threshold (used by) | Ollama crosses | Devin crosses |
|---|---|---|
| ≥70 (conviction-breakdown "High"; export green) | **5**/15 | **0**/15 |
| ≥60 (fit evidence-bar positive) | 12/15 | 2/15 |
| ≥55 (opportunity-engine "High" gate; recommend sell-gate) | 13/15 | 3/15 |
| ≥45 (conviction-breakdown "Medium"; export orange) | 14/15 | 5/15 |

The character of the difference matters as much as the magnitude: Devin's
numbers track dossier quality (5 on the empty dossier, 22–27 on
irrelevant-news dossiers, 55–62 on real stories); Ollama emits 50–85 nearly
regardless (65 where the news explained nothing, 20 on a literally empty
dossier). Devin is better calibrated; Ollama is compressed-optimistic.

### 1c. Three options (recommendation stated; decision is yours)

**(a) Retune thresholds to Devin's distribution — per surface, at that
surface's migration gate.** E.g. movement-class: "high" ≥50, "medium" ≥30
(from the observed 55–62 strong / 22–35 weak clusters). Each future gate's
parity run produces exactly the per-task data needed. Cost: threshold churn,
and hybrid-period surfaces need provider-aware bands. Benefit: keeps the
calibration signal; labels stay truthful.

**(b) Leave thresholds; accept fewer fires.** "High conviction" becomes
rare and genuinely meaningful (0/15 vs 5/15 on this set). Zero code churn;
correct direction of error (under-claiming). Risk: surfaces designed around
a expected base rate of "high" badges go quiet, which reads as a regression
to a user tuned to today's optimism.

**(c) Rescale Devin into Ollama's range (affine/quantile map).** Rejected on
the merits: it launders a calibrated signal back into a mis-calibrated one to
preserve pixel behavior, the mapping would be fitted on 15 points from ONE
task, and it silently degrades the property that made Devin's output better.
Your instinct matches.

**My recommendation (not enacted): (b) now, converging to (a) per-surface.**
Keep thresholds untouched during the hybrid period (any surface may serve
either provider, and (b) is the only choice coherent across both); when a
confidence-consuming surface migrates and its own parity run lands, retune
that surface's bands from its own data as part of its gate. (c) never.
**Stopping here per instruction — nothing was changed.**

---

## BLOCKER 2 — ACU, resolved as far as this tier allows

**The v1-legacy-key hypothesis is refuted — and was not the cause.** Our key
is a v3 `cog_` service-user key (`GET /v3/self` → `principal_type:
"service_user"`). Everything below was measured through v3.

**API probes (all live, 2026-08-02):**

| Probe | Result |
|---|---|
| `GET /v3/organizations/{org}/consumption/daily` (incl. 30-day `time_after` window) | 200, `{"total_acus": 0.0, "consumption_by_date": []}` |
| `GET …/sessions/{id}/insights` | 200 — carries the same `acus_consumed: 0.0` field, no separate cost data |
| `GET /v3/organizations/{org}` (org details) | **404** (endpoint is enterprise-scope) |
| `GET …/consumption/cycles` | **404** |
| `GET /v3/enterprise/organizations`, `/v3/enterprise/consumption/acu-limits/devin` | **403 Forbidden** |

**Plan tier via API: unreachable — I could not verify your "unlimited"
assumption, and neither can any script with this key.** The enterprise
endpoints 403 and there is no self-serve plans/quota endpoint in the v3
index. Per the docs, self-serve usage lives ONLY in the webapp: "Self-serve:
Current month's usage, quota remaining, and on-demand credit balance live at
Settings > Plans" (docs.devin.ai/admin/billing/usage.md); the ACU
consumption analytics are described for Enterprise
(docs.devin.ai/admin/billing/self-serve.md frames self-serve metering as
quota + on-demand credits, not ACU ledgers).

**The deliberately expensive session** (`f63966cc…`, "ACU metering probe"):
fast mode, `max_acu_limit: 10`, ~4 minutes of real agent work — wrote and
ran a 5M-row pandas pipeline with a 500-iteration bootstrap, refactored it
with unit tests, profiled and re-ran an optimized version, returned valid
structured output. `acus_consumed` polled every 20s during the run and
re-read after termination: **0.0 throughout.**

**Conclusion, stated plainly:** per-session cost is **not measurable via the
API on this org's tier** — a 4-minute compute-heavy session and 100+
micro-sessions all read 0.0, org daily total reads 0.0, and the granular ACU
surfaces are enterprise-only. It is not rounding (the big session would have
metered). Either this org's plan meters as webapp-only quota/credits, or
consumption simply isn't being drawn. **The one ground truth available is
app.devin.ai → Settings > Plans** — please read the quota/credit numbers
there before/after a day of use; the 106-session history to date is the
baseline. `max_acu_limit` stays on every session (4 default, 10 max used
once) so the worst case is bounded even while unmeasured. The 24h re-check
(`scripts/devin/acu-check.mjs`) still runs, but I do not expect it to
produce a different answer. **Screener remains blocked on your reading of
Settings > Plans, per your criterion.**

---

## ADDITION — Semantic agreement (same 15 movement analyses)

Method: driver category+direction sets compared per symbol; every divergence
adjudicated against the dossier (evidence quotes preserved in
`bench-out/parity/`). Headline numbers:

- Mean Jaccard overlap of driver-category sets: **0.48**
- 12/15 symbols share ≥2 driver categories; the shared core is almost always
  the primary story (news/earnings) + volume
- Direction conflicts on shared categories: **9/15 symbols** (10 conflicts)
- Structural difference: Devin always decomposes into 4 drivers (splitting
  earnings/sentiment/sector out of what Ollama files under "news"); Ollama
  emits 2–3 coarse drivers. Most "devin-only" categories are refinements,
  not disagreements.

Adjudication of the 10 direction conflicts — which reading does the dossier
support?

| Conflict | Verdict | Why |
|---|---|---|
| JPM volume −23% | **Devin** (neutral) | Falling volume on a −1.2% drift = absence of conviction; Ollama reads any volume decline as bearish |
| KOSS volume −25% | **Devin** (neutral) | Same pattern |
| CRCL volume −22% | **Devin** (neutral) | Same pattern |
| PEP volume −1% | **Devin** (neutral) | A 1% volume change is noise; "reduced investor activity" is over-reading |
| JPM news | **Devin** | Ollama's bearish driver cites a **Capital One** headline as a JPM driver — wrong company; Devin cites JPM's own record-profit digestion |
| PG valuation | **Devin** (neutral) | The headline is explicitly two-sided ("cheap on cash flow but pricey on earnings"); bearish discards half the evidence |
| GLD news | **Devin** (neutral) | Ollama's bearish evidence is generic "ETFs Mixed" wire copy; the only gold-specific item is a neutral comparison piece |
| TSLA news | **Devin** | Ollama's description asserts "Tesla delivered 480,126 vehicles… a 25% increase" while citing a corporate-structure headline — a claim its own cited evidence does not contain (see harness fix below) |
| 7203.T volume +150% | split | Bullish (heightened interest) and neutral (index-flow, since zero Toyota-relevant news) are both defensible; Devin's caution fits the evidence-free dossier better |
| MSFT news | split | Different headlines, both real: Devin flagged the regulatory-probe item as an offset; Ollama used bullish listicles |
| CRCL news | **Ollama** | "CRCL Struggles… Amid Bitcoin's Drop to $64K" directly explains a −4.7% move; Devin's regulatory-overhang neutral is weaker |

**Score: Devin's reading better supported in 8/10, Ollama in 1/10, 2 splits
(one counted twice as split+devin above; net 8-1-2 on 11 judgments).** The
systematic failure modes are Ollama's: (i) any volume decline → "bearish",
even −1%; (ii) occasional wrong-company or generic-wire evidence; (iii) one
claim not contained in its cited evidence. So: the providers do produce
materially different analyses at the margins — and where they differ, the
dossier usually sides with Devin. "Parity" for this task class should be
read as "Devin ≥ Ollama", not "Devin ≈ Ollama".

Harness upgrades shipped from these findings: full prompts now persisted in
every parity record; number-grounding now scans ALL output text (the TSLA
description leak was invisible to the evidence-only check), with
scaled-match tolerance so `$108,807,000,000 → "$108.81bn"` reformatting
isn't flagged.

---

## Tranche-2 migrations (all three confidence-free → unblocked)

| Call site | Change | Parity gate |
|---|---|---|
| **Financial insight** (`lib/ai-financial-insight.ts`) | text-mode `runAnalysis` (`quick-summary`); Ollama prompt byte-identical (no json flag); outer 15-min cache unchanged | **7/7 both providers** (BGFV skipped: Yahoo quoteSummary gone — logged, honest). Flags adjudicated: all "ungrounded numbers" were unit reformatting ($108,807,000,000→"$108.81bn") — harness now scale-matches |
| **Calendar brief** (`lib/ai-calendar-brief.ts`, extracted from the route so harness+route share one impl) | text-mode `runAnalysis`; 50s Ollama budget kept; Devin floor 240s (provider now treats caller timeouts as wideners only — a 50s caller budget must not strangle a 49s-tail session) | **4/4** incl. a zero-events degenerate week — both said "quiet", neither invented events |
| **Watchlist digest** (`lib/ai-watchlist.ts`) | JSON `runAnalysis` with wire+tolerant schemas mirroring the old defaults; no cache (explicit button) | **4/4** (typical 8-symbol list + degenerate 2-microcap list); every topPick/topConcern symbol verified to be a real watchlist member on both providers; one Devin flag adjudicated: "$12.85T" is the correct SUM of three dossier market caps — derived arithmetic, not invention |

Also: `output: "text"` mode added to the seam (Ollama adapter skips JSON
extraction; Devin ships `{text}` through structured output);
`devinTimeoutMs: 240s` declared for the three tasks; movement task's
interactive guardrail note: calendar-brief and quick-summary are
`latency:"interactive"`, so they stay on Ollama under a global
`AI_PROVIDER=devin` and only move via per-task pins.

Latency observed this tranche (Devin, fast): insight 12–21s, watchlist
23–24s, calendar 34s — all within the 48.8s historical max; 240s budgets
stand.

Incidental (pre-existing, untouched): `lib/calendar.ts` warns its hardcoded
MACRO_EVENTS schedule ends 2026-12-18 — worth a follow-up outside this
migration.
