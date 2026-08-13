# Devin Capability Registry

Inventory of the agent/developer tooling configured for UAA: skills, MCP servers, plugins,
and CLIs — what each is for, what it costs (everything here is $0), and what was deliberately
NOT installed. Produced by the 2026-08-11 extensibility audit.

Constraints this registry honors: **zero cost** (no subscriptions, no paid API keys),
**local-first** (no exporting source/portfolio/financial data to third parties beyond what the
user already configured), **minimum sprawl** (one good tool per capability).

---

## Installed Skills

### Repo-local skills (`.devin/skills/`, committed)

| Skill | Purpose | When Devin should use it |
|---|---|---|
| `/uaa-verify` | The verification gauntlet: `tsc` → `vitest` → `eslint` → `build` → e2e → live-AI, with the 16 GB host-health rules (never build while dev runs, worker caps, `uaa preflight`) | Before declaring any change complete |
| `/uaa-data` | Read-only inspection of `data/app.db` (41 tables), `data/engine.duckdb`, the Parquet scorecard, caches, `ai_call` ledger; debugging Yahoo/EDGAR/screener.in pipelines through UAA's own `lib/` code; `uv run --with …` for ad-hoc Python | Any data-layer, cache, or market-data-pipeline task |
| `/uaa-fincalc` | Financial-calculation validation: which engine owns which math, test-first with an independent scipy/numpy cross-check from `.venv`, tolerance/provenance rules, INR lakh/crore + pp-vs-% formatting rules, red flags that require stopping | Any change touching scoring, DCF/valuation, portfolio math, risk |
| `/uaa-ui-qa` | Institutional UI QA: `uaa start` discipline, which browser MCP to use for what, design-token rules from `app/globals.css`, axe-core a11y audit, perf-trace workflow, visual regression | Any UI change, visual bug, perf or a11y question |
| `/uaa-ai-platform` | AI-layer work: provider chain, task registry, the `ai-eval` gate for model repins, `ai_call` ledger queries, Ollama memory-safety rules for this host | Any change under `lib/ai/` or to model pins/prompts/schemas |

Format: standard `SKILL.md` (name + description frontmatter). Discoverable via `devin skills list`;
both user- and model-triggerable.

### Plugin skills (user-level, from chrome-devtools-mcp plugin)

`/chrome-devtools-mcp:chrome-devtools` (general DevTools usage), `:a11y-debugging`,
`:debug-optimize-lcp`, `:memory-leak-debugging`, `:troubleshooting`, `:chrome-devtools-cli` —
expert workflows written by the Chrome DevTools team for using the MCP tools below.

### Pre-existing user-level skills (unchanged)

- `graphify` (`~/.claude/skills/graphify`) — knowledge-graph build/query for any corpus.
  **Graph built 2026-08-11** (structural/AST, 0 LLM tokens): 9,035 nodes / 25,801 edges /
  288 labeled communities over `app lib engine scripts tests e2e` (1,220 code files; docs and
  images deliberately excluded — add later with `--update` + semantic extraction if wanted).
  Artifacts in `graphify-out/` (gitignored): `graph.json`, `graph.html`, `GRAPH_REPORT.md`.
  `graphify query "<question>"` is now live, activating the AGENTS.md `/graphify` workflow and
  the PreToolUse nudge hooks. Health note: 975 dangling-endpoint edges (~3.5%, normal for
  AST-only extraction) — flagged in `GRAPH_REPORT.md`.
- `devin-cli` (built-in) — Devin CLI documentation lookup.
- `declarative-repo-setup` (built-in) — generates `environment.yaml` for Devin cloud snapshots.

---

## Installed MCP Servers

| Server | Scope / config | Transport | Purpose & key tools | Cost / creds | Local? |
|---|---|---|---|---|---|
| `next-devtools` | **project**, `.devin/mcp_config.json` (added 2026-08-11, pinned `0.4.0`) | stdio (`npx`) | Official Vercel connector to Next 16's built-in `/_next/mcp`: `nextjs_index` / `nextjs_call` (live runtime errors, route tree, logs, Server Actions from the running dev server), `nextjs_docs` (version-accurate docs from `node_modules/next/dist/docs/`) | none | yes |
| `chrome-devtools` | **user**, via chrome-devtools-mcp plugin (pinned `1.7.0`) | stdio (`npx`) | Official Google Chrome DevTools for agents: performance traces + insights (LCP/CLS breakdown), network waterfall inspection, CPU/network throttling, console, screenshots, heap/memory tooling, full page automation (Puppeteer) | none | yes |
| `playwright` | user (pre-existing, `~/.claude.json`) | stdio (`npx @playwright/mcp`) | Browser automation: DOM snapshots, clicks, forms, screenshots. Complements chrome-devtools (Playwright semantics; the e2e suite is Playwright) | none | yes |
| `serena` | user (pre-existing, `~/.claude.json`) | stdio (`uvx`, oraios/serena) | Semantic code intelligence: `find_symbol`, `find_referencing_symbols`, symbol-level editing. AGENTS.md mandates it for symbol location | none | yes |
| `context7` | user (pre-existing, `~/.claude.json`) | HTTP | Third-party library documentation lookup | free tier, no key configured | cloud (docs queries only — never send UAA code/data) |
| `21st` | user (pre-existing, `~/.claude.json`) | HTTP | UI component search/generation (21st.dev) | **has an API key in `~/.claude.json`** — pre-existing user choice; see Security notes | cloud |

Duplication policy: the four pre-existing servers are defined once in `~/.claude.json`
(imported by Devin CLI via Claude-compat) and are intentionally **not** re-declared in
`.devin/` — one definition per server. New project-relevant servers go in
`.devin/mcp_config.json` (committed, no secrets); secrets, if ever needed, belong in
`.devin/mcp_config.local.json` (auto-gitignored) or `${env:VAR}` references.

---

## Installed Plugins

| Plugin | Source | Ships | Why selected |
|---|---|---|---|
| `chrome-devtools-mcp` v1.7.0 | `ChromeDevTools/chrome-devtools-mcp` (official Google, Apache-2.0, ~1.6M weekly npm downloads) | the `chrome-devtools` MCP server + 6 expert skills + an always-on usage rule | One install unit gives browser perf/debug/a11y capability **and** the vendor's own expert workflows; pins its own MCP version (1.7.0) so behavior is reproducible |
| `figma` v2.2.91 | `figma/mcp-server-guide` (official Figma Inc.) | remote Figma MCP (`https://mcp.figma.com/mcp`, OAuth via `devin mcp login figma`) + 12 design-workflow skills | Official design-context integration; free during Figma's beta on all plans (Starter ≈6 tool calls/month). See `docs/UAA_VISUAL_CAPABILITY_STACK.md` |

Installed user-level via `devin plugins install ChromeDevTools/chrome-devtools-mcp -y`.
Update with `devin plugins update chrome-devtools-mcp`.

---

## Installed CLIs (Homebrew)

| CLI | Version | Purpose |
|---|---|---|
| `duckdb` | 1.5.5 | One analytical CLI for every UAA data store: `data/engine.duckdb` (`-readonly`), Parquet (`SELECT … FROM 'data/*.parquet'`), SQLite (`sqlite_scan`), CSV/JSON. Replaces "read the venv scripts to see the data" |
| `gitleaks` | 8.30.1 | Secret scanning (working tree + full git history). Config: `.gitleaks.toml` (allowlists the fake keys in `tests/*.test.ts`). History scanned 2026-08-11: **clean** (1 finding = test fixture, allowlisted) |

Already present and relied upon (not newly installed): `gh` (authenticated, repo+workflow
scopes — covers all GitHub inspection/PR/issue/CI workflows), `sqlite3` (use
`"file:data/app.db?mode=ro"`), `uv`/`uvx`, `ollama`, Playwright browsers, `.venv/` with the
full Python quant stack (polars, duckdb, pandas, numpy, scipy, statsmodels, sklearn, xgboost,
yfinance).

---

## Not Installed (deliberate decisions)

| Candidate | Reason | Creds? | Cost? | Reconsider when |
|---|---|---|---|---|
| GitHub MCP server | Redundant: `gh` CLI is authenticated and covers repos/PRs/issues/Actions with finer-grained, scriptable output | PAT/OAuth | free | gh CLI ever becomes unavailable |
| SQLite / Postgres MCP servers | Redundant: `sqlite3` + `duckdb` CLIs cover it read-only with less machinery; writes must go through `lib/db.ts` anyway | none | free | a networked DB is ever adopted |
| yfinance / market-data MCPs (community) | Wrong layer: debugging must exercise UAA's own `lib/yahoo.ts` etc., not a parallel data path; community servers are also a supply-chain risk for a finance codebase | none | free | never — prefer `/uaa-data` patterns |
| SEC EDGAR MCPs (community) | Same reasoning; EDGAR full-text search + submissions APIs are trivially reachable via `lib/edgar.ts` / curl with `SEC_USER_AGENT` | none | free | building a filings-research feature that needs XBRL parsing beyond `lib/edgar.ts` |
| FRED / macro-data MCPs | Requires a (free but real) API key; UAA has `lib/` macro sources already; not needed for development | API key | free tier | macro research features expand |
| Brave/Tavily/Exa search MCPs | Devin has built-in `web_search`/`webfetch`; these need paid/keyed accounts | API key | paid | never, unless built-ins regress |
| Sentry MCP | UAA uses `@sentry/nextjs` in-app, but the MCP needs a cloud Sentry org token; error triage works fine via local logs + the `ai_call` ledger | org token | free tier | team adopts hosted Sentry triage workflows |
| Semgrep (SAST) | Heavier install; marginal over `eslint` + `npm audit` + `gitleaks` for a local-first single-dev app today | none | free | before any public deployment or multi-contributor phase |
| Percy/Chromatic visual regression | Paid SaaS; Playwright `toHaveScreenshot()` covers local visual regression | account | paid | never under zero-cost policy |
| `@next/bundle-analyzer` | Requires editing `next.config.ts` (app config) for a dev-only concern; `npm run build` already prints per-route First Load JS | none | free | a real bundle-size investigation is needed |
| `@axe-core/playwright` devDependency | Would touch `package.json`/CI and could fail CI on pre-existing issues; a11y audits run via the chrome-devtools plugin skill / axe CDN injection instead | none | free | the team decides to enforce a11y in CI |
| Devin-hosted GitHub/Slack/etc. integrations | Not configurable from the CLI environment; nothing needed today | OAuth | — | team workflows demand them |

---

## Security Notes

- **No secrets were added anywhere.** `.devin/mcp_config.json` is committed and contains none;
  the pattern for future secret-bearing servers is `.devin/mcp_config.local.json` (gitignored)
  or `${env:VAR}` expansion.
- Everything newly installed is an **official vendor artifact** (Google Chrome DevTools team,
  Vercel, DuckDB Foundation, Gitleaks) with pinned versions (`chrome-devtools-mcp@1.7.0`,
  `next-devtools-mcp@0.4.0`).
- Git history was scanned with gitleaks: clean (the single hit is a fake key in
  `tests/ai-keys.test.ts`, now allowlisted in `.gitleaks.toml`).
- Pre-existing observation, not changed by this audit: `~/.claude.json` holds a 21st.dev API
  key in plaintext (user-level file, outside the repo). If that service is no longer used,
  consider removing the server entry; it is the only configured integration that sends
  requests to a third party with a credential.
- The local-first posture is preserved: the only cloud-touching tools are `context7`
  (doc queries), `21st` (pre-existing), and `web_search` — none receive UAA source, portfolio,
  or financial data as part of normal use.

---

## Config Locations Changed by This Audit

| Path | Change |
|---|---|
| `.devin/mcp_config.json` | **new** — project MCP servers (`next-devtools`) |
| `.devin/skills/uaa-{verify,data,fincalc,ui-qa,ai-platform}/SKILL.md` | **new** — 5 repo skills |
| `.gitleaks.toml` | **new** — scan config + test-fixture allowlist |
| `AGENTS.md` | "Tools You Have" table extended; repo-skills index added |
| `docs/DEVIN_CAPABILITY_REGISTRY.md` | **new** — this file |
| `~/.local/share/devin/cli/plugins/…` (user-level, not in repo) | chrome-devtools-mcp plugin v1.7.0 installed |
| Homebrew (machine-level) | `duckdb` 1.5.5, `gitleaks` 8.30.1 installed |

---

## Devin Cloud Snapshot Blueprint (2026-08-11)

The org blueprint `snapshot-blueprint-be0b2c9b49564336bb08a6d4441663c5`
(repo `divit318/universal-asset-analyzer`) was overwritten — it existed but had never built
(`current_version_id: null`) — with a sandbox-verified `environment.yaml`:

- **initialize**: nvm Node 26 (node:sqlite) → `npm ci` → `.venv` + `requirements.txt` →
  Playwright chromium. Every step was executed and verified in a fresh cloud sandbox first
  (`tsc` silent; **2697 tests passed** in 8.5s).
- **maintenance**: incremental `npm install --prefer-offline` + pip sync.
- **knowledge**: typecheck / lint / test / build / e2e / startup / env — including the
  cloud-specific rule `UAA_SKIP_PREFLIGHT=1 npm run dev` (the predev host gate is
  macOS-only) and the "never LIVE_AI=1 without approval" spend guard.
- No secrets are stored in the blueprint; optional envs (SEC_USER_AGENT, NEWSAPI_KEY,
  RENTCAST_API_KEY) are documented as knowledge instead.

---

## Future Opportunities

- **Semantic layer for the knowledge graph** — extend the structural graph with the 120
  markdown docs (`graphify <path> --update` + semantic extraction) so "why" questions link
  design docs to code. Costs LLM tokens; deferred.
- **Coverage reporting** — vitest supports `--coverage` (needs `@vitest/coverage-v8`); adopt
  when the team wants coverage gates on the financial engines.
- **Semgrep + `npm audit` in CI** — when UAA approaches deployment or multi-contributor
  development.
- **If new asset classes / data providers land** — revisit provider-specific tooling (e.g.
  FRED key for macro, XBRL tooling for deep filings work) under the same zero-cost,
  local-first filter.
- **If deployment infrastructure lands** — Dockerfile, healthcheck endpoint, and an APM story
  become relevant; none installed today because UAA is deliberately local-only.
