# HANDOFF — Anthropic migration session → auth/landing session

## Addendum (pricing/copy session, 2026-08-06)

- **Both handoffs closed**: `<AccountMenu />` is mounted in the site-header
  right cluster (HANDOFF-LOGIN §1), and `PasswordInput` is exported from the
  `app/_components/ui` barrel (§5).
- **Suite partition completed**: `playwright.config.ts` now `testIgnore`s
  `auth/settings/landing-hero.spec.ts` — they were being collected by the
  primary (:3111, ungated) config despite belonging to your
  `playwright.login.config.ts` (:3121, gated). Your config is untouched.
- **Pricing rebuilt as two tiers** (Free = the full local product; Pro =
  explicitly "Planned — not yet available", interest capture only, no
  purchase affordance). New table `pricing_interest` in the same local
  SQLite, via `lib/pricing-interest.ts` — deliberately NOT in lib/db.ts
  (your file under the ownership split); it holds its own connection with a
  busy_timeout. If ownership merges later, fold it in.
- **Copy corrected after auth shipped** (your §10 flag): FAQ "no sign-up and
  no login", landing meta "No accounts", footer "No accounts", README "no
  accounts", plus `app/layout.tsx` "all running locally", `app/manifest.ts`
  "running entirely on your own machine", and the demo heading's "no signup".
  All now describe the optional local account / hosted-generation reality,
  and the landing F-01 guard enumerates every retired phrase.
- **Settled decision**: the "Runs 100% on your computer" hero badge stays
  retired permanently — false while generation is hosted on the user's key.
  The e2e guard enforces it.
- One landing copy file you may care about: `sections/demo.tsx` heading is
  now "Ask UAA about any stock — right here, right now."

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

- `app/landing/_components/sections/hero.tsx`: RESOLVED mid-flight — your
  rewrite ("Every figure computed. Every claim traced.") landed while this
  session's e2e was running; it is provider-agnostic and true, and the hero
  spec in `e2e/landing.spec.ts` was reconciled to it (commit 10a2f39). The
  F-01 guard ("every retired false-locality claim stays retired") passes
  against it and will fail the suite if any retired phrase ever returns. The
  approved positioning remains: **local-first data + deterministic
  computation; hosted AI narration on the user's own Anthropic key**.
- `app/globals.css`, `app/layout.tsx`, `app/landing/_components/landing-header.tsx`,
  `e2e/global-setup.ts`: your modifications were left unstaged and
  uncommitted by this session.

## 3. Known breakage that is yours

- RESOLVED mid-flight: `app/settings/_components/account-card.tsx` and
  `change-password-card.tsx` landed while this session was running; `tsc` is
  clean again. Nothing outstanding.

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
