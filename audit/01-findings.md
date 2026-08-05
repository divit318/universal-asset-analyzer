# UAA Pre-Demo Audit — Full Findings

Sorted: ON-CAMERA first, then severity. "Runtime" = reproduced live; "Static" =
code inspection only. Screenshots in `audit/shots/`. Audit host: the dev
machine, dev server :3000 (Next 16.2.9, up 1.5 days, `data/app.db` 197MB), plus
a fresh production instance (`next start -p 3210`, scratch `DB_PATH`) for
cold-start. Ollama was **down** for the whole audit; all AI ran via hosted
Devin (models `claude-opus-5-low`, `claude-sonnet-5-low`, `swe-1-6-fast` per
`dev.log` / `data/ai-health.json`).

Severity: P0 = visibly breaks or wrong number on camera. P1 = partner catches
on video/inspection. P2 = real, not demo-visible. P3 = hygiene.

---

## ON-CAMERA — P0

### F-01 — "Your data never leaves this machine" rendered while portfolio data is sent to a hosted LLM  **P0 · ON-CAMERA · Runtime**
- **Where:** `app/_components/site-footer.tsx:38` ("Runs locally. Your data never leaves this machine.") on every page; header AI pill (`app/_components/ollama-status.tsx`) simultaneously reads "AI · Claude Opus 5 (medium reasoning)". Landing: `app/landing/_components/landing-footer.tsx:22,45` ("powered by local AI, all on your computer", "No cloud, no accounts") and hero badge "RUNS 100% ON YOUR COMPUTER" (`audit/shots/landing.png`). README.md: "offline AI (Ollama — no external LLM APIs, no paid LLM providers)".
- **Repro:** Open any page (`audit/shots/home-initial.png`, `home-mid.png`). Then `grep '\[ai\]' dev.log` — verdicts/briefs ran on `claude-opus-5-low` via Devin. `.env.example` states "Devin is the PRIMARY AI provider (decision 2026-08-02)"; default chain `devin,ollama` (`lib/ai/config.ts:69`).
- **What leaves the machine (verified via `lib/ai/facts.ts` `buildPortfolioFacts`, `lib/ai/report-sections.ts:117-161`, and the live `/api/ai/report` request in dev.log):** investment objective, portfolio fit score, whether the symbol is held, IOS-suggested allocation %, missing sectors, plus full company dossiers — sent to `api.devin.ai` / Devin CLI sessions.
- **Observed vs expected:** Footer claims zero egress; runtime shows user-specific portfolio context in hosted prompts. Git history shows the flip-flop: `1e1a34b "Revert default provider chain to local-only"` then HEAD `4c67333 "Devin is the primary AI provider"` — the copy was never updated.
- **Blast radius:** The product's central claim; also a privacy representation issue if shown to users.
- **Fix estimate:** 2–6h (copy + one truthful mode switch) — or demo entirely in `AI_PROVIDER_ORDER=ollama`.

### F-02 — Same screen shows three different AAPL daily moves and two prices  **P0 · ON-CAMERA · Runtime**
- **Where:** `/` (Today). `audit/shots/home-initial.png`: brief chip "Weakest AAPL -7.5%", Attention card "AAPL down -8.7% … moved -8.7% today to $304.34". Same session `/research?symbol=AAPL` and `/watchlist`: **$309.38, +1.96%** (`audit/shots/research-aapl-t45.png`, `watchlist.png`).
- **Repro:** `curl :3000/api/home` → one payload contains `recommendedActions` "AAPL down -7.4%" (twice, duplicated verbatim), `intelligence.items` "AAPL down -7.4%" ×2 and "down -8.7%" ×1, attention "down -8.7%", price $304.34; `/api/fundamentals?symbol=AAPL` at the same moment: price 309.38.
- **Observed vs expected:** One quote snapshot per render. Instead stale cached items (different generations) are merged and served together; duplicate action items also appear verbatim.
- **Blast radius:** Homepage is the first demo frame. Also "down -8.7%" is double-signed prose ("down -X%").
- **Fix estimate:** 4–8h (stamp quote snapshot per home payload; dedupe recommendedActions; refresh/expire stale attention items).

### F-03 — UI credits "LOCAL AI" / "local model" for output produced by hosted Claude  **P0 · ON-CAMERA · Runtime**
- **Where (verified strings, all user-visible):** `app/research/_components/decision-hero.tsx:72` ("typically 20–40 s on a local model") and `:251` ("Local AI" badge — visible in `audit/shots/research-aapl-t45.png` while dev.log shows the same verdict ran on `claude-opus-5-low`, 15.1s); `app/ic-report/page.tsx:264` ("Runs fully on local models."), `:458` ("3 to 15 minutes on a local model"); `app/calendar/page.tsx:498-517` ("Local AI", "Ollama-generated summary", "Generating weekly brief via Ollama"); `app/compare/page.tsx:299,995`; `app/compare/_components/class-ai-verdict.tsx:123,141`; `app/watchlist/page.tsx:476-484` ("The local model did not respond." / "Check that Ollama is running."); `app/watchlist/_components/digest-panel.tsx:68,131`; `app/portfolio/_components/universal/portfolio-thesis.tsx:96,189` ("Written by the local model from the measured figures on this page."); `app/research/_components/why-section.tsx:157`; `app/thematic/page.tsx:308`; `app/thematic/_components/hero.tsx:123`; watchlist panel copy "Reads every name on this list… **Runs on your machine**" (`audit/shots/watchlist.png`); `app/api/ic-report/route.ts:208` & `app/api/screener/nl/route.ts:51` (Ollama-only error strings — AGENTS.md itself forbids "start Ollama" messaging).
- **Observed vs expected:** Every one of these rendered/renders during hosted-Devin operation. Only `ollama-status.tsx:50` gets it right.
- **Fix estimate:** 3–5h (source the provider name from the router into all badges/copy).

### F-04 — Verification layer passes wrong-entity, wrong-direction, wrong-metric, wrong-period claims at grounding score 1.0  **P0 · ON-CAMERA · Runtime (offline harness)**
- **Where:** `lib/ai/grounding.ts` (`verifyGrounding`). Harness: `/tmp/uaa-audit-fresh/redteam-grounding.ts` (copy in `audit/` recommended); run `npx tsx <harness>`.
- **Result: 8 of 15 attack classes bypass with score=1.0 "high":**
  1. Entity swap — "Microsoft's revenue grew +16.4%… Apple's +12.1%" (numbers swapped between companies) → 1.0.
  2. Direction inversion — "revenue DECLINED 16.4%" vs evidence "grew +16.4%" → 1.0 (extraction is sign/verb-blind).
  3. Metric swap — net vs operating margin exchanged → 1.0.
  4. Period swap — FY revenue asserted as "most recent QUARTER" → 1.0.
  5. Kind cross-match — "Fair value is $34.84 per share" grounded by the trailing **P/E** 34.84x → 1.0 (`kindsComparable` only separates percents).
  6. Integer-rounding hole — `roundsTo` (`grounding.ts:228-234`) accepts equality after rounding to 0 decimals, so any %-figure within ±0.5pp of any evidence % passes regardless of `relTol`.
  7. Fabricated citation narrowing — "[edgar:8-K 2026-08-01]" (no such filing) passes because validity is prefix-only (`grounding.ts:107-110`).
  8. Fabricated counts — "9 active DOJ antitrust suits", "missed guidance 11 times" → 1.0 (unitless integers ≤12 skipped, `grounding.ts:189`).
- Additionally: cherry-picked-but-true narration scores 0.88 "high"; 1 fabrication among 6 figures scores 0.88 "high" (level thresholds `scoreToLevel:240`).
- **What it DOES catch (verified):** fully hallucinated magnitudes/percents, cross-kind percent↔dollar, hallucinated currency amounts — the control cases scored 0.25 "low".
- **Live behavior (hosted model):** two live elicitation probes against `/api/research/chat` did NOT produce fabrications — the model refused missing segment data and **corrected** a false "revenue fell 16.4%" premise (14.1s / 5.4s). The current safety margin comes from the hosted model's quality, not the verifier; AGENTS.md documents that 7B local models produced exactly the wrong-direction assertions this verifier cannot catch.
- **Bonus finding:** in that live answer, the dossier's own figures contradict: "grew from $391.04B (FY2024) to $416.16B (FY2025)" = **+6.4%**, but the dossier label says "+16.4% YoY" (quarterly YoY vs FY-over-FY served side-by-side). Grounding: 1.0. A partner doing one division on camera catches it.
- **Blast radius:** This is the claim a technical partner will probe hardest.
- **Fix estimate:** honest scoping of the claim: 1h (copy). Real fixes (entity/direction tagging, per-metric matching): 2–5 days.

### F-05 — Margin of safety -262.3% on auto-seeded valuation, flagship screen  **P0 · ON-CAMERA · Runtime**
- **Where:** `/research?symbol=AAPL` valuation strip (`audit/shots/research-aapl-t0.png`): "YOUR CASE $85.39 · MARGIN OF SAFETY **-262.3%** · Seeded automatically — none of these assumptions are yours yet."
- **Why:** `lib/valuation/dcf.ts:281` MOS = (FV − P)/FV; with auto-seed FV $85.39 vs price $309.38 → -262.3%. Formula is a legitimate convention, but on an unreviewed auto-seed it renders an absurd headline number implying -72% downside for AAPL.
- **Expected:** hide MOS (or show "set your assumptions") until a human has touched the case; or clamp/represent as "price is 3.6× your case".
- **Fix estimate:** 2–4h.

### F-06 — Quant engine self-reports negative live performance; 46/50 symbols stale  **P0 (if scrolled into frame) · ON-CAMERA · Runtime (data), Static (render)**
- **Where:** `data/engine_dashboard.json` (2026-08-02 run): `live_IC: -0.0448, hit_rate: 0.0, strong_buy_alpha: -0.1667, sharpe_live: -0.5753, n_obs: 1469`; `nse_status`: 46/50 STALE. /engine renders "Model health — the engine's continuous, out-of-sample…" and "Model validation" sections from this family of data.
- **Also:** /engine header data is 2026-07-31 (5 days stale, "prior run 2026-07-17"); universe selector shows "Nifty 50" above a US-name (CVX/AMZN/GS) scorecard; Kelly column shows 0.0% for every top conviction long incl. an 88% P(UP) name; #2 conviction (SKHY) shows "no forecast" (`audit/shots/engine.png`).
- **Blast radius:** the "quant engine earning its keep" narrative self-destructs if these sections are shown; if hidden, a partner asking "what's live IC?" has a worse answer.
- **Fix estimate:** presentation triage 2h (exclude from demo); real fix = model work, out of scope.

### F-07 — Screener top-3 row: SK hynix market cap $1.10T (real: ~$650–880B)  **P0 · ON-CAMERA · Runtime + independent cross-check**
- **Where:** `/screener` default Equities view, row 1 SKHY "$1.10T" (`audit/shots/screener.png`).
- **Cross-check:** stockanalysis.com $805–878B; marketcapwatch $712B; marketcap.company $656B (July 2026 dates vary). Discrepancy ≈ +$220–450B (25–70%).
- **Likely cause:** ADR share-count × ADR price double-count (newly listed NASDAQ:SKHY ADR, July 2026 IPO) from the Yahoo screener feed — not verified to root cause.
- **Also on this screen:** "updated 3:36:53 PM" (3h stale at capture); action buttons alternate "Watch"/"Watching" states inconsistently between visually identical rows.
- **Fix estimate:** 4–8h (validate market caps against shares×price; flag/drop outliers).

---

## ON-CAMERA — P1

### F-08 — Dead-air latency on the demo path  **P1 · ON-CAMERA · Runtime (measured)**
- `/api/home`: **13.8s, 12.6s, 14.2s** across three hits (no cache benefit); `/api/home/brief` 18.7s then 12.3s. The page paints instantly from a previous snapshot (good), but "Updated <time>" plus F-02's stale numbers is what that snapshot costs.
- The Wire (`/wire`): visiting auto-starts a hosted-AI scan (no user action). Measured: `POST /api/scanner/v2` **49s**; UI progress stuck at "**12% — Classifying events by category**" for 10+ minutes; four section panels (Market State, AI Market Summary, Opportunities, Emerging Themes) are **empty gray boxes with no skeleton/copy** meanwhile (`audit/shots/wire.png`); navigating away aborts the run (`[ai] category:"cancelled"` in dev.log); prior auto-scan concluded "0 high-conviction, 0 developing" — i.e., panels can be empty even after the wait. Home "Radar" shows the same staleness ("From a stale scan — re-run the scanner…", `home-initial.png`).
- Research verdict: 15.1s hosted (`GET /api/ai/report … 200 in 15.1s`); copy promises "20–40s on a local model"; `/api/portfolio/report` 13.0s.
- IC report: self-declared "3 to 15 minutes". Not filmable live; must use a saved report.
- Page TTFBs are all fine (<0.8s warm; landing 1.8s first hit).
- **Fix estimate:** demo choreography 0h (pre-warm everything); Wire skeletons/caching 1–2 days.

### F-09 — AI brief is non-deterministic and self-contradictory between takes  **P1 · ON-CAMERA · Runtime**
- Warm instance 18:27 IST: "market is in a **neutral** regime with 64% of sectors advancing" (`home-initial.png`). Fresh instance 18:59 IST, same market data: "Markets are in **risk-off** mode despite 64% of sectors advancing, led by Technology, Materials, and Industrials" (`coldstart-home.png`) — an internally contradictory sentence (risk-off led by Tech while 64% advance).
- **Blast radius:** two takes of the same demo can disagree on the regime; AGENTS.md's own product rule ("compute every directional conclusion in code") is violated by the regime word coming from the model.
- **Fix estimate:** 4h (pass the deterministic regime label as an ESTABLISHED CONCLUSION; forbid the model from re-deriving it).

### F-10 — One screen, two numbers: movement explainer & score labels  **P1 · ON-CAMERA · Runtime**
- `coldstart-research.png`: quote header "-0.29%" vs "WHY DID AAPL MOVE? … slipping just **0.15%**" on the same viewport.
- Verdict prose cites "composite score of 56/100" (warm) / "59/100" (cold) while Screener's "Overall" column for the same stock derives from `lib/composite.ts` with different thresholds than `lib/scoring.ts` (verified: financials fwd-P/E worst 20 vs 18; utilities 30/12 vs 28/13; default valuation composite = fwdPE 40/8+EV/EBITDA+FCF-yield vs scoring = analyst-upside+PEG+fwd/trailing). Two engines are documented as intentional (AGENTS.md), but the UI labels both simply "score /100".
- "WHY NOW?" panel repeats a WHY OWN bullet verbatim on the same screen (`coldstart-research.png`).
- **Fix estimate:** movement-explainer snapshot alignment 2–4h; score labeling ("Screener score" vs "Decision score") 2h.

### F-11 — /engine bottom ~2000px renders solid black (Model health/validation invisible)  **P1 · ON-CAMERA · Runtime (audit browser only — needs manual confirm)**
- **Repro (Playwright Chromium, 2560×1440):** scroll to bottom of `/engine` → viewport captures pure black (`audit/shots/engine-bottom.png`, `engine-5400b.png`, `engine-end.png`) even though DOM reports the sections present, `opacity:1`, `content-visibility:visible` (section tops 5587/5931 of 7316px doc). FullPage capture also truncates after the footer band. Keyboard `End` scrolling shows the same.
- **Caveat:** could be a Chromium/GPU artifact under this host's memory pressure; not reproduced in a human-driven browser. VERIFY MANUALLY before treating as fixed/real. If real, the two sections a skeptical partner most wants are the two that don't paint.
- **Fix estimate:** unknown until reproduced by hand (0.5–8h).

### F-12 — Grounding verification is not rendered on the flagship verdict  **P1 · ON-CAMERA (absence) · Static (verified by grep + screenshot)**
- `grep -rl GroundingBadge app/` → only `research/_components/copilot/message.tsx`, `ic-report/_components/agents-tab.tsx`, `compare/*`. Zero occurrences of `grounding` in `app/research/_components/decision-hero.tsx` or `app/research/page.tsx`, even though `lib/ai/verdict.ts` computes it for every verdict. The screenshotted verdict shows no verification affordance.
- **Blast radius:** the differentiating layer is invisible exactly where the demo will linger.
- **Fix estimate:** 2–4h (badge + flags tooltip on decision-hero).

### F-13 — Raw stack trace returned to the browser from /api/report  **P1 · ON-CAMERA (on any export failure) · Static (code verified)**
- `app/api/report/route.ts:171-173`: `const msg = err.message + "\n" + err.stack; return new Response(msg, {status:500})`. Excel Report button on /research calls this route.
- **Fix estimate:** 0.5h.

### F-14 — Misc on-camera polish  **P1/P2 · ON-CAMERA · Runtime**
- Attention rows render the ticker twice: "APA APA Corporation", "PBR PBR Petróleo Brasileiro S.A.", "SYF SYF Synchrony Financial", "NVDA NVDA scoring 82/100" (`home-mid.png`).
- Watchlist summary: "TARGETS SET 3/60" beside "AVG UPSIDE TO EXIT +14.74% · 2 targets" — 3 vs 2 with no explanation (`watchlist.png`); INCY target $20 vs $120.60 price shows "-83.42%" upside (user data, but no stale-target affordance).
- Calendar API returns past events (July 30 GDP on Aug 5) into "upcoming"-styled surfaces.
- /ic-report empty state redirects to `?tab=valuation` with no report loaded.
- AI assistant seed question "What's the difference between Screener and Scanner?" — Scanner was renamed The Wire (`app/_components/ai-assistant.tsx:52`).
- Homepage brief "up 1.37%" vs Book tile "+1.4%" (rounding, defensible but adjacent).
- **Fix estimate:** 0.5–4h each.

---

## NOT ON-CAMERA

### F-15 — Local-first / egress inventory (the accurate claim)  **P2 · Runtime + Static**
- Verified egress: Yahoo (quotes/history/screener + crumb auth to `fc.yahoo.com`), SEC EDGAR (3 endpoints), screener.in (HTML scrape + 2 APIs), Google News/ET/Moneycontrol RSS, NSE India (cookie dance), NewsAPI (optional), RentCast (optional), `api.devin.ai` (AI, default-primary), Sentry (only if DSN set; DSN present-but-empty in `.env.local`), **Next.js telemetry: ENABLED** (verified `npx next telemetry status`).
- Background egress with no user action: `lib/monitor.ts` polls quotes every 5 min for watchlist+portfolio symbols; scanner auto-refresh hourly (`UAA_SCANNER_INTERVAL_MS`); The Wire auto-scan on page visit (hosted AI).
- Storage: all user data in `data/app.db` (SQLite, **unencrypted**); Devin CLI runs in `<tmpdir>/uaa-ai-devin` with all read/write/exec/web tools denied (verified in `lib/ai/devin-cli.ts` config) — prompt text is the only payload.
- Honest phrasing that survives scrutiny: "Your portfolio and research state live in a local SQLite file. Market data comes from public sources. AI runs on a hosted provider by default, or fully offline via Ollama with one env var — when hosted, prompts include company data and portfolio context."
- **Fix estimate:** copy 1h; `next telemetry disable` 5 min.

### F-16 — Engine math notes (verified subset)  **P2 · Runtime-verified where stated**
- **Not bugs (subagent claims I disproved at runtime/inspection):** Bollinger population σ is Bollinger's own convention and documented in-code (`lib/indicators.ts:135`); MACD `?? 0` at `indicators.ts:106` is dead code (slice starts at first non-null, both EMAs non-null after); RSI/ATR Wilder seeding correct; XIRR (Newton+bisection) correct; downside deviation correctly divides by N; recommendation bands single-sourced (`lib/recommendation.ts`).
- **Real issues:** risk-free hardcoded three ways (0.0425 `lib/portfolio-analytics.ts:150`, 0.0425 `lib/derivatives-analysis.ts:19`, 0.044/0.065 `lib/valuation/wacc.ts:25-26`) — Sharpe and WACC disagree about the world by construction; Black-Scholes omits dividend yield entirely (documented, but AAPL options Greeks are slightly wrong; **zero test coverage** for `lib/black-scholes.ts`); two DCF implementations (`lib/valuation/dcf.ts` end-of-year discounting, fixed 10y; `lib/ic/valuation-engine.ts` fade-path with invariants) can produce different fair values for one company depending on the page; `lib/score-math.ts:63` gives missing data half credit (a stock with no data scores 50, shown without qualifier); composite/scoring threshold divergence (see F-10); WACC hardcodes undated "Damodaran 2025" params with a [4%,20%] clamp.
- **Fix estimate:** rate unification 4h; BS dividend yield + tests 4h; DCF documentation/unification 1–2 days.

### F-17 — Dependency vulnerabilities & security  **P2 · Runtime (npm audit)**
- `npm audit --omit=dev`: **13 vulns (6 high, 6 moderate, 1 low)** — exceljs→uuid (high), hono/@hono/node-server (cross-request data disclosure), body-parser DoS, brace-expansion DoS ×3, fast-uri host confusion, ip-address SSRF-class ×2.
- No secrets committed (scanned for `cog_`/`sk-` patterns; `.env.local` holds real `DEVIN_API_KEY` — correctly gitignored). `data/` gitignored.
- Maintainer's personal email hardcoded as default `SEC_USER_AGENT` fallback in `lib/edgar.ts:5` and `lib/statements.ts:6` — ships PII to every EDGAR request of every user by default.
- `/api/*` has no auth and binds on the network interface (`- Network: http://192.168.29.129:3210` in server banner): anyone on the LAN can read the portfolio and trigger paid hosted-AI runs.
- **Fix estimate:** `npm audit fix` + review 2-4h; UA default 0.5h; bind localhost 1h.

### F-18 — Data licensing / ToS exposure  **P2 · Static**
- yahoo-finance2 is an unofficial API wrapper (Yahoo ToS-gray, universally used but not licensable for a commercial demo claim); `lib/yahoo-screener.ts` performs cookie+crumb scraping explicitly; `lib/screener-in.ts` scrapes screener.in HTML with browser-mimicking headers; NSE India requires a cookie dance the code performs. For YC diligence, "where does your data come from and can you ship it?" currently has no clean answer. RentCast/NewsAPI are properly keyed free tiers.
- **Fix estimate:** disclosure honesty in the app 1h; real licensing = business work.

### F-19 — Repo/product hygiene a partner sees on clone  **P2/P3 · Runtime**
- Working tree ahead of HEAD: `package.json` `predev` refers to `scripts/ops/uaa` which is **untracked** (`git ls-files scripts/ops` → 0); modified AGENTS.md/next.config/tsconfig/vitest.config uncommitted. A collaborator pulling HEAD gets docs that reference tooling that doesn't exist.
- Root clutter: `build.log`, `build2.log`, `build-phase4.log`, `build-e2e-warm.log`, `dev*.log` ×5, `PLAN-*.md` ×7, `MASTER_ARCHITECTURE_BLUEPRINT.md`, `DESIGN_PROGRESS.md`, `PROGRESS.md`, `tsconfig.tsbuildinfo`, **`data/app.db.bak-gld-repair` 170MB**, `test-results/`, `ai-migration/`, `bench-out/`, `branding/`.
- Docs drift: AGENTS.md says "1715 tests"; actual 2646. README quick-start says only Ollama needed for AI while default chain is Devin-first. eslint has 11 problems, 9 undocumented (`app/watchlist/page.tsx` unused vars, `app/compare/page.tsx` stale disables).
- **Fix estimate:** 2–4h.

### F-20 — First-run for a stranger  **P2 · Runtime (partially)**
- Verified: `git clone` (local) + `npm install` = **7.4s** with warm npm cache (expect 1–3 min cold, not verified); `.env.example` copy documented; DB auto-creates (356KB scratch DB observed); prod boot to 200 in ~1s; bad-ticker error state is clean ("No quote data found for 'ZZZZQX'", `coldstart-badticker.png`).
- Gaps for a stranger: with no Ollama and no Devin key, every AI panel needs its fallback path — not exercised in this audit (see 03-not-verified); README says "defaults work out of the box" but AI features silently depend on a hosted Devin login or a running Ollama; the Python engine needs a `.venv` at an exact path (`lib/engine-python.ts` resolves `.venv/bin/python`) or /engine shows nothing; `SEC_USER_AGENT` defaults to the maintainer's email (F-17).
- Cold-start UX (fresh DB, hosted AI available): homepage renders a complete brief + empty-portfolio prompts correctly (`coldstart-home.png`); research works end-to-end. Genuinely good.
- **Fix estimate:** README truth pass 1–2h.

### F-21 — Test coverage gaps in the riskiest modules  **P2 · Static (verified against tests/)**
- No dedicated tests: `lib/black-scholes.ts` (0 tests, complex math), `lib/thematic-engine.ts`, `lib/yahoo.ts` / `lib/yahoo-screener.ts` (the data spine; F-07 lived here), `lib/news.ts`, `lib/rentcast.ts`, `lib/screener-in.ts` (has `tests/screener-in.test.ts` — partial). Valuation has `tests/valuation*.test.ts` but reverse-DCF convergence and the dcf.ts-vs-ic-engine consistency are untested. 2646 tests pass in 8.3s overall — the suite is real, but concentrated on AI plumbing/IC/home, thin exactly where wrong numbers on screen originate (data adapters, market-cap normalization).
- **Fix estimate:** targeted golden-number tests 1–2 days.

### F-22 — Root cause of F-02: "today's move" is three different quantities on one screen, and the grounding layer cannot catch any of them  **P0 · ON-CAMERA · Runtime (fully traced 2026-08-05 ~22:15)**
- **The three numbers, reproduced in one `GET /api/home` payload while the live quote was $309.10, −0.09%:**
  1. **"Weakest AAPL −7.6%"** (Today's Brief chip) = `portfolioPulse.worstPerformer.changePct = -7.601…` — this is **`unrealizedPct`, return since purchase cost, not a daily move at all**. `lib/home/pulse.ts:163-170` maps `h.unrealizedPct` into a field named `changePct`; `app/_home/modules/todays-brief.tsx:234-243` renders it as "Weakest" beside a "Today" stat. Verified: AAPL lots in `portfolio_lot` average ≈ $334.5 cost (buys 2026-07-17…-29 at $333–338); (309.10 − 334.53)/334.53 = −7.60% ✓. The mislabeling is acknowledged in a comment ("Movers are ranked on *unrealized return %*") but the UI presents it as today's action.
  2. **"AAPL down -8.7% … moved -8.7% today to $304.34"** (Attention card) = notification row id 36, **persisted 2026-07-31T13:31Z — five days ago** — by the alert monitor (`lib/monitor.ts:runMonitor` → `lib/alerts.ts:evaluatePortfolioAlerts:199` → `createNotifications`). It froze that morning's intraday quote (prev close ≈ $333.4, price $304.34) into prose containing the word "today", and the attention queue's 7-day alert TTL (`lib/home/attention.ts:KIND_TTL_MS.alert`) keeps re-serving it as current. Attention dedupe (`dedupeKey action:AAPL:high`) keeps the *highest-scoring* sibling — the oldest, most extreme −8.7% — while Recommended Actions shows all three variants.
  3. **"AAPL down -7.4%"** (Recommended Actions, twice) = notification rows 37–38, created **Saturday 2026-08-01 and Sunday 2026-08-02** — non-trading days. The monitor ran on the weekend, Yahoo served Friday's stale close (−7.4%, $308.91), and the 24h-window dedup key `pf:AAPL:move` lapsed each day, so the same Friday move was re-alerted twice as a fresh "today" event. Weekend/holiday runs will do this every week for any name still past the ±7% threshold.
- **Which is correct:** none, as a statement about today. Live change on 2026-08-05 was **−0.09%**. (−8.7% and −7.4% were *real* on 7/31; −7.6% is a real since-cost figure; each is stale or mislabeled in context.)
- **Same divergence on other tickers (verified):** TSM notification "up +8.0% today to $404.72" (7/30) vs live −0.18% @ $416.42; KB "+7.0% today to $120.29" (7/30) vs live +0.77% @ $120.90. NEM's "+7.1%" (created today) matches live +7.14% — the pipeline is correct when fresh, which is what makes the stale ones look credible.
- **Every codepath computing "daily change %" (sweep):**
  - `lib/yahoo.ts:51-55` — canonical: Yahoo `regularMarketChangePercent`, fallback `(price−prevClose)/prevClose`. Used by research header, watchlist, market-intel (`lib/home/market-intel.ts:157`), portfolio report aggregate (`lib/portfolio/report.ts:189-190`).
  - `lib/alerts.ts` — same quantity but **persisted at tick time** into notification prose; temporal fork (this finding).
  - `lib/home/pulse.ts:167` — **semantic fork**: `unrealizedPct` relabeled `changePct`.
  - `lib/movement-explainer.ts:219` — **third fork**: `windowReturn(history, days)` from daily history bars (lags/excludes live session), falling back to quote — the F-10 "slipped 0.15% vs header −0.29%" mismatch.
  - Close-to-close return series (consistent with each other, different from quote-day change): `lib/portfolio-analytics.ts:77`, `lib/portfolio/engines/series.ts:62`, `lib/portfolio/classes/market-base.ts:191,300`.
- **Grounding-layer implication (why this is proof, not just a bug):** every one of these figures is individually *real* — a genuine 7/31 intraday print, a genuine Friday close, genuine cost-basis P&L. `verifyGrounding` (lib/ai/grounding.ts) traces numbers to evidence; it has no concept of *as-of time*, *reference base (prev close vs cost)*, or *entity-period binding*, so any narration built on these inputs scores "high". The verification layer verifies transcription, not truth-in-context. This is the on-camera counterexample to the central claim.
- **Numeric format mismatches on the demo path (same figure, different renderings):**
  - `lib/home/brief.ts:126` embeds `toFixed(2)` into AI prose → "**+0.81%**", while every chip/stat uses `fmtSignedPct` (`app/_home/_viz/format.ts:12`, 1 digit) → "**+0.8%**". Same portfolio-day figure, two precisions, adjacent modules.
  - `lib/alerts.ts:91` `signed()` uses ASCII hyphen and produces "**down -8.7%**" double-negative prose; `fmtSignedPct` uses true minus "−". Both visible together on Today.
  - `lib/format.ts:62` `formatPercent` defaults to **2** digits; home dashboard wrapper defaults to **1**; market-intel ships raw unrounded floats (`0.09177236`) to the client for component-side formatting.
- **Fix estimate:** 6–10h — render one quote snapshot per payload with an as-of stamp; relabel/replace pulse movers with true day-change (or label "since cost"); make notification prose date itself ("on Jul 31") instead of "today"; skip monitor big-move alerts when market closed (`lib/market-hours.ts` exists); unify signed-percent formatting on one helper.
