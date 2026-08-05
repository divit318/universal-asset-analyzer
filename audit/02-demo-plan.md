# UAA — Demo Plan (Phase 7)

## The three most impressive things UAA can truthfully show in 2–3 minutes

### 1. Breadth with real state: seven asset classes, one keystroke apart
Nothing else at this stage has a working Screener across equities/ETFs/REITs/
crypto/commodities/bonds/forex (1,553 ranked names live), a watchlist with
pipeline stages, and a portfolio with health grading — all reading and writing
one local SQLite file, all measured fast (every non-AI page TTFB < 100ms warm).
This is the "stop juggling a dozen tools" claim, demonstrated rather than
asserted.

### 2. Deterministic engines with the AI held on a leash — told honestly
The architecture genuinely is "code computes, model narrates" in its best
modules: the IC valuation engine computes every figure and lets the model
propose inputs only (`lib/ic/valuation-engine.ts` + `valuation-inputs.ts`);
portfolio theses receive an ESTABLISHED CONCLUSIONS block; and the copilot —
demonstrated live in this audit — **refused** to invent missing segment data
and **corrected** a user's false "revenue fell 16.4%" premise, with citations
to EDGAR. That correction moment is a fantastic 15 seconds of video, and it is
real.

### 3. The research loop closing into the journal/watchlist
Ticker → full dossier (quote, filings, news, technicals, sector regime) →
verdict with WHY OWN / WHY AVOID tied to visible metric chips → add to
watchlist with target → decision journal entry. The "institutional memory for
an individual investor" story. All fast except the verdict (pre-warm it).

## Exact 2–3 minute sequence (after the minimum fixes in 00-summary.md)

0:00–0:15 — Screener, Equities tab (pre-loaded). One sentence on breadth;
click a template (Quality). *Prereq: F-07 SKHY cap fixed or row excluded.*
0:15–0:50 — Research on a name from the list (pre-warmed verdict cache so it
paints instantly; do NOT type a cold ticker). Point at: composite score chips,
the verdict's WHY OWN/WHY AVOID, and — after F-12 — the grounding badge:
"every figure in that paragraph was traced back to the evidence."
0:50–1:20 — The copilot correction moment, scripted: type "I heard revenue
fell 16.4% — how bad is it?" and let it correct you with an EDGAR citation.
(Verified live: 5.4s response. This is the single best proof of the
verification story that is actually true.)
1:20–1:50 — Watchlist: pipeline stages, targets, "vs SPY" column; add the
researched name. Then Portfolio: health grade, attribution, the CURRENCY
concentration warning ("computed in code, not by the model").
1:50–2:20 — Valuation workspace on a name with a **human-edited** case (never
the auto-seed, see F-05): drag growth assumption, watch fair value and the
sensitivity grid recompute deterministically.
2:20–2:40 — Close on Today (fresh regeneration verified stable, F-09 fixed or
brief pre-generated): "one morning brief, every number traceable to the
engines you just saw." Footer visible only after F-01 copy fix.

Never show on camera: /wire cold (49s+ scan, empty panels), /ic-report live
(3–15 min), /engine validation section (negative live IC), the auto-seeded
valuation strip, the header AI pill until the story matches it.

## Top 10 questions/objections a technical YC partner would raise

1. **"The footer says data never leaves the machine — what model just wrote
   that paragraph?"** Current answer: hosted Claude via Devin, with portfolio
   context in the prompt. Codebase support for a good answer: **No** until
   F-01/F-03 copy fix or an all-Ollama demo. This is the kill question.
2. **"Show me the verification layer catching a hallucination."** Support:
   **Partial.** It demonstrably catches invented magnitudes/percents
   (harness: score 0.25 "low"), and the UI badges exist on copilot/IC/compare.
   But entity/direction/period swaps pass at 1.0 (F-04). Scripted honestly —
   "numeric tracing, not semantic verification; direction comes from code" —
   this survives. Overclaimed, it dies to one counterexample.
3. **"Your screener says SK hynix is a trillion-dollar company."** Support:
   **No** (F-07). Fix or exclude before filming.
4. **"What's the quant engine's live out-of-sample performance?"** Support:
   **No** — its own dashboard says IC -0.045, hit rate 0, Sharpe -0.58
   (F-06). Honest answer: "the engine is a ranking prior, live validation is
   young and currently negative; that's why verdicts weight fundamentals."
   Have this sentence ready; do not let the page say it first.
5. **"Why does the homepage say AAPL is down 8.7% when it's up 2%?"**
   Support: **No** until F-02. After the fix: "every panel stamps its quote
   snapshot" is a good systems answer.
6. **"Two pages give the same stock different scores — which is right?"**
   Support: **Yes, with labeling** (F-10): batch screening prior vs
   single-name decision engine is a defensible design; the UI just has to
   name them differently.
7. **"What happens fully offline / when the model is down?"** Support:
   **Partial.** Architecture has explicit fallbacks (AI_RECOVERY_HINT,
   non-fatal data errors, cached SWR policies) and clean error states
   (verified bad-ticker). But the actual no-AI/offline path was not exercised
   in this audit (03-not-verified) and Ollama was down all day on the dev
   machine — test before claiming.
8. **"Are you allowed to use Yahoo/screener.in data in a product?"** Support:
   **No** (F-18): unofficial APIs and HTML scraping, including a cookie/crumb
   workaround written into the code. Answer must be roadmap ("licensed feeds
   post-funding; current build is personal-use"), not denial.
9. **"Prompt injection: your evidence includes scraped news headlines."**
   Support: **Partial**: `POST /api/ai` accepts a client-supplied quote as
   evidence, news text flows into prompts unsanitized; mitigations are the
   grounding check (numeric only) and Devin CLI's tool-denial sandbox
   (verified strong: read/write/exec/web all denied). Untested end-to-end.
10. **"Sharpe uses 4.25% risk-free, your WACC uses 4.4% — which is your view
    of the world?"** Support: **No** (F-16) — three hardcoded rates. Small,
    but exactly the kind of thing a quant partner greps for; unify to one
    sourced constant.
