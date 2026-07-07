# UAA Visual & UX Elevation — Spec

## 1. Vision & Direction

UAA should feel like a **next-generation institutional investment platform** — not a
Bloomberg-terminal clone, and not a generic SaaS dashboard. Draw inspiration from the
best qualities of Linear, Stripe Dashboard, Arc Browser, Raycast, Mercury, Apple,
Koyfin, and modern Bloomberg — but imitate none of them. The result should be
original and purpose-built for investment research.

The app should immediately communicate **professionalism, trust, precision, and
craftsmanship**. It should feel expensive, intentional, and designed by a
world-class product team.

**Priorities, in order:**
1. Visual polish and craftsmanship
2. Exceptional UX and usability
3. Consistency across every page
4. Clear information hierarchy
5. High information density with low cognitive load
6. Fast, fluid interactions
7. A cohesive design system shared across the entire application

Optimize for **perceived quality over visual complexity**. Every pixel should
justify its existence — if something doesn't improve clarity, usability, or trust,
it shouldn't exist. Preserve information density where it earns its keep (Scanner,
Screener, Compare, Portfolio) rather than diluting it for whitespace's sake.

## 2. Scope & Anti-Goals

**In scope:** visual design and UX of existing pages/components — layout, spacing,
color, typography, motion, iconography, shared component structure, chart chrome.

**Anti-goals (hard constraints):**
- No new features. No changes to business logic, scoring formulas, data fetching,
  or API contracts.
- Don't change any page or component that isn't part of this visual/UX pass.
- No light theme — the app stays dark-only (`color-scheme: dark`).
- No changes to `lib/` domain logic, `app/api/` route behavior, or DB schema.

**Explicitly out of scope / deferred** (found during audit, not to be actioned
this pass):
- Dead/orphaned routes — `app/analyze` (roadmap-flagged legacy), `app/stocks/[symbol]`
  (orphaned pre-merge duplicate of `/research`, not in nav), and the empty
  `app/comps/` directory. **Flag as cleanup candidates for a future session; do not
  delete or restyle them now.**
- The "dev-nav perceived freeze" issue noted in `DESIGN_PROGRESS.md` — stays deferred.
- The `extractJson<T>()` schema-trust hardening pass noted in `DESIGN_PROGRESS.md` —
  stays deferred.

## 3. Foundation Layer (build first)

### 3.1 Design tokens (`app/globals.css`)
- Introduce a **distinct brand accent**, separate from the `positive`/`negative`
  trading-semantic colors. Green (`#4ade80`) currently does double duty as both
  brand identity and "stock is up" — split these so brand color choices don't
  fight financial meaning.
- Formalize a spacing/radius/shadow scale as named tokens (today there is no
  explicit scale — components pick `rounded-md/lg/xl` and shadow levels ad hoc).
- Keep the existing surface elevation scale (`--surface/-2/-3`), `--border`,
  `--foreground`, `--muted` as the base neutral system; refine values only as
  needed for contrast (see 3.6).
- Keep dark-only; no `prefers-color-scheme` / light variant.

### 3.2 Typography
- Keep **Geist Sans** (UI) and **Geist Mono** (data/numerics) — no new font
  files. Elevate through disciplined use, not a new typeface.
- Formalize the existing 9px/10px/11px micro-tier (486 call sites) as **named
  scale tokens** (e.g. micro-label, data-caption, secondary-caption) instead of
  arbitrary `text-[Npx]` literals, preserving the tier semantics documented in
  `DESIGN_PROGRESS.md` (9px = uppercase pill/badge labels, 10px = uppercase
  micro-headers/tabular numerics, 11px = secondary captions).
- Define a complete scale from micro-labels up through page-title sizes, with
  consistent weight, line-height, and letter-spacing rules per tier.
- Use tabular figures (`font-variant-numeric: tabular-nums` / Geist Mono) for all
  financial numerics consistently.

### 3.3 Motion
- Introduce **Framer Motion** as a new dependency.
- Define a small set of standard durations/easings used everywhere (no
  bespoke one-off timing per component).
- Apply to: tab switches, section reveals, list/card stagger-in, hover/press
  micro-interactions, drawer/dialog transitions (replacing the single
  `dialog-enter` keyframe in `globals.css` with the same primitive used
  elsewhere).

### 3.4 Iconography
- Introduce **lucide-react** as a new dependency, replacing hand-rolled inline
  `<svg>` icons throughout `app/`.
- Define standard size/stroke-width conventions per context (nav, buttons,
  inline badges, data rows).

### 3.5 Shared component primitives (`app/_components/`)
Build reusable primitives on top of the new tokens/motion/icons, replacing
copy-pasted inline Tailwind strings (e.g. `rounded-xl border border-border
bg-surface p-6` repeated across a dozen pages):
- `Card`, `Button` (variants: primary/secondary/ghost/destructive),
  `Badge`/chip, `PageShell`/`PageHeader`, `SectionHeader`, `StatTile`, `Input`,
  `Tabs`.
- Reuse and extend existing shared components rather than replacing them
  outright: `dialog.tsx` (Dialog + Drawer), `toast.tsx`, `site-header.tsx`,
  `symbol-search.tsx`.
- No `class-variance-authority` or similar variant-management dependency —
  keep primitives as plain typed components with prop-driven variants.

### 3.6 Chart theming (Recharts)
- Chart restyling **is in scope**: palette, gridlines, tooltips, legends, and
  axis typography should be redesigned to match the new premium visual
  language and align with (not necessarily identical to) the new brand/semantic
  tokens.
- Do **not** change chart data logic — series computation, thresholds, and
  data transforms in `lib/` are untouched.

### 3.7 Accessibility
- Run a **formal WCAG 2.1 AA contrast sweep** across the new palette: body
  text ≥ 4.5:1, large text/UI components ≥ 3:1, including muted text, badges,
  and chart labels against their surface colors.
- Preserve and extend the existing baseline (semantic HTML, focus-visible
  rings, skip-to-content link, keyboard accessibility fixes from
  `DESIGN_PROGRESS.md` Session 2).

## 4. Reference Implementation (checkpoint before full rollout)

Apply the completed foundation fully to three flagship pages first:
**Home, Research, Portfolio.** Pause here to confirm the direction reads as
intended before rolling out further.

## 5. Full Rollout (priority order)

1. **Screener, Scanner, Compare** — dense analytical workhorse pages.
2. **Intelligence, Thematic, IC Report** — deep-research/institutional-grade
   features. While migrating Intelligence, fix its confirmed inconsistency:
   it currently uses `max-w-6xl`/`px-4 py-8 sm:px-6` while every sibling page
   uses `max-w-7xl`/`px-6 py-8-16` — align it to the shared `PageShell`.
3. **Watchlist, Calendar, DCF, Engine** — remaining pages, same system applied
   with the same rigor, just later in sequence.

## 6. Verification

After every meaningful chunk of work (tokens, primitives, per-page migration):
- `npx tsc --noEmit` — must stay clean.
- `eslint` — must stay at 0 errors/0 warnings (current baseline per
  `DESIGN_PROGRESS.md`).
- `npm run test` — all 317 existing tests must keep passing (no test changes
  expected, since business logic is untouched).
- Live browser spot-check of the page(s) just changed (per this repo's
  established convention of catching color-matched overlays, crashes, and
  interaction regressions that static review misses).

Final pass: full verification suite plus a live pass through every migrated
page.

## 7. Out of Scope / Deferred (recap)

- Deletion of `app/analyze`, `app/stocks/[symbol]`, `app/comps/` — flagged only.
- Dev-nav perceived freeze (`DESIGN_PROGRESS.md`).
- `extractJson<T>()` schema-trust hardening (`DESIGN_PROGRESS.md`).
- Light theme / theme toggle.
- Any new features, business logic changes, or API contract changes.
