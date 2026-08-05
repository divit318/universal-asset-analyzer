# UAA Audit — Not Verified

Everything below was NOT checked at runtime, with what it would take to check
it. Findings elsewhere marked "Static" are code-inspection only.

## AI paths
- **Local (Ollama) inference path** — Ollama was down for the entire audit and
  you directed hosted-only testing. Every "local model" behavior — latency
  (the UI's "20–40s" claim), verdict quality on 7B/14B models, the
  hallucination classes AGENTS.md documents, the router's model-picking, the
  degraded-mode copy — is unverified. Need: `ollama serve` + one small model,
  rerun the verdict/copilot/red-team probes with `AI_PROVIDER_ORDER=ollama`,
  then `uaa stop` to drain (host rules).
- **No-AI fallback UI** (both providers unavailable) — `AI_RECOVERY_HINT`
  exists and AGENTS.md mandates it, but I did not boot an instance with
  `DEVIN_CLI_DISABLED=1` + no Ollama to see every panel's actual fallback.
  Need: one more scratch instance (~30 min).
- **Devin sessions API path** (`lib/ai/providers/devin/*`, "background tasks →
  sessions" policy) — only the CLI chain path was observed live.
- **Prompt injection via scraped news/filings into narration** — surface
  identified (unsanitized headlines in evidence; client-supplied `quote` in
  `POST /api/ai`), not exploited end-to-end. Need: a crafted RSS/news fixture
  or local proxy.

## Offline / network
- **True offline behavior** — I did not disconnect the machine's network
  (shared host; would break your other sessions). Cache-policy reasoning in
  F-15 comes from `lib/platform/registry.ts` + the egress subagent, not from
  a pulled cable. Need: `networksetup -setairportpower off` on a quiet host,
  walk the five demo pages against warm caches.
- **Exact payload bytes to api.devin.ai** — inferred from prompt-builder code
  and the CLI config; I did not packet-capture. Need: mitmproxy run.

## Engines
- **Python quant engine end-to-end** (`engine/daily_run.py`) — not rerun
  (multi-minute, 2.5GB DuckDB, live NSE/Yahoo fetches on a memory-pressured
  host). The negative live-OOS numbers are the engine's own last output
  (2026-08-02), taken at face value. Need: `.venv/bin/python -m
  engine.daily_run` (~10–30 min) and a check that /engine renders the fresh
  run.
- **HMM regime, Monte Carlo, Kelly, transaction-cost model internals**
  (engine/models/*.py) — no formula review at all (time). The Kelly=0.0%
  column on /engine's conviction book is unexplained (bug vs. cost-model
  outcome unknown).
- **Cross-checking more computed outputs against independent sources** — only
  SKHY market cap and AAPL price/FY-revenue arithmetic were independently
  cross-checked. A proper Phase 2 would sample ~20 names across P/E, EV/EBITDA,
  ROIC, FCF yield vs. two independent sources.
- **lib/ic/valuation-engine.ts vs lib/valuation/dcf.ts numeric divergence** —
  identified structurally (different discounting/fade assumptions); did not
  run both on identical inputs to quantify the fair-value gap. Need: 30-line
  tsx harness.
- **Backtest look-ahead/survivorship in callers of lib/backtest.ts** — the
  module itself is clean; whoever constructs its signal+return pairs was not
  traced.

## UI surface
- **Pages not walked:** /compare (AI verdict path untested live), /valuation
  workspace interactions, /calendar, /journal, /knowledge-graph, /thematic,
  /stocks/[symbol], /research/india, /research/manual, command palette,
  exports (Excel/PDF/CSV — only the stack-trace error path was code-verified),
  chart drawings, alerts firing, notifications panel, portfolio
  Optimize/Simulator/Risk Lab tabs. Each needs 5–10 min of scripted clicking.
- **F-11 black rendering on /engine** — reproduced only in the audit's
  Playwright Chromium on a swap-stressed host. Needs a human in a normal
  browser before treating as real (highest-value 2-minute manual check on
  this list).
- **Playwright e2e suite (`npm run test:e2e`)** — not run: it builds and boots
  a second server; the build alone was ~2 min and the host was already at 6
  uaa-doctor FAILs. Need: a quiet host, ~10 min.
- **Resolutions other than ~2560×1440, light theme, and reduced-motion mode**
  — not checked.

## Install
- **Truly cold `npm install`** — my clone install hit the warm npm cache
  (7.4s). A stranger's cold install time (and any postinstall surprises on
  Linux/Windows) is unverified.
- **Windows/Linux at all** — audit ran on the dev Mac only.
- **First-run with zero AI configured** (no .env.local, no Ollama, no Devin
  login) — the scratch instance inherited `.env.local` (Devin keys). The real
  stranger experience for AI panels is unknown; overlaps with the no-AI
  fallback item above.

## Security
- **Dependency CVE exploitability** — `npm audit` counts reported (F-17);
  no reachability analysis done.
- **SQLite corruption/recovery behavior** (kill -9 mid-write, disk full) —
  untested. The 170MB `app.db.bak-gld-repair` file suggests a past repair
  event worth asking about.
- **LAN exposure** — the server binds 0.0.0.0 (banner shows the LAN IP) and
  API routes have no auth; confirmed by banner only, not probed from a second
  device.
