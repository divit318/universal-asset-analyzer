# EXECUTION_PLAN.md — Merge Execution: `divit-local` × `origin/prisha-work`

**Purpose:** the executable version of `MERGE_PLAN.md`, compressed for a two-founder team. Every technical decision from MERGE_SUMMARY / CHANGE_MANIFEST / PROJECT_DIFF / MERGE_PLAN is preserved; only process overhead is removed. Plan only — no source modified.
**Date:** 2026-08-06

---

## Decision snapshot (nothing new here — the settled answers, in one place)

| Decision | Answer | Source |
|---|---|---|
| AI router | B's `attemptOrder()` chain is the outer loop; ALL of A's local-reliability work (generation gate, residency probe, cold-start budget, capped cold-timeout, keep_alive) survives inside it, gated on `!isHostedProvider()`. Hosted timeout falls through the chain. Same treatment in `routeStream` — the exact spot git auto-merged wrong last time | PROJECT_DIFF D1 |
| Provider locality | `PROVIDER_LOCALITY` is a **total Record** (new provider = compile error until classified); unknown ⇒ local (conservative; FakeProvider + test suite depend on it) | PROJECT_DIFF H5 |
| Default provider order | **Local-first through the merge.** Flipping to hosted is a product decision made separately, at the end, one line, with sign-off | PROJECT_DIFF S3 |
| AI failure copy | A's per-error-type diagnosis + B's `AI_RECOVERY_HINT` advice. No hardcoded "run ollama serve" anywhere | PROJECT_DIFF D2 |
| `new-positions` route | Restore B's version (live caller in `ai-watchlist.ts`); vocabulary moves to `lib/ios/types.ts`; delete later only with call-graph proof | PROJECT_DIFF D5 |
| `lib/db.ts` | Keep both sides (all additive); human-verify migration order + idempotency; never trust the auto-merge | PROJECT_DIFF D4 |
| Portfolio page | A's tabs/ordering/Simulator + B's `BrandEmptyState` inside the empty book | PROJECT_DIFF A10 |
| Screener page | B's legibility suite hosts A's field plumbing; verify by rendering | PROJECT_DIFF H4 |
| `lib/portfolio/thesis.ts` | A's engine wins; B's messaging line rides through the availability seam | MERGE_PLAN P6 |
| Docs | AGENTS.md: concatenate both sections. Migration records side-by-side (B's = `*.prisha.md`). Redesign docs stay, marked ABANDONED | PROJECT_DIFF D3/D8 |
| Brand binaries / lockfile | Never merge — regenerate (`npm run brand:assets` / `npm install`) | MERGE_SUMMARY §14 |
| Everything else (382 of 400 paths) | Disjoint — accept as-is, each founder spot-checks their own side | PROJECT_DIFF §7 |

**Never auto-merge (hand-resolve or regenerate):** `lib/ai/router.ts` · `lib/ai/models.ts` · `lib/db.ts` · `app/api/portfolio/new-positions/route.ts` · `lib/ai-app-assistant.ts` · `lib/ai-compare.ts` · `AGENTS.md` · brand binaries · `package-lock.json` · `ai-migration/0*.md`

---

## Path choice (make this call first)

**Path A — Adopt the existing resolution (recommended, ~half a day).**
This merge already exists, verified, at `main@6585052` + fixes (`cac4ddb`, `1e1a34b`). If "these two branches combined" is the goal, take main at `1e1a34b`, then run only **Phase 4 (full gate)** and **Phase 5 (hardening + product gate)** below as an audit. Re-doing by hand cannot beat a resolution that already survived review and fallout fixes.

**Path B — Re-execute the merge (~2–3 focused days).**
Only if you need a fresh integration branch or want to revisit specific resolutions. Phases 1–5 below.

The rest of this document is Path B; Path A jumps to Phase 4.

---

## Phase 1 — Prep and open the merge (~1 hour)

**Covers:** MERGE_PLAN P0 + P1.
**Why:** the only irreversible asset (`data/app.db`) gets a backup; the merge runs in an isolated worktree (this repo has live concurrent agent sessions — observed writing to the shared tree three times during the audit); the conflict map is verified before any resolution starts.

```bash
# one-writer rule: nothing else writes to ../uaa-merge until Phase 4 commits
git tag pre-merge-A divit-local
git tag pre-merge-B origin/prisha-work
git worktree add ../uaa-merge -b integration/redo-best-of-both divit-local
cp data/app.db ~/uaa-backups/app.db.$(date +%Y%m%d)   # outside the repo

cd ../uaa-merge
npx vitest run                        # record baseline count
git merge-tree --write-tree divit-local origin/prisha-work   # expect EXACTLY the 7 known conflicts
git merge --no-commit --no-ff origin/prisha-work
git status                            # conflict list must match merge-tree output
```

**Success criteria:** worktree open in merge state; DB backed up; baseline test count recorded; conflicts are exactly: `AGENTS.md`, `app/portfolio/page.tsx`, `lib/ai-app-assistant.ts`, `lib/ai-compare.ts`, `lib/ai/router.ts`, `lib/portfolio/thesis.ts` (content) + `app/api/portfolio/new-positions/route.ts` (modify/delete).
**Stop conditions:** merge-tree shows any conflict not on that list (a branch moved — re-audit before proceeding) · DB backup fails · another session is writing to the worktree.
**Rollback:** `git merge --abort`; delete worktree. Total cost of abandonment: minutes.

---

## Phase 2 — Everything mechanical (~3–4 hours)

**Covers:** MERGE_PLAN P2 + P3 + P7 (disjoint acceptance, schema union, docs/assets).
**Why compressed:** these are low-risk, independent workstreams with no ordering constraints between them; splitting them into three phases was process, not safety. The AI spine stays OUT of this phase deliberately.

**2a. Accept the disjoint 95%.** All A-only paths (simulator, watchlist, portfolio engines, new tests) and B-only paths (engine, screener suite, brand code, availability, devin provider, dataset SWR, new tests) stage as-is. Each founder skims their own side's arrival — 15 minutes each, not a ceremony. Union `package.json` (B adds `zod` + `brand:assets`), then:

```bash
npm install                           # regenerates package-lock.json — never merge it
```

**2b. Schema union — line-read `lib/db.ts`.** The auto-merge is a draft. Verify top-to-bottom: every block guarded (`IF NOT EXISTS` / guarded `ADD COLUMN`); A's watchlist-group seeding after table creation; `portfolio_id` defaults intact; B's `saved_screen.last_symbols/last_run_at` + `decision.case_version` present. Answer key if unsure: `git show 6585052:lib/db.ts`.

```bash
# fresh-DB boot
DB_PATH=/tmp/merge-fresh.db npx vitest run tests/watchlist-groups-db* tests/simulator-db* tests/multi-portfolio-db* tests/portfolio-stage-db*
# migrated-DB boot — against a COPY of the backup, never the live file
cp ~/uaa-backups/app.db.* /tmp/merge-migrated.db && DB_PATH=/tmp/merge-migrated.db npx vitest run tests/watchlist-groups-db*
```

**2c. Docs & generated assets.** `AGENTS.md`: concatenate both new sections (A's product rules + B's quant-engine/brand rules), ABANDONED banners intact. Rename B's migration records to `0{1,2,3}-*.prisha.md`; keep both spike scripts. Regenerate binaries:

```bash
npm run brand:assets                  # favicon/icons/public/brand from lib/brand/mark.ts
```

**2d. Phase gate:**

```bash
npx vitest run tests/simulator-* tests/watchlist-* tests/portfolio-* tests/screener-engine* tests/brand*
python verify_engine_equivalence.py   # max |diff| ≤ 1e-13
```

**Success criteria:** all listed suites green on both DB boot paths; equivalence verifier green; remaining unresolved = the AI files + UI compositions only.
**Stop conditions:** any DB suite red on the *migrated* path (migration-order bug — fix before anything else builds on it) · equivalence verifier reports non-zero drift.
**Rollback:** `git checkout --merge <path>` re-conflicts any single file; `git merge --abort` for full restart.

---

## Phase 3 — The AI spine, done together (~4–6 hours, both founders, same screen)

**Covers:** MERGE_PLAN P4 + P5. **Not compressible and not delegable** — this is where the historical clean-but-wrong auto-merge lives, and each founder holds the assumptions the other's code violates. Book the session; it is the calendar bottleneck of the whole merge.

Ordered steps (order is load-bearing):

1. **`lib/ai/models.ts`** — total `PROVIDER_LOCALITY` record, `isHostedProvider()`, unknown ⇒ local.
2. **`lib/ai/router.ts`** — B's chain as outer loop; every A mechanism inside `if (!isHostedProvider(id))`; hosted timeout ⇒ next provider, never halt. **Then do `routeStream` with the same care — read it as if git is lying to you, because last time it was.**
3. **`lib/ai-app-assistant.ts` + `lib/ai-compare.ts`** — A's typed errors stay; every advice string routes through `AI_RECOVERY_HINT`.
4. **Restore `app/api/portfolio/new-positions/route.ts`:**

```bash
git checkout origin/prisha-work -- app/api/portfolio/new-positions/route.ts
```

   Reconcile imports against `lib/ios/types.ts`; in `lib/ai-watchlist.ts` take `aiUnavailableMessage`, drop the `extractJsonObject` import (schema-validated `runAnalysis` replaced it). File the follow-up: "remove new-positions only with call-graph proof."
5. **Confirm the default provider order is still local-first.** If you find `devin,ollama` as default anywhere, that is Phase 5's decision, not this file's.

**Phase gate:**

```bash
npx vitest run tests/ai-*
git grep -n "ollama serve" -- 'lib' 'app' | grep -v availability   # expect zero live call sites
```

Plus a two-founder hand-trace of one hosted and one local attempt through both `route` and `routeStream`.

**Success criteria:** all AI suites green; both founders can each state the two invariants from the code ("no local mechanism runs on a hosted provider"; "hosted timeout falls through"); default order unchanged.
**Stop conditions:** any local mechanism reachable on the hosted path · any advice string bypassing the availability module · disagreement between founders on a resolution (resolve against the answer key `git show 6585052:lib/ai/router.ts` or stop for the day — do not merge tired).
**Rollback:** re-conflict the four files and redo; the reference resolution is the known-good answer.

---

## Phase 4 — UI composition, commit, full gate (~3–4 hours)

**Covers:** MERGE_PLAN P6 + P8. *(Path A starts here, running only the gate + smoke.)*

**4a. Resolve the last conflicts.**
- `lib/portfolio/thesis.ts`: A's +516 engine; B's messaging via the seam.
- `app/portfolio/page.tsx`: A's tab bar/ordering + B's `BrandEmptyState` in the empty book; **Simulator must be reachable with zero holdings.**
- Line-read the auto-merged drafts: `app/screener/page.tsx` (A's fields flow into B's chips/diagnostics — no parallel path), `ai-assistant.tsx`, `command-palette.tsx`, `globals.css`, `app/api/portfolio/audit/route.ts`.

**4b. Full gate — all eight, in order:**

```bash
git grep -l '<<<<<<<'                 # 1. empty
npx tsc --noEmit                      # 2. silent (only the documented pre-existing exceptions)
npx vitest run                        # 3. ≥ baseline + both sides' suites, all green
npx eslint app lib                    # 4. only the two documented pre-existing issues
npm run build                         # 5. green — tsc alone does NOT prove pages render
uaa start                             # 6. host-health-gated dev server, then browser smoke:
#    /  /portfolio (empty + populated)  /watchlist  /screener (results + why-empty)
#    /compare (stream one verdict; force one failure — message must be typed + correct advice)
#    /engine  /settings
python verify_engine_equivalence.py   # 7. + one engine Fast Run, StageTimer in expected range
node scripts/perf-baseline.mjs        # 8. no route >10% worse than Phase 1 baseline
```

**4c. Commit the merge** with a resolution-record message (model: `git show 6585052` — enumerate: router composition + locality rule, restored route + vocabulary move, db.ts both-kept, copy composition, records side-by-side, default unchanged and why). Other founder reads `git show -m` of the merge commit before anything is pushed.

**Success criteria:** all 8 gates green; merge committed; second founder approved the final diff.
**Stop conditions:** gate 5 red on tsc-green code (Server/Client boundary — fix before commit) · any smoke page fails to render · AI failure message names a provider path that doesn't exist.
**Rollback:** before commit `git merge --abort`; after commit `git reset --hard pre-merge-A` (nothing pushed).

---

## Phase 5 — Harden, then decide the default (~2–3 hours + sign-off)

**Covers:** MERGE_PLAN P9 + P10, as ordinary small commits on the integration branch.

**5a. The regression trap (highest-value work in the plan).** Add hosted-bypass tests to `tests/ai-router.test.ts` (or a new `tests/ai-hosted-path.test.ts`): hosted provider skips generation gate / residency probe / cold-start widening; hosted timeout falls through. **Prove they're load-bearing:** temporarily invert `isHostedProvider` locally — tests must go red — then restore and commit green.

**5b. Sweeps.**

```bash
git grep -n "ollama serve" -- lib app          # zero
# duplicate-implementation check: exactly one total-return, one recommendation-band source
```

Call-graph verdict on `new-positions` (`/serena find_referencing_symbols`) → keep or remove **in its own commit, with the evidence in the message**. Quick doc-truth pass: merged docs describe the seam and shipped behavior, not a retired stack.

**5c. Product gate — the default provider order.** Separate conversation, not a code review: measured case (hosted 3.9–8.3s vs local 28–115s; 9 concurrent IC prompts in 5.3s) versus the open blockers (confidence calibration, cost verification). Whatever is decided, it is **one line in `lib/ai/config.ts` + a badge/attribution truth check + a docs line**, in its own commit, trivially revertable. This is the decision that merged silently last time and had to be hunted down — it does not get to be a side effect again.

**Success criteria:** hosted-bypass tests exist and were proven red-under-fault; sweeps clean; route disposition evidenced; default-order decision written down with a name on it; full suite green.
**Stop conditions:** hosted-bypass test does NOT go red under fault (it's decorative — rewrite it) · blockers unresolved and someone wants the flip anyway (record local-first and move on).
**Rollback:** individual commit reverts; the default flip is designed to be a one-line revert.

**Afterwards:** fast-forward/PR the integration branch, `git worktree remove ../uaa-merge`, lift the one-writer rule.

---

## Duration & critical path

| Phase | Duration | Parallelizable? |
|---|---|---|
| 1 Prep + open | ~1h | — |
| 2 Mechanical | ~3–4h | 2a/2b/2c can split between founders |
| 3 AI spine | ~4–6h | **No — both founders, together** |
| 4 UI + commit + gate | ~3–4h | Smoke checks can split |
| 5 Harden + decide | ~2–3h + sign-off | 5a/5b can split |

**Total: ~2–3 focused days (Path B) · ~half a day (Path A).**
**Critical path:** 1 → 2b → 3 → 4 → 5a. Phase 3 is the bottleneck and it's a *scheduling* bottleneck (two humans, one screen) — book it first.

---

## The checklist

Work top to bottom; every `[ ]` is a stop-point. Don't start a line until the one above is done.

**Phase 1 — Prep**
- [ ] 1. One-writer rule agreed: nothing else writes to `../uaa-merge` until the merge commits
- [ ] 2. `git tag pre-merge-A divit-local && git tag pre-merge-B origin/prisha-work`
- [ ] 3. `git worktree add ../uaa-merge -b integration/redo-best-of-both divit-local`
- [ ] 4. `cp data/app.db ~/uaa-backups/app.db.$(date +%Y%m%d)`
- [ ] 5. Baseline: `npx vitest run` (record count) + `node scripts/perf-baseline.mjs`
- [ ] 6. `git merge-tree --write-tree divit-local origin/prisha-work` → exactly the 7 known conflicts; **STOP if different**
- [ ] 7. `git merge --no-commit --no-ff origin/prisha-work`; `git status` matches step 6

**Phase 2 — Mechanical**
- [ ] 8. Disjoint paths staged intact (each founder skims own side, ~15 min)
- [ ] 9. `package.json` union → `npm install` (lockfile regenerated, not merged)
- [ ] 10. Line-read `lib/db.ts` migrations: guarded, ordered, both sides present (answer key: `git show 6585052:lib/db.ts`)
- [ ] 11. Fresh-DB and migrated-DB (copy!) boot tests green
- [ ] 12. `AGENTS.md` concatenated; migration records side-by-side (`*.prisha.md`); ABANDONED banners intact
- [ ] 13. `npm run brand:assets` (binaries regenerated, merged drafts discarded)
- [ ] 14. Gate: targeted suites green + `python verify_engine_equivalence.py` green

**Phase 3 — AI spine (pair session)**
- [ ] 15. `lib/ai/models.ts`: total `PROVIDER_LOCALITY`, `isHostedProvider()`, unknown ⇒ local
- [ ] 16. `lib/ai/router.ts`: chain outer loop; local mechanisms gated `!isHostedProvider`; hosted timeout falls through
- [ ] 17. Same treatment applied and hand-verified in `routeStream`
- [ ] 18. `ai-app-assistant.ts` + `ai-compare.ts`: typed errors kept, advice via `AI_RECOVERY_HINT`
- [ ] 19. Restore `new-positions` from B; reconcile `lib/ios/types.ts` + `lib/ai-watchlist.ts`; file removal follow-up
- [ ] 20. Default provider order confirmed local-first
- [ ] 21. Gate: `npx vitest run tests/ai-*` green; `git grep "ollama serve"` clean; both founders hand-trace hosted + local through `route` and `routeStream`

**Phase 4 — Compose, commit, gate**
- [ ] 22. `lib/portfolio/thesis.ts`: A's engine + seam messaging
- [ ] 23. `app/portfolio/page.tsx`: A's tabs + B's BrandEmptyState; Simulator reachable at zero holdings
- [ ] 24. Line-read drafts: `screener/page.tsx`, `ai-assistant.tsx`, `command-palette.tsx`, `globals.css`, `audit/route.ts`
- [ ] 25. `git grep -l '<<<<<<<'` → empty
- [ ] 26. Full gate: tsc → vitest (≥ baseline union) → eslint (known-only) → `npm run build` → browser smoke (incl. one AI success + one forced AI failure) → engine verifier + Fast Run → perf vs baseline
- [ ] 27. Commit with resolution-record message; other founder reads `git show -m` and approves

**Phase 5 — Harden + decide**
- [ ] 28. Hosted-bypass tests added; proven red under inverted `isHostedProvider`; committed green
- [ ] 29. Sweeps: zero hardcoded recovery strings; single implementations confirmed (total return, recommendation bands)
- [ ] 30. `new-positions` call-graph verdict executed in its own evidenced commit
- [ ] 31. Doc-truth pass over merged docs
- [ ] 32. Default-provider decision made and written down (name + date); if flipped: one-line change + badge/docs truth check
- [ ] 33. Full suite green; integration branch PR'd/fast-forwarded; `git worktree remove ../uaa-merge`; one-writer rule lifted

---

*Compression map: Phase 1 = MERGE_PLAN P0–P1 · Phase 2 = P2+P3+P7 · Phase 3 = P4+P5 · Phase 4 = P6+P8 · Phase 5 = P9+P10. Dropped as two-founder overhead: witness roles, reviewer matrices, written invariant sign-offs (replaced by: the other founder reads the diff; the AI spine is done together). Every technical decision, dependency ordering, rollback path, validation gate, and conflict resolution from the four source documents is preserved unchanged. No source code was modified.*
