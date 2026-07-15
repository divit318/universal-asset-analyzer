# PLAN-legacy-cleanup: Delete the orphaned /analyze module, dead code, and the unused framer-motion dependency

**Rank: #5 of 5.**

**Status: DONE (2026-07-10).** All steps executed, all acceptance criteria verified.
One deviation: `lib/inspect.ts` (the sole helper imported only by `lib/analyze.ts`,
providing image/text/binary content inspectors) was not in the original file list but
was orphaned by the `lib/analyze.ts` deletion and was removed too, in keeping with the
plan's intent. `lib/types.ts`'s `Asset`/`AssetKind`/`AnalysisInsight`/`AnalysisResult`
types were left alone — that's a shared domain-types file outside this plan's scope, and
unused exported types don't break anything.

## Goal

Remove three categories of confirmed dead weight, each independently verified during the
2026-07-09 audit:

1. **The legacy `/analyze` module** — `PROJECT_ROADMAP.md`'s Technical Debt table lists
   it as "Unused, clutters nav — Low (delete)". It is NOT in the goal-based nav
   (`app/_components/nav-config.ts` has zero references), so it is unreachable except by
   typing the URL. Chain: `app/analyze/` (page + `_components/`),
   `app/api/analyze/route.ts`, `lib/analyze.ts` (whose only importer is that route).
2. **`position-recommendations.tsx`** — `app/portfolio/_components/position-recommendations.tsx`
   confirmed dead twice (2026-07 Phase 2 notes + `DESIGN_PROGRESS.md` "Remaining
   opportunities" item 3: "confirmed still dead code (defined, never imported)").
3. **The `framer-motion` dependency** — removed from all client code in the 2026-07-06
   perf pass; the ONLY remaining references in the repo are a CSS comment
   (`app/globals.css:200-201`, "replace framer-motion in global UI") and the
   `optimizePackageImports` list in `next.config.ts`. The package still sits in
   `package.json` dependencies and `node_modules`.

Also: stop tracking/ignoring local build artifacts (`build.log`, `build2.log`, `dev.log`,
`tsconfig.tsbuildinfo`) and update the docs that list the deleted module.

Why this matters despite being "just cleanup": every orphaned module is context that
future sessions (human or AI) pay to read, a nav/docs lie, and — per this repo's own
token-efficiency architecture priority — recurring cost. It also unblocks the e2e page
matrix from carrying a dead route.

## Files to touch

Delete:
- `app/analyze/` (entire directory: `page.tsx`, `_components/`)
- `app/api/analyze/route.ts` (and the now-empty `app/api/analyze/` dir)
- `lib/analyze.ts`
- `app/portfolio/_components/position-recommendations.tsx`

Edit:
- `package.json` / `package-lock.json` — remove `framer-motion` (via `npm uninstall`)
- `next.config.ts` — remove `"framer-motion"` from `experimental.optimizePackageImports`
- `app/globals.css` — reword the lines 200–201 comment so it no longer implies the
  package exists (e.g. "CSS-driven micro-animations for global UI")
- `.gitignore` — add `*.log`, `tsconfig.tsbuildinfo` (check them with
  `git ls-files build.log build2.log dev.log tsconfig.tsbuildinfo` first; if any are
  tracked, also `git rm --cached <file>`)
- `PROJECT_ROADMAP.md` — Technical Debt table: mark "Legacy /analyze module" resolved
  (or remove the row)
- `DESIGN_PROGRESS.md` — "Remaining opportunities" item 3 (dead component): mark done
- `CLAUDE.md` + `ARCHITECTURE.md` + `UAA_GUIDE.md` + `AGENTS.md` — remove/adjust any
  mention of the Analyze module (CLAUDE.md's "Existing Modules" table has an
  `**Analyze** (/analyze)` row — delete it)

## Step-by-step implementation order

### Step 1 — Prove each deletion is safe (do NOT skip)

Run each check and record the output in the commit message:

```bash
# /analyze reachability: expect matches ONLY inside app/analyze, app/api/analyze, lib/analyze.ts, and docs
grep -rn "analyze" app lib --include='*.ts' --include='*.tsx' -l | sort
# Specifically: no nav/link references
grep -rn '"/analyze"' app lib --include='*.ts' --include='*.tsx'
grep -rn "analyze" app/_components/nav-config.ts app/_components/command-palette.tsx
# lib/analyze.ts importers: expect exactly app/api/analyze/route.ts
grep -rln 'lib/analyze"' app lib
# dead component: expect zero importers
grep -rn "position-recommendations" app lib --include='*.ts' --include='*.tsx' | grep -v "position-recommendations.tsx:"
# framer-motion: expect zero import statements anywhere
grep -rn "from \"framer-motion\"\|from 'framer-motion'" app lib
```

**CAUTION — false positives on the word "analyze":** `lib/portfolio-analytics.ts`,
"analyzeMarket"-style function names, and prose comments legitimately contain the
substring. Only the module files listed above get deleted. If any check surfaces an
unexpected REAL importer (an actual `import` statement resolving to `app/analyze/*` or
`lib/analyze`), STOP and report instead of deleting.

Also check tests: `grep -rln "analyze" tests/` — if a test imports `lib/analyze`,
delete that test file too (expected: none; `tests/ollama.test.ts` tests
`lib/ollama.ts`'s `buildAnalysisPrompt`, which is a DIFFERENT file that stays).

### Step 2 — Delete the /analyze chain

`git rm -r app/analyze app/api/analyze && git rm lib/analyze.ts`
Then `npx tsc --noEmit` — any surviving reference will surface here as a broken import.

### Step 3 — Delete the dead portfolio component

`git rm app/portfolio/_components/position-recommendations.tsx`, re-run `npx tsc --noEmit`.

### Step 4 — Remove framer-motion

```bash
npm uninstall framer-motion
```
Then edit `next.config.ts` (remove the array entry) and the `app/globals.css` comment.
Run `npm run build` — this is the real proof nothing needed it (the
`optimizePackageImports` entry for a missing package can break the build if left behind,
which is why the config edit is mandatory, not cosmetic).

### Step 5 — Artifacts and .gitignore

Check `git ls-files | grep -E '\.log$|tsbuildinfo'`; `git rm --cached` anything tracked,
then append to `.gitignore`:
```
*.log
tsconfig.tsbuildinfo
```
(Confirm `.gitignore` doesn't already have these lines; don't duplicate. Note
`graphify-out/` handling: leave it exactly as currently tracked/ignored — out of scope.)

### Step 6 — Docs sweep

Update the five docs listed above. Search-verify afterwards:
`grep -rn "/analyze" *.md | grep -v PLAN-` should return nothing (the word "analyze" in
prose is fine; the route path `/analyze` should be gone).

### Step 7 — Gate

`npx tsc --noEmit`, `npx eslint .`, `npm run test`, `npm run build`, `graphify update .`.
If PLAN-e2e-smoke-suite is already merged: remove `/analyze` from the page matrix in
`e2e/pages.spec.ts` and run `npm run test:e2e`.

## Edge cases a weaker model will miss

- **`lib/ollama.ts` is NOT part of the analyze module.** Despite the legacy-sounding
  name, it exports `buildAnalysisPrompt` and is imported by `lib/ai.ts` (the AI façade)
  and tested by `tests/ollama.test.ts`. It stays. Deleting it breaks the entire AI layer.
- **The substring trap**: `portfolio-analytics.ts`, `analyzeX()` helpers, and doc prose
  contain "analyze". Deletion scope is exactly the four paths in "Files to touch" —
  nothing else, no matter what a grep for the bare word returns.
- **`optimizePackageImports` referencing an uninstalled package** can fail
  `npm run build` on some Next versions — the `next.config.ts` edit must land in the
  same commit as the uninstall.
- **`app/analyze/_components/` may export something generic-sounding** — before
  deleting, `grep -rn "from \".*analyze/_components" app lib` to prove no cross-module
  import snuck in (the repo had exactly this problem with `SymbolSearch` being imported
  across modules — see `PROJECT_ROADMAP.md` Timeline notes).
- **`package-lock.json` must be committed** with the uninstall, or the next
  `npm ci`/`npm i` resurrects the dependency mismatch.
- **Do not delete `data/` artifacts, `graphify-out/`, or `*.md` progress logs** — only
  the four code paths + the two log-file gitignore entries. `build.log`/`dev.log` files
  themselves can be deleted from disk if untracked, but that's optional.
- **Route-count assertions**: docs and past sessions mention counts like "21/21 static
  pages" / "16 routes" — after deletion the counts change; don't "fix" old historical
  logs (`DESIGN_PROGRESS.md` history stays as written), only forward-looking docs
  (module tables, nav lists).

## Acceptance criteria (verify each)

1. `ls app/analyze app/api/analyze lib/analyze.ts app/portfolio/_components/position-recommendations.tsx`
   → all "No such file or directory".
2. `grep -rn "framer-motion" package.json next.config.ts app lib` → zero matches
   (the reworded globals.css comment no longer names it); `ls node_modules/framer-motion`
   fails after a fresh `npm i`.
3. `npx tsc --noEmit` clean; `npx eslint .` 0/0; `npm run test` count unchanged
   (no deleted tests were load-bearing — expected: zero test deletions);
   `npm run build` succeeds with the same number of routes minus `/analyze` and
   `/api/analyze`.
4. Visiting `http://localhost:3000/analyze` returns the app's 404, and no nav item,
   command-palette entry, or in-app link points at it
   (`grep -rn '"/analyze"' app` → nothing).
5. `git status` after `npm run build && npm run dev` (briefly) shows no untracked
   `*.log`/`tsbuildinfo` noise.
6. `CLAUDE.md`'s module table and `PROJECT_ROADMAP.md`'s debt table no longer list the
   module; `DESIGN_PROGRESS.md` item 3 marked done.
