---
name: uaa-ui-qa
description: Inspect, debug and QA UAA's UI like a senior frontend engineer — live browser inspection, runtime errors, performance traces, accessibility, visual checks
---

Workflow for verifying UAA's UI in a real browser. `tsc` passing is NOT proof a page renders — Turbopack can reject JSX that tsc accepts. Always verify visually or with `npm run build`.

## 1. Start the app the sanctioned way

```bash
scripts/ops/uaa start        # health gate, reaps orphans, exactly ONE dev server on :3000
```
Never launch a second dev server; `npm run dev` is gated by `uaa preflight` for a reason. Check with `scripts/ops/uaa status`.

## 2. Pick the right inspection tool

| Need | Tool |
|---|---|
| Runtime errors, route tree, server logs, Server Actions | `next-devtools` MCP → `nextjs_index` then `nextjs_call` (proxies Next 16's built-in `/_next/mcp`) |
| DOM inspection, clicking through flows, screenshots | `playwright` MCP |
| Performance traces (LCP/CLS/INP), network waterfall, CPU/network throttling, console | `chrome-devtools` MCP (from the chrome-devtools-mcp plugin) |
| Version-accurate Next.js docs | `next-devtools` MCP → `nextjs_docs` (reads `node_modules/next/dist/docs/`) |
| Component/library docs | `context7` MCP |

Expert workflows ship with the chrome-devtools plugin: `/chrome-devtools-mcp:a11y-debugging`, `/chrome-devtools-mcp:debug-optimize-lcp`, `/chrome-devtools-mcp:memory-leak-debugging`, `/chrome-devtools-mcp:troubleshooting`. Invoke them for those tasks instead of improvising.

## 3. Design-system rules to check against (from `app/globals.css`, ~1350 lines of semantic tokens)

- Dual theme via `data-theme` (dark default, light opt-in) — check BOTH themes for contrast regressions.
- Financial semantics: `--positive` / `--negative` / `--warning` express P&L direction and risk ONLY — flag any use as decorative chrome.
- Typography: Geist Sans (UI), Geist Mono (numbers/data), Source Serif (judgment prose only).
- No component library — primitives are hand-rolled; match existing `app/_components/` patterns.
- Numbers: tabular alignment in tables, formatting only via `lib/format.ts` / `lib/ic/format.ts`.

## 4. Accessibility audit (zero-install)

Use the plugin skill `/chrome-devtools-mcp:a11y-debugging`, or inject axe-core into any page via the browser MCP:
```js
// evaluate in page: load axe from CDN, then run
await import('https://cdn.jsdelivr.net/npm/axe-core@4/axe.min.js'); return await axe.run();
```
Report violations by impact (critical/serious first) with selector + fix. Keyboard-walk interactive flows (watchlist add, screener filters, portfolio dialogs) — focus states are part of the design system.

## 5. Performance pass

1. `chrome-devtools` MCP → `performance_start_trace`, load the route, stop, read the insights (LCP breakdown, layout shifts, long tasks).
2. Data-heavy routes (`/screener`, `/portfolio`, `/wire`, `/ic-report`) stream progressively — verify first content is fast and no request storms appear in the network panel (dedupe is a core architecture promise).
3. Bundle: `npm run build` prints First Load JS per route — compare before/after for your change. (No dev server running during build.)

## 6. Visual regression & e2e

- Playwright specs live in `e2e/` (prod build on :3111; auth-gated config on :3121). Add `expect(page).toHaveScreenshot()` assertions for pixel-level regressions where warranted.
- For quick evidence in a session, capture MCP screenshots of both themes at 1440×900 (the e2e viewport).

## 7. Repo-native visual harnesses (use these before writing new ones)

| Harness | What it does |
|---|---|
| `audit/visual/shoot.mjs` | Playwright screenshot batches: multiple routes × widths, reduced-motion mode → `audit/visual/shots/` |
| `node scripts/perf-baseline.mjs lcp\|fps\|heap` | LCP/FCP/TTI, long tasks, FPS, heap per key route (/, /research, /screener, /portfolio, /ic-report) |
| `node scripts/ink-verify.mjs [--reduced --hero-only]` | Landing ink-field legibility gates: coverage, keep-out, contrast, copy integrity (refs in `scripts/ink-ref/`) |
| `node scripts/kg-screenshot.mjs` | Knowledge-graph screenshots per scope at 1440/1024/390 |

- Design/motion work: invoke `/uaa-motion` (motion system + tokens) and `/uaa-visual-assets` (SVG/asset pipeline). For aesthetic direction on NEW surfaces, the `/frontend-design` skill applies — subordinate to `docs/brand-guidelines.md`.
- Figma context (when the user shares a Figma file): the `figma` plugin's MCP + skills (`/figma:figma-design-to-code`, `:figma-implement-motion`, …) — requires `devin mcp login figma`; free-beta, Starter plan is limited to ~6 tool calls/month, so batch questions.
