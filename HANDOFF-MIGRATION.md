# HANDOFF — Anthropic migration session → auth/landing session

Status: migration complete on `f22/day-change` (commits prefixed `ai: `).
Unit suite green (2691 passed / 3 live-gated skips), `tsc` clean except your
in-progress `app/settings/account/page.tsx` (see §3).

## 1. Things wired for you

- **AiStatusBadge** (`app/_components/ai-status-badge.tsx`) is mounted in the
  site-header right cluster. It reads `GET /api/settings/ai-key`
  (presence-only) and shows "AI · Claude Opus 5" / "AI off · add key", both
  linking to `/settings`. Doc-comment rule: it must never claim locality.
- **AccountMenu mount point**: `app/_components/account-menu.tsx` did not
  exist when this session finished, and HANDOFF-LOGIN.md was not present yet.
  A clearly marked mount comment sits in
  `app/_components/site-header.tsx` (right cluster, after `<ThemeToggle />`).
  Drop `<AccountMenu />` there and delete the comment.
- **Settings sub-nav**: `/settings` (my page) renders an AI | Account tab row
  linking to `/settings/account`. It lives only on my page
  (`app/settings/page.tsx:SettingsNav`) — your route is untouched. Reuse or
  ignore as you like.

## 2. Requests into files you own

- `app/landing/_components/sections/hero.tsx`: this file carried two F-01
  false-locality claims from before the ownership split — the
  "Runs 100% on your computer" badge and the "all on your computer" subhead
  clause. They were corrected in the migration session's Part A work (badge →
  "Your data stays on your computer"; subhead → "with every portfolio, note,
  and score stored on your computer") and are committed under `ai: `. Rewrite
  the hero however you want, but the e2e F-01 guard
  (`e2e/landing.spec.ts` → "F-01 guard: every retired false-locality claim
  stays retired") will fail the suite if any retired phrase returns. The
  approved positioning is: **local-first data + deterministic computation;
  hosted AI narration on the user's own Anthropic key**.
- `app/globals.css`, `app/layout.tsx`: your modifications were left unstaged
  and uncommitted by this session.

## 3. Known breakage that is yours

- `app/settings/account/page.tsx` imports `../_components/account-card` and
  `../_components/change-password-card`, which don't exist yet — `tsc` fails
  on exactly those two lines. Everything else typechecks.

## 4. Environment facts you should know

- The Playwright web server (port 3111, `playwright.config.ts`) now runs with
  `ANTHROPIC_API_KEY=""` and `UAA_CONFIG_DIR=e2e/.tmp/uaa-config`: e2e is the
  designed AI-off environment, and no e2e run can spend on a developer's real
  key exported in the shell. If your 3121 config is separate, consider the
  same two lines.
- The Anthropic key lives at `~/.uaa/anthropic_api_key` (mode 600, dir 700),
  overridable via `UAA_CONFIG_DIR`; `ANTHROPIC_API_KEY` env wins over the
  file. `.gitignore` has a belt-and-braces `anthropic_api_key` pattern.
  `GET/POST/DELETE /api/settings/ai-key` is presence-only — never returns the
  key.
- This dev machine's shell exports an *invalid* `ANTHROPIC_API_KEY`; the
  header badge (presence-only by design) will show "AI · Claude Opus 5" in
  `npm run dev` while actual calls 401 → panels show the "replace key in
  Settings" degrade message. Unset it or replace it with a real key.

## 5. Pre-existing failures NOT caused by either session (verified on e2e run)

- `e2e/pages.spec.ts` → `/intelligence` emits a 404 console error (a missing
  resource on that page; reproduced before any migration commit).
- `e2e/journeys.spec.ts` → watchlist round-trip (NVDA row) fails offline —
  appears to depend on a live quote to render the row.
- Pre-existing lint errors (untouched files): `app/_home/_atmosphere/use-count-up.ts`,
  `audit/verify-engines.ts`, `tests/portfolio-sizing-calibration.test.ts`, plus
  `.venv/**` sklearn JS being linted at all.
