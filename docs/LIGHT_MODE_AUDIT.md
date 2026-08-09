# Light Mode Overhaul — Audit Log

Running log for the light-mode parity effort. Dark mode is the reference
implementation; every change below is verified in both themes.

Started: 2026-08-08.

---

## Phase 1: System map

### 1.1 Theming mechanism

- Theme is set as `data-theme="dark" | "light"` on `<html>`, controlled by
  `app/_components/theme.tsx` (`useTheme()`, `ThemeToggle`, no-flash init
  script `THEME_INIT_SCRIPT` injected in `app/layout.tsx`). Stored under
  `localStorage["uaa-theme"]`. Dark is the SSR + fallback default.
- **No `next-themes`, no `.dark` class, no `@custom-variant dark`.** This means
  any Tailwind `dark:` variant in the codebase responds to the OS
  `prefers-color-scheme` media query, NOT the app theme — every `dark:` usage
  is therefore a latent bug (found 6 call sites, see §1.4).
- Tokens are defined per-theme in `app/globals.css`:
  - Dark under `:root, [data-theme="dark"]` (lines ~170–239)
  - Light under `[data-theme="light"]` (lines ~242–303)
  - `@theme inline` maps each token to Tailwind v4 utilities (`bg-surface`,
    `text-muted`, `border-border`, `text-positive`, `bg-chart-1`, …).
- Charts: Recharts can't reliably resolve `var()` in SVG presentation
  attributes, so `app/_components/chart-theme.ts` keeps literal hex for both
  themes and swaps at runtime via `useChartTheme()`. It also retains **legacy
  static dark-only exports** (`CHART_AXIS`, `chartTooltipStyle`, …) that any
  unmigrated chart will render dark-on-light.
- One scoped light-mode override exists: `.ic-report-scope` re-declares
  `--positive/--negative` under `[data-theme="light"]` (globals.css tail) —
  now redundant since the global light tokens carry the same values.

### 1.2 Token inventory (semantic roles)

| Token | Role | Dark | Light (current) |
|---|---|---|---|
| `--background` | page canvas | `#0a0b0e` | `#f7f8fa` |
| `--surface` | card/input base | `#131519` | `#ffffff` |
| `--surface-2` | nested surface / hover | `#1a1d23` | `#f4f6f9` |
| `--surface-3` | deepest nesting / active | `#23272f` | `#e9edf2` |
| `--border` | default border | `#282d37` | `#e2e6ec` |
| `--border-strong` | emphasized border / scrollbar | `#384049` | `#cdd4dd` |
| `--foreground` | primary ink | `#edeff2` | `#101722` |
| `--muted` | secondary text | `#99a3b2` | `#56606f` |
| `--faint` | tertiary/disabled text | `#626c7a` | `#8a94a2` |
| `--brand` | brass accent (chrome, focus ring, verdicts) | `#c8a96e` | `#7a5f33` |
| `--brand-strong` | hover brass | `#e2c489` | `#5f4a26` |
| `--brand-muted` | brass tint fill | 12% mix | 10% mix |
| `--accent`/`--accent-strong` | legacy alias of brand | alias | alias |
| `--positive` | gains | `#4ade80` | `#15803d` |
| `--negative` | losses | `#f87171` | `#b91c1c` |
| `--warning` | caution (signal orange) | `#fb923c` | `#c2540a` |
| `--alert` | tripwire violet | `#b585fa` | `#7c3aed` |
| `--chart-1..5` | categorical series | purple/steel/teal/pink/slate | darkened variants (chart-5 shared) |
| `--shadow-card/popover/glow-brand` | elevation | black-based | ink-based |
| `--grid-line` | chart gridline utility | white 4% | ink 4% |
| `--panel-top/bottom/hover-top` | machined panel gradient | graphite | white→#f4f6f9 |
| `--edge-top` / `--edge-hairline` | specular rim / panel border | white 10% / 5.5% | white 100% / ink 8% |
| `--depth-1/2` | panel shadows | heavy black | soft ink |
| `--overhead-light`, `--panel-sheen` | ambient light | white 5% / 6% | ink 2.2% / white 70% |
| `--hairline` | hairline border utility | white 6% | ink 7% |

Grade/score/sentiment colors are NOT tokens — they are hardcoded per component
(see §1.4), which is a primary source of light-mode failures.

### 1.3 Route tree (all surfaces to audit)

App shell: `app/layout.tsx` → `AppShell` (site-header w/ nav + theme toggle,
site-footer, toast provider, command palette ⌘K, AI assistant drawer,
notification bell, boot splash).

| Route | Surface | Notes |
|---|---|---|
| `/` | Today dashboard | module registry: brief, book, radar, attention queue, market intel, sector rotation; A–F grade colors |
| `/wire` | The Wire | opportunity cards, causal chains, sector rotation, evidence drawer |
| `/screener` | Screener | filter form, results table, saved screens, score chips |
| `/engine` | Quant Engine | regime hero, factor lab, model health, desk rail, conviction book |
| `/thematic` | Thematic | 10-stage framework, tier badges; own error.tsx |
| `/research` | Research Hub | quote, interactive + candle charts, chart workspace (kline), filings, news, copilot, decision cards |
| `/research/india` | India research | ownership timeline, financial charts |
| `/research/manual`, `/research/manual/[id]` | manual notes | |
| `/compare` | Compare | equity + class compare views, radar/scatter/futures-curve/performance charts, flip cards |
| `/valuation`, `/valuation/register` | Valuation case + register | MOS coloring (`text-yellow-500`) |
| `/ic-report` | IC Report | 9-agent pipeline, valuation tab, `.ic-report-scope` overrides, PDF export (out of scope — print) |
| `/knowledge-graph` | Knowledge Graph | canvas graph reads tokens via getComputedStyle; inspector |
| `/portfolio` | Portfolio | holdings, allocation panel (hardcoded 8-color palette), universal panels, optimize |
| `/watchlist` | Watchlist | alerts, notes |
| `/calendar` | Calendar | event type colors (blue/emerald hardcoded), event drawer |
| `/journal` | Decision Journal | |
| `/stocks/[symbol]` | Stock redirect/page | |
| `/settings`, `/settings/account` | Settings | forms, provider keys |
| `/landing` | Marketing page | own layout, auth modal, hero-flow canvas particles |
| `/dev/tokens` | Token reference sheet | useful for verification |
| `/dev/ai` | AI dev panel | |
| `app/error.tsx`, `app/thematic/error.tsx` | error surfaces | |
| Overlays | ⌘K palette, AI assistant, dialogs, notification popover, toasts, symbol search | `bg-black/40–60` scrims (acceptable both themes, verify) |

Primitives: `app/_components/ui/` — badge, button, card, data-table,
date-input, input, page-shell, password-input, score-chip, section, skeleton,
stat-tile, tabs, task-progress. Plus `uaa-card`/`uaa-hero` (machined panel
CSS), `.uaa-skeleton`, focus ring, scrollbar, selection in globals.css.

### 1.4 Theme-hostile pattern inventory (grep, complete as of start)

**A. Hardcoded hex constants in components (dark-palette values used in both themes):**
- `app/research/_components/charts.tsx:27-29` — `POSITIVE #4ade80`, `BLUE #60a5fa`, `AMBER #fbbf24`
- `app/research/_components/valuation-history-chart.tsx:20-21` — `BLUE #60a5fa`, `AMBER #fbbf24`
- `app/research/_components/candle-chart.tsx:30-34` — BLUE/AMBER/PURPLE/TEAL/ORANGE dark hexes + rgba fills at 842-844
- `app/research/india/_components/financial-charts.tsx:20-23` — dark POSITIVE/AMBER/BLUE/NEGATIVE
- `app/research/india/_components/ownership-timeline.tsx:16-21` — HOLDER_COLORS dark palette (+fallback `#9aa3af` ×6)
- `app/compare/page.tsx:70` — `COLORS` series (dark pastels: `#a78bfa #38bdf8 #2dd4bf #fbbf24 #f472b6`)
- `app/compare/_components/compare-chart.tsx:363,740,811` — `fill="#fff"`, `ReferenceLine stroke="#4b5563"`
- `app/compare/_components/class-performance-chart.tsx:122,307` — `fill="#fff"`, `#4b5563` reference line
- `app/engine/_components/factor-lab.tsx:28-34` — factor color map (dark pastels)
- `app/portfolio/_components/universal/allocation-panel.tsx:33-40` — 8-color palette (validated only against dark `#1a1d23`); rows 149,187 use `rgb(255 255 255/…)` hatching — invisible/wrong on light
- `lib/engine-desk.ts:58-62` — regime colors `#22c55e #3b82f6 #f59e0b #ef4444 #dc2626`
- `app/research/_components/chart-workspace/overlays/risk-reward.ts:30,39` — rgba dark positive/negative fills
- `app/ic-report/_components/valuation-tab.tsx:243` — `var(--muted, #6b7280)` (fallback fine, verify)
- `lib/ic/export-pdf.ts` — print palette, **out of scope** (paper, not themed UI)
- `lib/brand/mark.ts:102-103` — already theme-paired, OK

**B. Tailwind color literals (no theme adjustment) — 67 matches in app/, 40 in lib/:**
- Badge/pill recipes built on `-400` shades (tuned for dark): calendar event
  types (`app/calendar/page.tsx:18-20`, `event-drawer.tsx:11-13`),
  `investment-personality-badge.tsx`, `portfolio-fit-badge.tsx`,
  `portfolio-fit-panel.tsx`, `sector-context-card.tsx`,
  `macro-context-ladder.tsx`, `portfolio-decision-card.tsx`,
  `causal-chain.tsx`, `sector-rotation-panel.tsx` (+wire variant),
  `model-health.tsx`, `opportunity-card.tsx` (ScoreBar colors + glow shadows),
  `interactive-chart.tsx` / `candle-chart.tsx` / `kline-chart.tsx` toggle chips
  (`text-blue-400`, `text-purple-400`…), `compare/page.tsx` +
  `class-compare-view.tsx` series chips, `lib/market.ts:156-162` region badges,
  `lib/ios/types.ts:347-350` objective chips, `lib/engine-desk.ts:36-40` stance
  chips, `screener/page.tsx:974` rose error card, `saved-screens.tsx:79`,
  `valuation-strip.tsx:68` / `valuation/page.tsx` `text-yellow-500` MOS tier.
- `text-amber-500`, `text-yellow-500` on white ≈ 1.6–2.2:1 — worst offenders.

**C. `dark:` variants (respond to OS, not app theme — always wrong here):**
- `app/compare/page.tsx:966,968`; `app/compare/_components/class-compare-view.tsx:378,380`;
  `app/valuation/page.tsx:286,291`; `app/valuation/register/page.tsx:121`;
  `app/screener/_components/results-table.tsx:150` — all
  `text-amber/yellow-600 dark:text-…-400/500` warning banners.

**D. Opacity-on-black scrims:** dialog/command-palette/ai-assistant/chart-workspace
use `bg-black/40–60` — verify acceptable in light (industry-standard scrim).

**E. Legacy static chart exports (dark-only)** in `chart-theme.ts:108-117` —
must find remaining consumers and migrate them to `useChartTheme()`.

**F. Inline `style={{…color/background…}}`** — 26 files (mostly chart configs
already parameterized by chartTheme or CSS vars; each verified individually in
Phase 2; compare/* and india/* carry literal colors from the A-list).

### 1.5 Judgment calls so far

- Graphify knowledge graph not rebuilt (repo already carries `graphify-out/`);
  direct token/grep mapping was faster and complete for a theming audit.
- Working tree already contains ~116 modified files of unrelated in-progress
  work (landing redesign, AI platform, portfolio engines). Light-mode commits
  will stage **only files this effort touches**; no `git add -A`.
- `lib/ic/export-pdf.ts` colors are for the PDF artifact (white paper), not
  the themed UI → out of scope.

---

## Phase 2: Defects

Method: full-page screenshots of 22 routes × 2 themes × 3 viewports
(`.audit/screenshots/{theme}/{route}@{width}.png`) plus 7 interaction states
(⌘K palette, notifications, AI assistant, research Analysis/Financials tabs,
calendar drawer, settings forms), captured with Playwright against the dev
server. Programmatic WCAG sweep (`.audit/capture.mjs contrast`) walked every
visible text node on every route in light mode, compositing effective
backgrounds and computing exact ratios (`.audit/contrast-light.json`).

Overall verdict: the token skeleton is sound (surfaces, borders, elevation and
the machined-panel system translate well), but light mode fails wherever color
was chosen as a literal instead of a token: every `-400`-weight Tailwind badge
recipe, every hardcoded chart constant, `--faint` and `--warning` themselves,
and every `dark:` variant (which binds to the OS, not the app theme, because
no `@custom-variant dark` exists).

### Blocking (token layer)

| # | Defect | Evidence | Fix |
|---|---|---|---|
| B1 | `--faint` #8a94a2 = 2.89:1 on `--background`, 3.07:1 on white. Used as real helper text everywhere (engine captions ×30, journal meta, research micro-labels, ⌘K kbd, stat labels). Single biggest failure class: ~70% of all contrast failures. | contrast-light.json: engine (35), journal (5), research (6), home (4)… | Darken light `--faint` → #656f7d (4.79 bg / 5.09 white / 4.70 s2). Darken light `--muted` → #4d5564 to preserve the muted↔faint hierarchy gap. Dark values untouched. |
| B2 | `--warning` #c2540a = 4.33:1 on `--background`, 4.25:1 on `--surface-2` (passes only on white). Fails on home Threat badge, watchlist %-to-target, calendar AI chip, portfolio currency tag, india Fair/Cyclical chips, compare score chip. | contrast-light.json ×8 | Darken light `--warning` → #ad4a08 (5.26 bg / 5.59 white / 5.16 s2 / 4.75 s3). Same hue family (signal orange). Sync chart-theme.ts LIGHT.warning. |
| B3 | No `dark:`/`light:` custom variants: Tailwind's default `dark:` = `prefers-color-scheme`, so all 6 `dark:` call sites follow the OS while the app follows `data-theme` — wrong in both directions. | grep §1.4-C | `@custom-variant dark/light` bound to `[data-theme]` in globals.css. Unlocks safe per-theme overrides for the mechanical pass. |

### Major (component/primitive layer — dark-tuned literals)

| # | Defect | Where |
|---|---|---|
| M1 | Engine regime hero "Bull" #22c55e = 2.10:1; REGIME_COLOR map is one dark-only hex set also feeding SVG gradients. | `lib/engine-desk.ts:57-63`, regime-hero, factor-lab |
| M2 | SIGNAL_TONE `text-emerald-400` (1.95:1 on white), `text-red-500` for STRONG tiers. | `lib/engine-desk.ts:35-41` |
| M3 | Research/India/Compare chart constants are the dark palette verbatim: BLUE #60a5fa, AMBER #fbbf24 (1.9:1 on white), POSITIVE #4ade80, NEGATIVE #f87171; margin-trend legend, revenue bars, valuation history line, candle SMA/BB overlays, volume bars all wash out on white (screenshots research-financials-tab light vs dark). | `charts.tsx`, `valuation-history-chart.tsx`, `candle-chart.tsx`, `india/financial-charts.tsx`, `ownership-timeline.tsx`, `factor-lab.tsx` |
| M4 | Compare categorical palette: COLORS_LIGHT[1] #0284c7 = 3.78–4.10:1 as symbol text (MSFT everywhere on compare-run). | `app/compare/page.tsx:75` |
| M5 | Calendar event system blue: `text-blue-400` chips/links (≈2.2:1 on white) — EARNINGS/WATCHLIST chips, CRWD links, next-earnings stat. | `calendar/page.tsx:18`, `event-drawer.tsx:11` |
| M6 | Badge recipes on `-400`/`-500` literals across 20+ components (personality, fit, sector-strength, causal-chain, region, objective chips, MOS `text-yellow-500` ≈1.8:1, saved-screens rose, screener amber warnings). | §1.4-B list |
| M7 | Warning banners `text-yellow-600 dark:text-yellow-400` — broken twice (OS-bound + yellow-600 2.8:1 on light bg). | compare, valuation ×2, register, class-compare-view |
| M8 | Allocation panel: cash-slice hatch uses `rgb(255 255 255/…)` (invisible on white); palette entries #c98500/#9085e9 below 3:1 as fills on white; palette validated only against dark surface. | `allocation-panel.tsx:33-40,149,187` |
| M9 | Reference lines `stroke="#4b5563"` + `fill="#fff"` labels hardcoded in compare charts. | `compare-chart.tsx`, `class-performance-chart.tsx` |
| M10 | Wire opportunity-card verdict glows `shadow-[0_0_0_1px_rgba(74,222,128,0.05)]` etc. — dark-tuned rgba glows. | `opportunity-card.tsx:26-36` |
| M11 | Risk/reward chart-workspace overlay fills rgba(74,222,128)/rgba(248,113,113) dark values. | `overlays/risk-reward.ts` |
| M12 | Legacy static dark-only exports (CHART_AXIS, chartTooltipStyle…) still exported; any consumer renders dark chrome on light. | `chart-theme.ts:106-117` |

### Minor / polish

- P1 dev/tokens reference sheet hardcodes displayed hex — must follow token changes.
- P2 `.ic-report-scope` light override now redundant (values equal global) — remove to stop future drift.
- P3 candle-chart signal markers rgba(154,163,175) neutral — fine both themes, but centralize.
- P4 Scrims `bg-black/40-60`: verified acceptable in light (standard dimming) — no change.
- P5 knowledge-graph canvas reads tokens at runtime (adapts); edge/series colors come from chart tokens — verify after token pass.

### Non-defects (explicitly cleared)

- Surface hierarchy, card elevation, machined panels, shadows: light values already purpose-designed (§1.2) and read correctly in screenshots.
- Focus ring (brass, 2px outline) visible in both themes.
- Skeleton shimmer (foreground-mix) works in both.
- Landing page: 0 contrast failures, reads as deliberate light design.
- settings/settings-account: 0 failures.
- dev-tokens "failures" on dark swatches are the dark-token gallery rendering dark tiles inside light mode — intentional display, excluded.


---

## Phase 3: Implementation

All changes verified by `tsc --noEmit` (clean), `npm run lint` (only pre-existing
errors in files untouched by this effort), `npm test` (2924 passed / 3 skipped).

### 3.1 Token layer (globals.css)

- **`@custom-variant dark` / `@custom-variant light`** added, bound to
  `[data-theme]`. Fixes the latent bug where `dark:` variants followed the OS
  instead of the app theme, and gives the mechanical pass a safe instrument:
  `light:` overrides change nothing in dark (verified at runtime — a test
  element with `text-yellow-600 dark:text-yellow-400 light:text-teal-700`
  resolves per data-theme).
- **Light `--faint`** #8a94a2 → **#656f7d** (2.89 → 4.79:1 on background).
- **Light `--muted`** #56606f → **#4d5564** (5.99 → 7.18:1) to preserve the
  muted↔faint hierarchy gap. Chart axis (`chart-theme.ts` LIGHT.axis/axisTick)
  synced.
- **Light `--warning`** #c2540a → **#ad4a08** (4.33 → 5.26:1 on background;
  passes on every surface incl. surface-3 at 4.75). Same signal-orange hue.
  `chart-theme.ts` LIGHT.warning synced.
- Removed the now-redundant `.ic-report-scope` light override block (values
  identical to global tokens since 2026-08-07) + its className in
  `ic-report/page.tsx` — drift-risk elimination.
- `dev/tokens` reference sheet updated to the new light hex values.
- Dark token block: **untouched**.

### 3.2 Chart theming (centralized)

`ChartTheme` extended with named auxiliary hues (`blue amber purple teal
orange pink neutral referenceLine`), dark values = the exact literals charts
used before (zero dark change), light values deepened to ≥4.5:1. Legacy static
dark-only exports (CHART_AXIS, chartTooltipStyle, …) deleted — zero consumers
remained. Migrated to `useChartTheme()` colors:

- `research/_components/charts.tsx` (margin trend, revenue/FCF, peer radar)
- `research/_components/valuation-history-chart.tsx`
- `research/_components/candle-chart.tsx` (SMA/BB/MACD/RSI/volume + tooltips;
  signal badges now color-mix from semantic tokens instead of dark rgba)
- `research/_components/interactive-chart.tsx` (SMA overlays resolve from
  ct.series; PriceTooltip takes explicit sma colors)
- `research/india/_components/financial-charts.tsx` (all four charts)
- `research/india/_components/ownership-timeline.tsx` (HOLDER_COLORS theme
  pair + useHolderColors())
- `engine/_components/factor-lab.tsx` (FACTOR_COLOR theme pair)
- `lib/engine-desk.ts` REGIME_COLOR theme pair + `regimeColor(label, theme)`;
  consumers (regime-hero, detail-panel, desk-primitives RegimeChip) resolve
  via useTheme(). SIGNAL_TONE strong tiers get light: variants.
- `compare/_components/{compare,class-performance}-chart.tsx` reference lines
  `#4b5563` → `ct.referenceLine`.
- `compare/page.tsx` COLORS_LIGHT sky slot #0284c7 → #0369a1 (3.78 → 5.58:1).
- `chart-workspace/overlays/risk-reward.ts` zones resolve `--positive` /
  `--negative` at draw time via new `themeToken()` in style-utils (overlays
  register once, so tokens are read per-draw); overlay ratio text uses
  `--foreground`.

### 3.3 Mechanical class pass (badges, chips, banners)

Convention: where a literal's dark value exactly equals a token's dark value,
the class moved to the semantic/categorical token (blue-400 → chart-2,
orange-400 → warning) — pixel-identical in dark, auto-adapting in light.
Everywhere else, `light:` overrides deepen the hue (-400 → -700 text, -600
non-text fills) with dark untouched:

- calendar page + event-drawer: earnings blue system → chart-2; dividend
  emerald → light: variants
- engine-desk SIGNAL_TONE, model-health, factor-lab (above)
- portfolio-fit-badge/-panel "good" tier emerald
- sector-context-card, macro-context-ladder, sector-rotation-panel (×2 wire)
  strengthening/weakening chips
- investment-personality-badge (all 8 tags), portfolio-decision-card REDUCE →
  warning family (orange-400 ≡ warning in dark)
- causal-chain: macro → chart-2, commodity → warning (was already visually
  identical to policy in dark since orange-400 ≡ --warning), market purple →
  light: variant
- opportunity-card: score bars → chart-2 / light:bg-purple-600; verdict glow
  rgba(74,222,128,…) → color-mix(var(--positive))
- interactive-chart / candle-chart / kline-chart toggle chips
- compare + class-compare-view + valuation ×2 warning banners: broken
  `text-yellow-600 dark:text-yellow-400` → `text-yellow-400
  light:text-yellow-700` (dark rendering preserved exactly)
- valuation MOS tier + valuation-strip `text-yellow-500` → + light:yellow-700
- screener error card (rose), saved-screens delete hover, results-table amber
  warnings
- lib/market.ts region badges (IN → warning, EU → chart-2, others light:
  variants), lib/ios/types.ts objective chips
- allocation-panel: hatch stripes `rgb(255 255 255/…)` → color-mix from
  `--foreground` (visible in both themes); categorical palette re-validated —
  every slot ≥3:1 on white (worst 3.07) — deliberately kept theme-neutral

### 3.4 Cleared during implementation

- Knowledge-graph canvas: fills/strokes are `var(--token)` resolved at render
  + PNG export inlines computed tokens — fully theme-driven, no change (P5).
- Dialog/palette/assistant scrims (`bg-black/40-60`): standard dimming in both
  themes, kept (P4).
- `lib/ic/export-pdf.ts`: print artifact, out of scope.
- chart-workspace DEFAULT_LINE / readRectStyle #60a5fa fallbacks: user-picked
  drawing colors from the toolbar; defaults only. Left alone (logged).

---

## Phase 4: Verification

### 4.1 Programmatic contrast re-check (light, 1440px, every route)

`node .audit/capture.mjs contrast theme=light` after implementation:

| Route | Failures before | after |
|---|---|---|
| home | 4 | **0** |
| wire / screener / thematic / research-hub / compare-landing / valuation / valuation-register / ic-report / knowledge-graph / settings | 1 each (⌘K kbd `--faint`) | **0** |
| engine | 35 | **0** (after Bull → #166534 fix: the RegimeChip text sits on its own 9% tint, where green-700 measured 4.42) |
| research-aapl | 6 | **0** |
| research-india | 8 | **0** |
| compare-run | 13 | **0** |
| portfolio | 2 | **0** |
| watchlist | 3 | **0** |
| calendar | 2 | **0** |
| journal | 5 | **0** |
| settings-account / landing | 0 | **0** |
| dev-tokens | 9 | 4 — all four are dark-theme token swatch tiles deliberately rendered inside light mode (the token gallery shows both themes side by side); documented exclusion, not a defect |

**Zero text-contrast failures below 4.5:1 (normal) / 3:1 (large) on every
product surface in light mode.**

### 4.2 Dark regression diff (pixel diff vs Phase 2 baseline, threshold Δ12/channel)

| Route | Diff | Explanation |
|---|---|---|
| compare-landing, engine, journal, research-hub, settings, thematic, valuation-register | 0.00% | identical |
| screener | 0.01% | live prices |
| valuation 0.11%, research-india 0.13% | live quote digits |
| dev-tokens | 0.32% | the reference sheet intentionally displays the new light hex strings |
| home | 1.60% | live dashboard (timestamps, quotes, radar) |
| knowledge-graph | 9.60% | force-directed layout is randomly seeded per load — node positions differ, colors identical |
| watchlist | 10.32% | list gained a row between runs (MSFT alert appeared); rows shifted |
| landing / settings-account / research-aapl / portfolio / wire / compare-run / calendar / ic-report | size mismatch | live content changed page height between captures (e.g. ic-report baseline caught the empty state, re-run caught a generated report); side-by-side inspection shows chrome/colors unchanged |

Dark research Financials tab (the surface with the most migrated chart code)
re-captured and visually compared: bars, margin lines, valuation history, SMA
chips identical to baseline — the migrated `ct.*` dark values are the exact
old literals by construction.

### 4.3 Full re-capture

22 routes × 2 themes × 3 viewports (1440/1024/390) in
`.audit/screenshots/{theme}/{route}@{width}.png`; Phase 2 baseline preserved
in `.audit/baseline/`. Interaction states re-captured for the fixed surfaces
(research Financials tab, calendar drawer).

### 4.4 Residual hardcoded-color inventory (intentional, with reasons)

- Theme-paired constant maps (both values documented): compare
  COLORS_DARK/LIGHT, HOLDER_COLORS_DARK/LIGHT, FACTOR_COLOR_DARK/LIGHT,
  REGIME_COLOR(+_LIGHT), chart-theme.ts DARK/LIGHT — hex by necessity
  (SVG/Recharts presentation attributes).
- `dev/tokens/page.tsx` — displays token hex strings; it is the reference sheet.
- `lib/brand/mark.ts` — already theme-paired brand asset colors.
- `lib/ic/export-pdf.ts` — PDF print palette (white paper), not themed UI.
- knowledge-graph `#888`/`#131519` — defensive fallbacks behind
  `getComputedStyle` token reads.
- chart-workspace `#60a5fa` DEFAULT_LINE / rect fallbacks — defaults for
  user-picked drawing colors (toolbar owns the real value).
- `fill="#fff"` end-dot price pills in compare charts — white text on series-
  colored pills; passes in light (all light series ≥4.5 vs white). In dark the
  pills use the pastel series (pre-existing reference design, unchanged).
- Every remaining Tailwind color literal carries a `light:` override or is a
  token utility (re-grepped; see §3.3 convention).

---

## Final: the light token system (documented)

| Token | Light value | Contrast (on bg #f7f8fa / white) | Meaning |
|---|---|---|---|
| --background | #f7f8fa | — | page canvas |
| --surface | #ffffff | — | cards, inputs |
| --surface-2 | #f4f6f9 | — | nested surface, hovers |
| --surface-3 | #e9edf2 | — | deepest nesting, active |
| --border | #e2e6ec | — | default border |
| --border-strong | #cdd4dd | — | emphasized border, scrollbar |
| --foreground | #101722 | 16.6 / 17.7 | primary ink |
| --muted | **#4d5564** | 7.18 / 7.63 | secondary text |
| --faint | **#656f7d** | 4.79 / 5.09 | tertiary/helper text — now AA |
| --brand | #7a5f33 | 5.63 / 5.98 | brass accent, focus ring |
| --brand-strong | #5f4a26 | 7.9 / 8.4 | hover brass |
| --positive | #15803d | 4.72 / 5.02 | gains |
| --negative | #b91c1c | 6.09 / 6.47 | losses |
| --warning | **#ad4a08** | 5.26 / 5.59 | signal orange caution — now AA on every surface |
| --alert | #7c3aed | 5.36 / 5.70 | tripwire violet |
| --chart-1..5 | #9333ea / #2563eb / #0d9488 / #db2777 / #64748b | all ≥4.4 non-text, chart-2 5.17 as text | categorical identities |
| ChartTheme aux (light) | blue #2563eb, amber #b45309, purple #7c3aed, teal #0f766e, orange #ad4a08, pink #db2777, neutral #64748b, referenceLine #94a3b8 | all ≥4.7 text-grade except referenceLine (non-text rule, 2.1 — intentionally quiet, mirrors dark) | named series hues |

Elevation, machined-panel materials, shadows, skeleton, focus ring, selection,
scrollbar: pre-existing light values audited and kept (they were already
purpose-designed, not inverted from dark).

### Design decisions & deviations from dark's approach

1. **`light:`/`dark:` custom variants over per-component token forks.** Dark is
   the reference; encoding light as explicit overrides keeps dark
   pixel-identical by construction and makes every deviation greppable.
2. **Categorical identities promoted to tokens where dark values coincided**
   (blue-400 ≡ chart-2, orange-400 ≡ warning). This shrank the palette rather
   than translating it: calendar-earnings-blue, causal-macro-blue, EU-badge
   blue are now one steel; commodity/policy oranges are one warning (they were
   already identical hexes in dark).
3. **Light hue scale**: -400 text → -700; -400/-500 non-text fills → -600;
   identity hues in hex maps deepened to their ~600/700 equivalents. One rule,
   applied everywhere, so light reads as one deliberate palette.
4. **--muted deepened although it already passed AA** — a hierarchy decision:
   with faint at 4.79, muted needed to move to keep three visibly distinct ink
   tiers (16.6 / 7.2 / 4.8).
5. **Warning banners kept their amber identity** (`text-yellow-400
   light:text-yellow-700`) instead of moving to signal orange: the brand book
   reserves --warning for cautions, but these banners are "partial data"
   notices; keeping hue continuity with dark outweighed token purity. Logged
   as the one place amber survives as text.
6. **Allocation categorical palette deliberately not theme-swapped** — measured
   ≥3:1 on white for all 8 slots; only its white hatch pattern was re-derived
   from --foreground.
7. **Scrims stay black in both themes** — industry-standard dimming; a light
   scrim reads as fog, not focus.

### Before/after references

- Baseline (defective light + reference dark): `.audit/baseline/{theme}/`
- Final: `.audit/screenshots/{theme}/`
- Headline comparisons: `research-financials-tab` (chart palette),
  `compare-run` (categorical system), `engine` (faint text + regime),
  `calendar` (event chips), `journal` (meta text).

### Out-of-scope findings (for separate triage)

1. Pre-existing lint errors in `app/_home/_atmosphere/use-count-up.ts`
   (setState-in-effect), `audit/verify-engines.ts`,
   `tests/portfolio-sizing-calibration.test.ts` (`any`) — untouched WIP files.
2. Dark mode's own `--faint` (#626c7a) measures 3.43–3.7:1 — below AA. Dark is
   the reference implementation so it was left alone, but the same helper-text
   argument that drove the light fix applies.
3. compare-chart end-dot pills: white text on pastel series colors in dark
   (~2.2:1 on #a78bfa). Pre-existing dark design.
4. The working tree carried ~116 modified files of unrelated WIP (landing
   redesign, AI platform, portfolio engines) including `globals.css`,
   `chart-theme.ts`, `dev/tokens` — so this effort's changes are left
   uncommitted to avoid entangling that work in a commit it doesn't belong to.
   Everything is verified in the working tree; commit once the parallel
   workstream lands or is stashed.
5. `.audit/` tooling (capture/contrast/diff scripts + screenshots) is
   reusable for future theme regression sweeps; consider gitignoring
   screenshots if `.audit` is ever committed.
