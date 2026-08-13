---
name: uaa-motion
description: Design and implement motion/animation in UAA — the machined-instrument motion system, its tokens, which tool to use for what, reduced-motion contract, and 60fps performance rules
---

UAA's motion language is a **machined instrument**: monotonic curves, no bounce, no overshoot, no decoration. Motion exists to communicate state, causality, and hierarchy to professional users — never to entertain. Follow this system; do not invent a parallel one.

## 1. Tokens are law

Durations and easings come from the token system — never inline literals.

| CSS token (`app/globals.css` `:root`) | Value | Use |
|---|---|---|
| `--duration-feedback` | 80ms | press/hover acknowledgement |
| `--duration-fast` | 120ms | popovers, menus, tooltips |
| `--duration-base` | 200ms | default color/border/opacity |
| `--duration-panel` | 280ms | expand/collapse, dialogs, drawers |
| `--duration-arrival` | 640ms | content settling into view |
| `--duration-draw` | 900ms | a value drawing itself |
| `--duration-plot` | 1500ms | chart series sweep |

Easings: `--ease-out: cubic-bezier(0.16,1,0.3,1)` (deep decelerate, arrivals) and `--ease-precise: cubic-bezier(0.32,0.72,0,1)` (firm monotonic, state changes). JS mirror: `app/_components/motion.ts` exports `EASE_OUT`, `EASE_PRECISE`, `DURATION_*`, `REVEAL_DURATION_MS`/`REVEAL_STAGGER_MS`, and `prefersReducedMotion()`. If you need a new duration/easing, add a token in BOTH places — don't hardcode.

## 2. Tool ladder — cheapest tool that does the job

1. **CSS transitions/keyframes** (default). ~40 keyframes already exist in `app/globals.css` (`page-enter`, `fade-rise`, `dialog-enter`, `price-tick-up/down`, `value-flash`, `plot-draw`, `ring-draw`, `bar-fill`, `winner-reveal-*`, `reveal-up`, loading-mark family…). REUSE before writing a new one; new keyframes live in globals.css beside their kin, wired through the `@theme` block when a utility is needed.
2. **framer-motion v12** (already a dependency — the ONLY JS animation library; never add GSAP/react-spring/motion-one/auto-animate). Reach for it when CSS can't: exit animations (`AnimatePresence`), layout/shared-layout transitions (`layout`/`layoutId`), springs tied to gesture state, scroll-linked values (`useScroll`+`useTransform`), SVG path drawing (`pathLength`), orchestrated variants/stagger. Springs must stay critically damped or overdamped (no visible bounce): prefer `{ type: "tween", ease: EASE_PRECISE }` or high-damping springs.
3. **rAF engines** — only for continuous simulation. Precedents: `app/_components/count-up.tsx` (numbers), the landing ink engine (`app/landing/_components/ink/engine.ts`). Do not write a new rAF loop for something CSS/framer-motion can express.

## 3. Reuse the existing primitives

`<Reveal>` (scroll-staggered entrance, 90ms stagger capped 540ms), `<CountUp>` (animated numbers — never reimplement), `<ScoreRing>` (stroke-dashoffset draw), `<ValueBar>`, `<TaskProgress>` (staged long-work progress, ARIA-live), `<LoadingMark>`/`<LoadingPanel>` (brand loading states), `.animate-page-enter` (route arrival). Search these before building any new motion component.

## 4. Financial-motion semantics

- Direction is sacred: upward change flashes `--positive`, downward `--negative` (see `price-tick-up/down`, `winner-reveal-*`). Never animate financial deltas with neutral/brand color.
- Charts: series arrive via the `plot-draw` CSS sweep (1500ms), NOT recharts' built-in animation; active-dot transitions are 120ms. Keep klinecharts defaults.
- Value updates flash (`value-flash`), they don't bounce or scale.
- Counters ease out (`easeOutCubic` in CountUp); first arrival counts up, subsequent updates take 260ms.

## 5. Reduced-motion contract (non-negotiable)

- A blanket rule in globals.css already collapses ALL CSS animation under `prefers-reduced-motion: reduce`.
- Every JS-driven animation (framer-motion, rAF) must check — `useReducedMotion()` from framer-motion in components, `prefersReducedMotion()` from `app/_components/motion.ts` in imperative code — and render the FINAL state instantly (see `graph-canvas.tsx` synchronous settle, ink engine's single composed frame).
- E2E guards exist (`e2e/landing.spec.ts`, `landing-hero.spec.ts` reduced-motion tests) — keep them green.

## 6. Performance rules (60fps or it doesn't ship)

- Animate `transform` and `opacity` only; never layout properties (width/height/top/margin). Clip-path and filter need a measured trace before shipping.
- `will-change` only for the duration of an interaction; remove after.
- Ambient/looping motion is a LANDING-page-only privilege (ink engine, aurora); product surfaces animate on state change only.
- Verify: `node scripts/perf-baseline.mjs fps` (repo harness: FPS/long-tasks/heap per route) or a `chrome-devtools` MCP performance trace. Layout-shift check: trace insights CLS section.
- Heavy visual code (canvas engines, chart workspaces) stays code-split/lazy: follow the ink engine's dynamic-import pattern.

## 7. Review checklist before shipping motion

tokens used (no literals) · reduced-motion path renders final state · transform/opacity only · direction colors correct · duration tier matches meaning (feedback<fast<base<panel<arrival<draw<plot) · no bounce · works in BOTH themes · e2e reduced-motion specs pass · trace shows no long tasks introduced.
