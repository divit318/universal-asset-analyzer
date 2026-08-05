# UAA Pre-Demo Audit — Summary

Audit date: 2026-08-05. Method: live app on :3000 (warm, 197MB DB), fresh
production instance with scratch DB, full test suite, offline red-team harness
against the verification layer, live hosted-AI probes, independent data
cross-checks. Full detail in `01-findings.md`.

## The 15 findings that most threaten the demo (ordered)

1. **F-01 (P0, on-camera)** The footer on every screen says "Runs locally. Your data never leaves this machine." while the header badge says "AI · Claude Opus 5" — the app is demonstrably sending the user's portfolio composition, objectives, and position context to a hosted LLM (api.devin.ai) on page load. One video frame contains both strings.
2. **F-02 (P0, on-camera)** The same homepage payload calls AAPL "down -7.4%", "down -8.7%", and "-7.5%" with price $304.34, while /research and /watchlist simultaneously show AAPL **+1.96% at $309.38**. Same stock, same day, same session.
3. **F-03 (P0, on-camera)** ~15+ UI surfaces claim the AI is local ("LOCAL AI" badge, "typically 20–40s on a local model", "Runs fully on local models", "Reads every name… Runs on your machine") while generation verifiably ran on hosted claude-opus/sonnet via Devin (server logs). A partner who checks Activity Monitor or asks one question kills the core claim.
4. **F-04 (P0, on-camera)** The verification layer is entity-, direction-, metric- and period-blind: narration that swaps a real number onto the wrong company, calls growth a decline, swaps net/operating margin, or attributes FY revenue to a quarter passes with a **perfect 1.0 "high" grounding score** (8 of 15 red-team attack classes bypassed; reproducible harness included).
5. **F-05 (P0, on-camera)** Research page shows margin of safety **-262.3%** in red next to an auto-seeded "Your case $85.39" against a $309.38 price — an absurd-looking number produced by the MOS-on-fair-value formula on an unreviewed auto-seed. First thing a viewer reads on the flagship screen.
6. **F-06 (P0, on-camera)** The quant engine's own dashboard data reports **live IC -0.0448, hit rate 0.0, strong-buy alpha -16.7%, live Sharpe -0.58** and 46/50 NSE names STALE. If /engine's validation section scrolls into frame, the engine self-reports that it loses money out of sample.
7. **F-07 (P0, on-camera)** Screener shows SK hynix (SKHY) market cap **$1.10T**; independent sources put it at ~$650–880B. A top-3 row of the default screener view is wrong by hundreds of billions of dollars.
8. **F-08 (P1, on-camera)** `/api/home` takes **12–14s on every load (no caching benefit measured)**; The Wire auto-fires a multi-minute hosted-AI scan on page visit (one POST measured at 49s, progress stuck at "12%" for 10+ minutes, four empty gray panels with no skeletons); IC report is honest that it takes "3 to 15 minutes". None of these are filmable live.
9. **F-09 (P1, on-camera)** The AI regime narrative is non-deterministic between takes: warm instance said "neutral regime", fresh instance said "risk-off mode" for the same day's data — and the risk-off brief contradicts itself ("risk-off … despite 64% of sectors advancing, led by Technology").
10. **F-10 (P1, on-camera)** Movement explainer says AAPL "slipped just 0.15%" while the quote header on the same screen says -0.29%; verdict prose cites "composite score of 56/100" while Screener shows a different Overall for the same stock (two scoring engines by design, one label).
11. **F-11 (P1, on-camera)** Bottom ~2000px of /engine (Model health + Model validation sections) rendered as solid black in the audit browser despite content present in the DOM — reproduced across scrolls and fullPage capture. Needs manual confirmation in a normal browser; if real, it hides exactly the sections a partner would ask for.
12. **F-12 (P1, inspection)** The flagship Research verdict computes a grounding report but **never renders it** — the grounding badge only exists on copilot, IC agents, and Compare. The central "verification layer" claim is invisible on the surface most likely to be demoed.
13. **F-13 (P1, inspection)** `/api/report` returns raw `err.message + err.stack` to the client on failure (app/api/report/route.ts:171-173). One failed Excel export on camera prints a stack trace.
14. **F-14 (P2)** 13 npm vulnerabilities in prod deps (6 high, incl. exceljs→uuid, hono, body-parser); Next.js telemetry is **enabled** (verified) on a "data never leaves" product; maintainer's personal email hardcoded as default SEC User-Agent; screener.in HTML scraping + Yahoo unofficial API are ToS-gray for a commercial product.
15. **F-15 (P2)** Repo hygiene undermines the "institutional-grade" story on clone: `predev` refers to untracked `scripts/ops/uaa` (uncommitted working tree ahead of HEAD), root littered with `build*.log`, `dev*.log`, 7 `PLAN-*.md`, a 170MB `app.db.bak-gld-repair`, and AGENTS.md's "1715 tests" vs actual 2646.

## Blunt verdict

**Not filmable as-is.** The product's strongest true differentiators (breadth,
deterministic engines + honest provenance design, genuinely good empty/error
states, a copilot that demonstrably refuses to fabricate and corrects false
premises) are real — but the current build tells a false story about itself
in three ways a technical partner will catch in one viewing: (a) it claims
local/private while visibly running hosted Claude, (b) it shows the same
number two different ways on one screen, and (c) its verification layer's
guarantee is far narrower than the marketing sentence implies.

**Minimum fix set to film (est. 2–4 days):**
1. Pick a truthful AI story. Either demo in `AI_PROVIDER_ORDER=ollama` mode with Ollama running (and accept 20–40s waits, pre-warmed caches), or change every "local/never leaves" string to the accurate "local-first storage, hosted or local AI — your choice" (F-01, F-03, landing badge).
2. Fix the homepage stale-quote path so brief/attention/quote agree on one price snapshot (F-02, F-10).
3. Suppress or sanity-clamp the auto-seeded valuation strip (hide MOS when the case is an unreviewed auto-seed) (F-05).
4. Fix SKHY-class ADR market-cap normalization or exclude affected ADRs from the default screener sort (F-07).
5. Pre-warm every AI panel you plan to show (verdict cache, brief, Wire scan completed before recording); never navigate to a cold Wire/IC page on camera (F-08).
6. Render the grounding badge on the Research verdict and script the demo claim as: "every figure the AI writes is checked against the evidence it was given; semantic direction comes from the deterministic engines" — which is what the code actually guarantees (F-04, F-12).
7. Hide /engine's validation section or rerun the engine on a universe where live OOS is presentable; fix the black-render if reproducible (F-06, F-11).
