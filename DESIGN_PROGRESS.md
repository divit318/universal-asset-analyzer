# DESIGN_PROGRESS.md — Design/Frontend Session (2026-07-04)

Goal: polish UAA to premium-terminal quality. Refinement, not redesign.
Criteria: token consistency, hierarchy, loading/empty/error states, WCAG AA,
purposeful microinteractions, cross-feature journey completeness.

## Design system (as found)
- `app/globals.css` (88 lines): dark-only. Tokens: `--background #0a0b0d`,
  surface scale (`--surface/-2/-3`), `--border`, `--foreground`, `--muted`,
  `--accent #4ade80` (+`-strong`), semantic `--positive/--negative/--warning`,
  chart palette `--chart-1..5`. Mapped into Tailwind v4 via `@theme inline`
  (usable as `bg-surface`, `text-accent`, etc).
- Global `:focus-visible` ring (accent, 2px), mouse focus suppressed.
- Fonts: Geist sans + mono. Dialog enter animation defined globally.
- Shared components (`app/_components/`): site-header, symbol-search, dialog,
  toast, ollama-status, daily-pulse, market-dashboard, movement-explainer-card,
  portfolio-fit-badge/panel, sector-rotation-panel.
- Intelligence hub views: `app/intelligence/_views/{graph,opportunity-map,timeline}-view.tsx`.

## Verification commands
tsc --noEmit / npm run lint / npm run test / npm run build. Dev server :3000.

## Audit findings
(populated during audit)

## Completed
(populated as fixes land)

## Decisions log
- Session start: backend-quality session paused (see PROGRESS.md); this file
  tracks the design session.
