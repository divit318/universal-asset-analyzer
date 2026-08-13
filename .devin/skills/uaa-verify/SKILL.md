---
name: uaa-verify
description: Run UAA's verification gauntlet (typecheck, unit tests, lint, build, optional e2e / live-AI) in the order and with the host-health rules this 16 GB M4 machine requires
permissions:
  allow:
    - Exec(npx tsc --noEmit)
    - Exec(npx vitest run)
    - Exec(npx eslint)
    - Exec(scripts/ops/uaa status)
    - Exec(scripts/ops/uaa doctor)
---

Run UAA's verification pipeline. Follow the ORDER and the host rules exactly — they exist because this is a 16 GB machine where a careless build or test run can tip the host into swap.

## 0. Preconditions

- Check host state first: `scripts/ops/uaa status` (alias: `npm run host:status`). If it warns, run `scripts/ops/uaa doctor` and fix findings before heavy steps.
- Find out if a dev server is running (`lsof -nP -iTCP:3000 -sTCP:LISTEN`). This decides whether `npm run build` is allowed (see step 4).

## 1. Typecheck (always)

```bash
npx tsc --noEmit
```
Must be silent. Any output is a failure.

## 2. Unit tests (always)

```bash
npx vitest run                       # full suite, ~2900 tests, ~10s, capped at 6 workers on purpose
npx vitest run tests/<file>.test.ts  # targeted while iterating
```
Never raise the worker cap in `vitest.config.ts` — 6 is a measured memory knee, not a guess.

## 3. Lint (always)

```bash
npx eslint app lib
```
Expected clean. There are NO known pre-existing lint issues — treat any problem as a regression.

## 4. Build (for Server/Client boundary, route, or config changes)

```bash
npm run build
```
- **NEVER while `next dev` is running** — they race for `.next/`. Stop the dev server first (`scripts/ops/uaa stop`) or skip the build and say so.
- `tsc` passes JSX that Turbopack cannot parse; a green typecheck is NOT proof the page renders. `npm run build` or a real page load is.
- The build output prints First Load JS per route — quote it when a change could affect bundle size.

## 5. E2E (for UI-flow changes)

```bash
npx playwright test                  # builds prod, serves on :3111, 1 worker
npx playwright test e2e/<spec>.spec.ts
```
Auth-gated flows use `playwright.login.config.ts` (port 3121, `UAA_AUTH_GATE=on`). E2E builds the app itself — same rule: no concurrent dev server.

## 6. Live AI verification (only for AI-layer changes; spends real money/plan)

```bash
LIVE_AI=1 npx vitest run tests/ai-platform-live.test.ts   # end-to-end through the provider chain
npx tsx scripts/ai-eval.ts                                # golden workflow cases (~$0.05/run)
npx tsx scripts/ai-bench.ts --suite cache                 # prompt-cache write→read + TTFT
```
A model swap or effort-tier repin must pass `ai-eval` (gate the candidate with `--model`) BEFORE the pin changes. Do not run these for non-AI changes.

## 7. Report

Summarize as a table: step, command, result (pass/fail + count), and any regression with file:line. If a step was skipped, say why (e.g. "build skipped: dev server running on :3000").
