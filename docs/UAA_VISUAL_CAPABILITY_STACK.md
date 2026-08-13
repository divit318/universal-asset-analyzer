# UAA Visual Capability Stack

The visual design / motion / animation / illustration production environment for UAA.
Assembled and validated 2026-08-11. Companion to `docs/DEVIN_CAPABILITY_REGISTRY.md`
(general tooling) and `docs/brand-guidelines.md` (the design authority).

Governing philosophy: **the smallest professional toolkit with maximum expressive range.**
UAA's visual identity is a machined instrument — SVG-first, token-driven, monotonic motion,
brass earned by judgment. The stack below serves that identity; nothing in it is decorative.

---

## Animation & Motion

| Tool | Status | Purpose |
|---|---|---|
| **CSS keyframes + transitions** | in repo (~40 keyframes, `app/globals.css`) | The default. Micro-interactions, entrances, ticks, sweeps — all token-driven (`--duration-*`, `--ease-out`, `--ease-precise`) |
| **framer-motion v12** | in repo (dependency; currently used in 4 files) | The ONLY JS animation library. Exit animations, layout/shared-layout transitions, springs, scroll-linked motion, SVG `pathLength` drawing, orchestrated variants |
| **Web Animations API / rAF** | native | Continuous simulation only — precedents: `count-up.tsx`, the landing ink engine (canvas particle physics) |
| **`/uaa-motion` skill** | `.devin/skills/uaa-motion/` | The motion design system: token law, tool ladder, financial-motion semantics (directional color, plot-draw sweeps), reduced-motion contract, 60fps rules |

**What it enables**: micro-interactions (hover/press/focus/toggle/modal/tooltip), staggered
entrances, page transitions, shared-layout morphs, path drawing/morphing, scroll choreography,
spring physics (critically damped — no bounce), animated counters/gauges/rankings, directional
price motion. Validated at **61fps** in the POC.

**Deliberately NOT installed**: GSAP, react-spring, Motion One, AutoAnimate, anime.js — all
overlap framer-motion + CSS with zero unique capability UAA needs. One library, one grammar.

---

## Data-Visualization Motion

- **recharts 3.8** (24 files) — series arrive via the repo's `plot-draw` CSS sweep (1500ms),
  not recharts' built-in tween; 120ms active-dot transitions.
- **klinecharts 10** (17 files) — candlestick workspace, library-default motion.
- **d3-force** — knowledge-graph layout (SVG renderer; synchronous settle under reduced motion).
- Primitives: `<CountUp>`, `<ScoreRing>`, `<ValueBar>`, `price-tick-up/down`, `value-flash`,
  `winner-reveal-*` — reuse, never reimplement.

---

## Illustration & SVG

| Tool | Status | Purpose |
|---|---|---|
| **Hand-authored SVG JSX** | native skill | Primary illustration medium — theme-token colors, diamond terminus, geometric/institutional grammar |
| **Seeded procedural generation** | in repo | `scripts/generate-hero-stipple.ts`, `scripts/generate-particle-fields.mjs` — deterministic stipple/particle art, single-path bucketing, 60KB budget |
| **svgo 4** | **installed** (global npm) | Optimization of every authored/exported SVG (`svgo --multipass`; keep viewBox). POC: −21.3% on a 2,600-dot field |
| **Mermaid CLI** | on demand (`npx @mermaid-js/mermaid-cli`) | Architecture/process diagrams for docs (not product surfaces) |
| **lucide-react** | in repo (59 files) | The only icon library; custom icons in `app/_components/icons.tsx` (24×24, currentColor, stroke 2) |
| **`/uaa-visual-assets` skill** | `.devin/skills/uaa-visual-assets/` | The full authoring/optimization workflow + brand grammar + budgets |

---

## Images (creation, editing, optimization)

| Tool | Status | Local? | Purpose |
|---|---|---|---|
| **sharp** | in repo node_modules | local | Resize, composite, format conversion, compression via `node -e` one-liners and `scripts/generate-brand-assets.ts`. POC: hero.png 92.8KB → WebP 34.7KB (−63%) → AVIF 20.1KB (−78%) |
| **rembg** | on demand (`uvx --from "rembg[cpu]" rembg`) | local (ONNX, ~170MB model on first use) | Background removal — rare need, zero permanent footprint |
| **Local AI image generation** | **not installed** | — | 16GB host with ~4GB dev-stack slack + documented jetsam history makes resident diffusion models a host hazard. If genuinely needed: **Draw Things** (free macOS app, local SD) run manually with the dev stack stopped (`scripts/ops/uaa stop`). UAA's aesthetic is procedural-vector, so this is an edge case, not a gap |

No paid image APIs. No cloud generation services.

---

## 3D / WebGL

**Not installed — by design.** UAA's premium moments are owned by the existing canvas **ink
engine** (spring physics, spatial hashing, keep-out masking, reduced-motion fallback) — already
more sophisticated than a default three.js scene. If a future hero moment truly demands 3D:
`three` + `@react-three/fiber`, dynamically imported, landing-only, added at that time with the
user's approval. **When NOT to use 3D**: product surfaces, charts, dashboards — always.

---

## Figma

| Item | Status |
|---|---|
| **figma plugin v2.2.91** (official, `figma/mcp-server-guide`) | **installed** (user-level Devin plugin) |
| MCP server | `https://mcp.figma.com/mcp` (remote, OAuth) — run `devin mcp login figma` before first use |
| Skills | 12: `figma-design-to-code`, `figma-implement-motion`, `figma-use-motion`, `figma-generate-design`, `figma-generate-diagram`, `figma-generate-library`, `figma-code-connect`, `figma-create-new-file`, `figma-use`, `figma-use-figjam`, `figma-use-slides`, `figma-swiftui` |
| Cost | Free during Figma's beta on ALL plans. **Starter plan: ~6 tool calls/month** (batch questions); Figma states this becomes usage-based paid later — reassess then |

Enables: design inspection, variables/tokens/typography extraction, design→code translation,
diagram generation, writing to drafts. UAA has no Figma files today — this is ready for when
designs exist.

> Operational note: plugin skills/MCPs load at session start. If `devin plugins list` or plugin
> skills appear missing mid-session (a live session can rewrite the local plugin lock), run
> `devin plugins update` — the personal-plugin manifest is authoritative and re-resolves both
> plugins (verified: 18 plugin skills after refresh).

---

## Browser & Visual QA

| Tool | Status | Role |
|---|---|---|
| **playwright MCP** | pre-existing | Interactive DOM inspection, flows, screenshots. Note: uses a shared Chrome profile — if "browser already in use", close the other agent session's browser or fall back to the script below |
| **chrome-devtools MCP + 6 expert skills** | plugin (prior audit) | Performance traces (LCP/CLS/long tasks), network, throttling, `/chrome-devtools-mcp:a11y-debugging` |
| **playwright-core scripts** | in repo | The production pattern (`audit/visual/shoot.mjs` model): multi-route × multi-width × reduced-motion screenshot batches — validated in POC with dual-mode captures + console-error count + FPS sampling |
| **Repo harnesses** | in repo | `scripts/perf-baseline.mjs` (LCP/FPS/heap per route), `scripts/ink-verify.mjs` (legibility gates), `scripts/kg-screenshot.mjs`, `/dev/tokens` (live token review) |
| **Visual regression** | Playwright `toHaveScreenshot()` | Add per-surface when a design stabilizes; pixel sampling via sharp for spot checks (POC-proven) |

Workflow: implement → `uaa start` → inspect via MCP → screenshot both themes + reduced-motion →
trace performance → fix → repeat. See `/uaa-ui-qa`.

---

## Asset Optimization Pipeline

svgo (SVG) · sharp (raster → WebP/AVIF, resize, compress) · budgets: decorative asset ≤60KB,
route First Load JS deltas checked via `npm run build` output · heavy visual code dynamically
imported (ink-engine precedent).

---

## Performance & Accessibility

- **Measure**: `scripts/perf-baseline.mjs` (fps/lcp/heap), chrome-devtools MCP traces, rAF FPS
  sampling (POC pattern), build-output bundle deltas.
- **Rules** (enforced by `/uaa-motion`): transform/opacity only, no layout-property animation,
  `will-change` transient, ambient loops landing-only, 60fps gate.
- **Reduced motion**: blanket CSS collapse + `prefersReducedMotion()`/`useReducedMotion` JS
  contract + e2e guards (`landing.spec.ts`, `landing-hero.spec.ts`) — POC verified both modes.
- **A11y**: focus-visible system in globals.css, ARIA-live in TaskProgress, accessible-SVG
  checklist in `/uaa-visual-assets`, axe workflows in `/uaa-ui-qa` + `/chrome-devtools-mcp:a11y-debugging`.

---

## UAA-Specific Skills (visual)

| Skill | Activates for |
|---|---|
| `/uaa-motion` | any animation/transition/interaction work |
| `/uaa-visual-assets` | any SVG/illustration/icon/image/diagram work |
| `/uaa-ui-qa` | browser inspection, visual QA, perf/a11y passes (now indexes the repo harnesses) |
| `/frontend-design` (global, Anthropic, Apache-2.0) | aesthetic direction for NEW surfaces — always subordinate to `docs/brand-guidelines.md` |

---

## NOT Installed (investigated & rejected)

| Tool | Why not |
|---|---|
| GSAP | Redundant with framer-motion + CSS; second animation grammar = sprawl |
| react-spring / Motion One / AutoAnimate / anime.js | Same — zero unique capability for UAA |
| Lottie runtime (`@lottiefiles/dotlottie-react`) | No Lottie assets exist or are authorable without After Effects; framer-motion + CSS cover vector animation in-code. Add the runtime only when a real .lottie asset enters the repo |
| Rive | Free-tier editor is GUI-only authoring; runtime useless without assets; state-machine needs unmet by any current UAA design |
| three.js / @react-three/fiber | No current 3D use case; ink engine owns hero moments (see 3D section) |
| Stable Diffusion / FLUX local models | 16GB host, ~4GB slack, documented jetsam/wired-memory history; Draw Things documented as user-run alternative |
| ImageMagick | sharp (already in node_modules) covers the raster pipeline |
| Storybook | Heavy infra for a hand-rolled component set; `/dev/tokens` + e2e cover review needs today |
| Percy / Chromatic / Applitools | Paid SaaS; Playwright screenshots suffice |
| Iconify/react-icons/heroicons | lucide-react is the single icon source |
| Unofficial Figma MCPs (figma-context-mcp etc.) | Official Figma plugin exists and is preferred |
| shadcn/tweakcn/UI-kit MCPs | UAA deliberately hand-rolls primitives (CLAUDE.md rule); 21st MCP already present for reference |

---

## Proof-of-Concept Validation (2026-08-11)

All run against a scratch page (`/tmp/uaa-visual-poc/`, never touching app code):

1. CSS token-driven staggered entrance — pass (pixel-verified `#131519` surfaces)
2. SVG score-ring draw + plot sweep + diamond terminus — pass
3. Spring interaction (motion@12, spring 420/34, transform-only) — pass, hover/press verified via automation
4. Data-viz motion: easeOutCubic counter + directional price ticks — pass
5. Illustration: seeded 2,600-dot stipple → svgo −21.3% — pass
6. Image pipeline: PNG→WebP −63%, →AVIF −78%, responsive resize — pass
7. Browser screenshots (dual theme-mode, playwright-core) — pass
8. Visual QA: interaction + console-error count + reduced-motion emulation + pixel sampling — pass
9. Figma: plugin + 12 skills registered; tool calls pending user OAuth (`devin mcp login figma`)
10. Performance: 61fps measured under full animation load; zero console errors

## Recommended workflow for future visual work

1. `/uaa-motion` + `/uaa-visual-assets` (+ `/frontend-design` for new surfaces) → design within the system
2. Build with existing primitives/tokens; new keyframes into globals.css beside their kin
3. `uaa start` → inspect via playwright/chrome-devtools MCPs, both themes, reduced-motion
4. `node scripts/perf-baseline.mjs fps` or a DevTools trace → 60fps gate
5. svgo/sharp every new asset; check budgets; `npm run build` for bundle deltas
6. e2e reduced-motion specs stay green; screenshot evidence in the PR
