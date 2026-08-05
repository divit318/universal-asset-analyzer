# MERGE_PLAN.md — Implementation Plan for Merging `divit-local` × `origin/prisha-work`

**Role:** Lead architect merge plan · **Status:** Plan only — no source modified
**Inputs:** `MERGE_SUMMARY.md` (audit + conflict evidence) · `CHANGE_MANIFEST.md` (per-change manifest) · `PROJECT_DIFF.md` (decisions D1–D9, risk matrix, dependency graph)
**Branches:** A = `divit-local` @ `74ad42c` · B = `origin/prisha-work` @ `4c10c1d` · base = `98500e1`
**Date:** 2026-08-06

---

## 0. Strategy

### 0.1 The safest possible strategy — in order of preference

**Option 0 (recommended if history permits): adopt the existing verified resolution.**
This exact merge was already performed, hand-resolved, and verified on `main` at `6585052` (build green, 2,647 tests green, tsc/eslint deltas confirmed pre-existing), then hardened by `cac4ddb` (fallout fix) and `1e1a34b` (provider-default revert). If the goal is "these two branches combined," the lowest-risk path is to take `main` at `cac4ddb`/`1e1a34b` as the merge result and run only the validation phases of this plan (P8–P10) as an audit. Re-executing the merge by hand cannot be safer than adopting a resolution that has already survived review and follow-up fixes.

**Option 1 (this plan): re-execute the merge with the resolution record as a playbook.**
If a fresh merge is required (e.g., to produce a different integration branch, or to revisit specific resolutions), follow the phases below. The plan is designed around the two empirical facts this repo's history teaches:

1. **The dangerous conflicts are the invisible ones.** git auto-merged `routeStream` into applying local-provider gating to hosted providers — it compiled, tests passed, and it was wrong (MERGE_SUMMARY §12.1). Therefore this plan treats *clean* merges of designated files as unreviewed drafts, not results.
2. **Merges can smuggle product decisions.** B's `AI_PROVIDER_ORDER=devin,ollama` default flipped the product to hosted inference the moment it merged, despite unresolved sign-off blockers (PROJECT_DIFF §3.3-S3). Therefore product defaults are quarantined into their own phase (P10) with their own approver.

### 0.2 Mechanics

- All work happens on a new integration branch: `git checkout -b integration/redo-best-of-both divit-local`.
- One merge commit (`git merge --no-commit origin/prisha-work`) — git requires all conflicts resolved before the merge can be committed, so **Phases P2–P7 are ordered resolution workstreams inside a single merge working session**, each ending with a validation gate run against the working tree (vitest/tsc run fine on a dirty tree). The merge is committed only at P8.
- **"Tests pass after every phase"** is enforced two ways: (a) the per-phase gates below run the relevant suites against the in-progress tree; (b) the committed history contains only green states (pre-merge tag → merge commit → hardening commits), so `git bisect` never lands on a red commit.
- **Working-tree hygiene (mandatory):** this repository currently hosts multiple concurrent agent sessions writing to one tree (observed live during the audit: `lib/db.ts`, `lib/movement-explainer.ts`, `tests/ai-eval/golden.ts` changed mid-session by another session). The merge MUST be executed in a **dedicated worktree** (`git worktree add ../uaa-merge integration/redo-best-of-both`) with a one-writer rule for its duration. A merge performed in a shared tree cannot distinguish its own resolution state from a neighbor's in-flight edits.

### 0.3 Invariants (checked at every gate)

| Invariant | How enforced |
|---|---|
| No functionality lost | Feature inventory (MERGE_SUMMARY §2) spot-checks per phase; union of both test suites runs green; the D5 route is restored, not dropped |
| No duplicate implementations remain | The 4 known duplicates (PROJECT_DIFF §3.1) each have a composition rule; P9 greps for residuals (hardcoded recovery strings, second total-return implementations) |
| Better implementation preserved | Every overlap resolved per PROJECT_DIFF §1–2 decisions (Keep A / Keep B / Combine) — never by merge-tool default |
| Tests keep passing | `npx vitest run` at every gate; targeted suites per phase; `npm run build` at P8 (tsc alone does not prove pages render) |

---

## 1. Files that must never be auto-merged / review classes

### 1.1 Never auto-merge (hand-resolve or regenerate; merge-tool output is only a draft)

| File | Reason | Phase |
|---|---|---|
| `lib/ai/router.ts` | Site of the proven clean-but-wrong auto-merge (`routeStream`) | P4 |
| `lib/ai/models.ts` | `PROVIDER_LOCALITY` / `isHostedProvider()` — misclassification silently changes timeout/gating/fallback everywhere | P4 |
| `lib/db.ts` | Interleaved boot-time migrations against a live user DB; order + idempotency need human eyes | P3 |
| `app/api/portfolio/new-positions/route.ts` | Modify/delete conflict; existence coupled to `lib/ai-watchlist.ts` + `lib/ios/types.ts` | P5 |
| `lib/ai-app-assistant.ts`, `lib/ai-compare.ts` | Two failure-copy philosophies must be composed (D2), not picked | P4 |
| `AGENTS.md`, `CLAUDE.md`, `lib/ai/ARCHITECTURE.md` | Prose does not interleave; stale prescriptions must not resurrect | P7 |
| `app/favicon.ico`, `app/apple-icon.png`, `app/icon.svg`, `public/brand/*` | Binaries — regenerate via `npm run brand:assets` | P7 |
| `package-lock.json` | Regenerate via `npm install` after `package.json` resolves | P2 |
| `data/*`, `*.log`, `tsconfig.tsbuildinfo` | Runtime/build artifacts — must not enter the merge at all | P0 |
| `ai-migration/0{1,2,3}-*.md` | Two architectures documented; keep side-by-side (`*.prisha.md`), never interleave | P7 |

### 1.2 Manual review required (auto-merge accepted as draft, then read line-by-line)

`app/portfolio/page.tsx` · `app/screener/page.tsx` · `lib/portfolio/thesis.ts` · `app/_components/ai-assistant.tsx` · `app/_components/command-palette.tsx` · `app/globals.css` · `lib/screener/universes/{crypto,fund-shared}.ts` · `tests/ai-router.test.ts` · `tests/screener-universes.test.ts` · `app/api/portfolio/audit/route.ts`

### 1.3 Pair review required

- **P4 in its entirety** (`router.ts`, `models.ts`, failure copy) — one reviewer from each branch's authorship (Divit + Prisha), because each holds the assumptions the other's code violates.
- **P3 migration ordering** — author of A's schema (Divit) + one second reader.
- **P10 provider default** — product owner sign-off, not an engineering review.

### 1.4 Regression-testing areas

| Area | Suites / checks |
|---|---|
| AI routing & fallback | `ai-router`, `ai-timeout`, `ai-provider-chain`, `ai-devin-cli`, `ai-errors`, `ai-health`, **new hosted-bypass test (P9)** |
| Portfolio math | `portfolio-performance` (782), `portfolio-attribution`, `portfolio-transaction`, `portfolio-cash*`, `portfolio-optimize-funding`, `portfolio-classification-authority`, `portfolio-risk-*` |
| Watchlist & alerts | `watchlist-groups-db`, `watchlist-metrics`, `alerts`, `price-crossing`, `export` |
| Screener | `screener-engine`, `screener-universes` + load `/screener` in a browser (H4 is render-detectable only) |
| Simulator | `simulator-{db,edit,generate,intake,preferences}` |
| Python engine | `python verify_engine_equivalence.py` + one Fast Run with timing output |
| Brand | `brand.test.ts` + visual check of favicon/header/empty states |
| DB migrations | Fresh-DB boot + migrated-DB boot (backup copy) both reach a working app |

---

## 2. Phases

> Effort scale: S ≤ 2h · M ≤ half-day · L ≤ 1.5 days. All estimates assume one engineer plus the named reviewer, with the resolution record (`git show 6585052`) open as reference.

---

### Phase P0 — Preparation & safety net

- **Goal:** A frozen, recoverable, measurable starting state in an isolated worktree.
- **Why this phase exists:** The only non-git state (`data/app.db`) has no downgrade path; the shared working tree has live concurrent writers; baseline numbers make later performance claims falsifiable.
- **Files affected:** None in source. Creates: tags `merge-base-98500e1`, `pre-merge-A`, `pre-merge-B`; a dated copy of `data/app.db`; worktree `../uaa-merge`.
- **Dependencies:** None.
- **Estimated conflicts:** None.
- **Merge approach:** `git tag` both tips and the base · `git worktree add ../uaa-merge -b integration/redo-best-of-both divit-local` · copy `data/app.db` aside · run `node scripts/perf-baseline.mjs` (from B's tree if not yet present: `git show origin/prisha-work:scripts/perf-baseline.mjs`) · confirm `git status` is clean in the new worktree · verify no `data/`, `*.log`, `tsconfig.tsbuildinfo` files are tracked deltas between the branches.
- **Validation steps:** `npx vitest run` green on `divit-local` (baseline); record the count. `git merge-tree --write-tree divit-local origin/prisha-work` output matches the known 7 conflicts (drift check — if new conflicts appear, branches moved; stop and re-audit).
- **Rollback strategy:** Nothing to roll back; delete the worktree.
- **Completion criteria:** Tags exist; DB backed up; baseline test count + perf numbers recorded; merge-tree output matches MERGE_SUMMARY §13 exactly.
- **Effort:** S · **Reviewer:** any engineer (self-review acceptable).

---

### Phase P1 — Trial merge & conflict inventory

- **Goal:** The merge working session opened with a verified conflict map.
- **Why this phase exists:** Everything after this operates inside one `--no-commit` merge; starting it with a checked inventory prevents "I thought that auto-merged" surprises.
- **Files affected:** Entire tree enters merge state; no resolutions yet.
- **Dependencies:** P0.
- **Estimated conflicts:** Exactly 7 (6 content: `AGENTS.md`, `app/portfolio/page.tsx`, `lib/ai-app-assistant.ts`, `lib/ai-compare.ts`, `lib/ai/router.ts`, `lib/portfolio/thesis.ts`; 1 modify/delete: `app/api/portfolio/new-positions/route.ts`).
- **Merge approach:** `git merge --no-commit --no-ff origin/prisha-work` in the worktree. Snapshot `git status` and `git diff --name-only` to a scratch file. Cross-check the auto-merged overlap list (11 files, §1.2) against MERGE_SUMMARY §13.
- **Validation steps:** Conflict list == expected list. No unexpected binary conflicts.
- **Rollback strategy:** `git merge --abort` returns to pristine `divit-local` in seconds.
- **Completion criteria:** Signed-off conflict inventory; merge session open.
- **Effort:** S · **Reviewer:** merge executor + one witness (list comparison is a two-eyes task).

---

### Phase P2 — Accept the disjoint 95% (engine, portfolio engines, brand code, screener suite, simulator, watchlist)

- **Goal:** All genuinely non-overlapping work from both sides staged as-is.
- **Why this phase exists:** 382 of 400 paths are disjoint; accepting them first shrinks the review surface to the 18 files that matter and lets the full test union run early.
- **Files affected:** All B-only additions (`engine/**`, `lib/screener/{universe-stats,filter-engine,pipeline}.ts`, `app/screener/_components/{distribution-bar,filter-chips,why-empty,screen-diff}.tsx`, `lib/brand/**`, `app/_components/brand.tsx`, `lib/dataset.ts`, `lib/assets/**`, `lib/ai/{availability,platform-health}.ts`, `lib/ai/devin-cli.ts`, `lib/ai/providers/devin-provider.ts`, `lib/ai/schemas/verdict.ts`, `scripts/*`, B's tests) and all A-only additions (simulator, watchlist components/routes, portfolio engines, `lib/{idea-source,live-quotes,price-crossing,watchlist-metrics,table-window}.ts`, A's tests). Plus `package.json` (B adds zod + script — trivial union) and regenerate `package-lock.json` via `npm install`.
- **Dependencies:** P1.
- **Estimated conflicts:** 0 (by definition disjoint); `package.json` merges clean.
- **Merge approach:** Accept auto-merge results for disjoint paths unchanged. Do NOT yet touch the 7 conflicts or the 10 §1.2 manual-review files beyond leaving their auto-merge drafts in place.
- **Validation steps:** `npx tsc --noEmit` will still fail (conflict markers present in 7 files) — expected; instead run targeted suites that don't import conflicted modules: `npx vitest run tests/simulator-* tests/watchlist-* tests/portfolio-performance* tests/screener-engine* tests/brand*`. Run `python verify_engine_equivalence.py`.
- **Rollback strategy:** `git checkout --merge <path>` re-conflicts any single file; `git merge --abort` for total restart.
- **Completion criteria:** Targeted suites green; equivalence verifier green; only the known conflict/manual-review set remains unresolved.
- **Effort:** M · **Reviewer:** Divit for A-side acceptance spot-checks, Prisha for B-side (each verifies their own work arrived intact).

---

### Phase P3 — Schema union (`lib/db.ts`)

- **Goal:** One `getDb()` containing both sides' migrations, correctly ordered, idempotent, safe against a live DB.
- **Why this phase exists:** Everything downstream reads these tables; a bad interleave corrupts the one store with no downgrade path. Auto-merge produces a draft that has been *textually* fine before — the review is about **order and idempotency**, which git cannot see.
- **Files affected:** `lib/db.ts` (A: +943 — 6 tables, 8 columns; B: +54 — `saved_screen.last_symbols/last_run_at`, `decision.case_version`).
- **Dependencies:** P2 (so schema-consuming tests exist in-tree).
- **Estimated conflicts:** Auto-merges (not in the 7), but classified never-trust (§1.1).
- **Merge approach:** Read the merged `getDb()` top to bottom: every `CREATE TABLE IF NOT EXISTS` / `ADD COLUMN` guarded; A's watchlist-group seeding runs after table creation; `portfolio_id` defaults intact; B's `saved_screen` columns and `decision.case_version` present (the resolution kept both — verify against `git show 6585052:lib/db.ts` if in doubt).
- **Validation steps:** (1) Fresh-DB boot: `DB_PATH=/tmp/merge-fresh.db npx vitest run tests/*db*`; (2) Migrated-DB boot: point a scratch server at a **copy** of the P0 backup, confirm app loads and watchlist/screener/decisions read correctly; (3) `npx vitest run tests/watchlist-groups-db tests/simulator-db tests/multi-portfolio-db tests/portfolio-stage-db`.
- **Rollback strategy:** Re-conflict the single file (`git checkout --merge lib/db.ts`) and redo; live-DB damage is prevented by only ever booting against copies until P8.
- **Completion criteria:** Both boot paths verified; all DB suites green; second reader signs the migration order.
- **Effort:** M · **Reviewer:** Divit (schema author) + one second reader — **pair review**.

---

### Phase P4 — AI platform spine (`models.ts` → `router.ts` → failure copy) — THE CRITICAL PHASE

- **Goal:** B's lazy provider chain as the outer loop, with **all** of A's local-reliability work preserved inside it and conditioned on provider locality; failure copy composed (A's diagnosis + B's advice).
- **Why this phase exists:** This is where both branches solved the same problem with mutually-invisible assumptions, where neither is a superset, and where the historical clean-but-wrong auto-merge lives. It is deliberately sequenced *after* the tree is otherwise quiet so reviewers look at nothing else.
- **Files affected:** `lib/ai/models.ts` (never-auto-merge), `lib/ai/router.ts` (never-auto-merge; conflict), `lib/ai-app-assistant.ts` (conflict), `lib/ai-compare.ts` (conflict), and read-through of `lib/ai/{errors,health,log,ollama,provider,task-registry}.ts`, `lib/ai/providers/*` for seam consistency.
- **Dependencies:** P2 (availability module + devin provider in tree), P3 not strictly required but keeps the tree stable.
- **Estimated conflicts:** 3 of the 7 content conflicts, plus 2 never-trust auto-merges (`models.ts`; `routeStream` inside `router.ts`).
- **Merge approach (ordered):**
  1. **`models.ts` first:** establish `ProviderId`, `PROVIDER_LOCALITY` as a **total Record** (compile error on unclassified provider), `isHostedProvider()` phrased as *is hosted* so unknown ids get conservative local treatment (FakeProvider and the whole test suite depend on this).
  2. **`router.ts`:** B's `attemptOrder()` generator as the outer loop. Inside the loop, every A mechanism — generation gate, residency probe, widened cold-start budget, capped cold-timeout fallback, keep_alive — executes **only when `!isHostedProvider(id)`**. Hosted timeout ⇒ fall through to next provider (never halt the chain). Apply the identical treatment to `routeStream` — this is the exact spot git got wrong.
  3. **Failure copy:** in `ai-app-assistant.ts` / `ai-compare.ts`, keep A's per-error-type messages (stage/timeout/missing-model) but route every piece of *recovery advice* through `AI_RECOVERY_HINT` / `aiUnavailableMessage()`.
  4. Leave the provider-order **default local-first** (A's implicit behavior). The flip is P10's decision, not P4's.
- **Validation steps:** `npx vitest run tests/ai-*` (router, timeout, errors, health, provider-chain, devin-cli, compare) — all green; hand-trace one hosted and one local attempt through both `route` and `routeStream` in review; grep the tree for `ollama serve` outside `availability.ts`/docs (must be zero live call sites).
- **Rollback strategy:** Re-conflict the four files and redo from the playbook; the reference resolution (`git show 6585052:lib/ai/router.ts`) is the known-good answer key.
- **Completion criteria:** All AI suites green; pair reviewers each sign a written statement of the two invariants ("no local mechanism executes on a hosted provider"; "hosted timeout falls through"); default order confirmed local-first.
- **Effort:** L (the majority of total merge risk and roughly a third of total effort) · **Reviewer:** **Pair review — Divit + Prisha jointly**, as authors of the colliding assumptions.

---

### Phase P5 — Modify/delete resolution: `new-positions` route + vocabulary move

- **Goal:** The route restored (B's version), its objective/constraint/recommendation vocabulary relocated to `lib/ios/types.ts`, and a tracked follow-up to remove it only after call-graph proof.
- **Why this phase exists:** A deleted a route that B modified and that `lib/ai-watchlist.ts` still documents as a live caller. Accepting the deletion silently breaks the watchlist AI flow; accepting restoration without the vocabulary move re-duplicates types A had already migrated.
- **Files affected:** `app/api/portfolio/new-positions/route.ts` (restore from B), `lib/ios/types.ts` (vocabulary target), `lib/ai-watchlist.ts` (verify references; take `aiUnavailableMessage`, drop the `extractJsonObject` import per the resolution — schema-validated `runAnalysis` replaced manual extraction).
- **Dependencies:** P4 (ai-watchlist's messaging depends on the composed availability seam).
- **Estimated conflicts:** The 1 modify/delete conflict.
- **Merge approach:** `git checkout origin/prisha-work -- app/api/portfolio/new-positions/route.ts`, then reconcile its imports against A's moved types; do not resurrect A's deleted test — the route's coverage rides on the watchlist suites.
- **Validation steps:** `npx tsc --noEmit` on the touched modules (tree-wide tsc still deferred to P8 if other markers remain); `npx vitest run tests/ai-watchlist* tests/watchlist-*`; hit the route once against a dev server in P8's smoke pass.
- **Rollback strategy:** Re-delete + re-restore is a two-command operation; nothing else depends on the file at build time.
- **Completion criteria:** Route present, compiles, watchlist suites green; a TODO/issue exists: "remove new-positions after call-graph verification."
- **Effort:** S · **Reviewer:** Divit (author of the deletion — must concede or defend it against the caller evidence).

---

### Phase P6 — UI compositions (portfolio page, screener page, shared chrome)

- **Goal:** The three user-facing compositions done by hand: portfolio page (A's tabs/ordering + B's `BrandEmptyState` inside the empty book, Simulator reachable at zero holdings), screener page (B's legibility suite hosting A's field plumbing), shared chrome (`ai-assistant.tsx`, `command-palette.tsx`, `globals.css` — auto-merged drafts read line-by-line).
- **Why this phase exists:** These are the places where "both sides are right" must render as one screen; H4 (screener state-shape drift) is detectable only by rendering.
- **Files affected:** `app/portfolio/page.tsx` (conflict), `app/screener/page.tsx`, `app/_components/ai-assistant.tsx`, `app/_components/command-palette.tsx`, `app/globals.css`, `lib/portfolio/thesis.ts` (conflict — A's +516 thesis engine wins the logic; B's unavailable-message line rides through the P4 seam), `app/api/portfolio/audit/route.ts` (manual read).
- **Dependencies:** P2 (brand components exist), P4 (assistant/copy seams final), P3 (tables the pages read).
- **Estimated conflicts:** 2 remaining content conflicts (`app/portfolio/page.tsx`, `lib/portfolio/thesis.ts`) + 5 manual-review drafts.
- **Merge approach:** Resolve `thesis.ts` as Keep-A-logic + P4 messaging. Compose `portfolio/page.tsx` per PROJECT_DIFF A10. Read the screener page draft against B's `filter-state.ts` shape; verify A's added fields flow into B's chips/diagnostics rather than a parallel path.
- **Validation steps:** `npx vitest run tests/portfolio-thesis tests/pipeline-board tests/mission-control`; `npm run dev` in the worktree (respecting `uaa start` host-health rules) and load `/portfolio` (empty + populated), `/screener` (run a screen, empty a screen, check why-empty), `/compare` (stream a verdict, force a failure, read the message).
- **Rollback strategy:** Per-file re-conflict; UI phases have no data side effects.
- **Completion criteria:** Pages render; BC3/BC4 behaviors verified (PROJECT_DIFF §3.4); no conflict markers remain anywhere (`git grep -l '<<<<<<<'` returns nothing).
- **Effort:** M–L · **Reviewer:** Divit for portfolio composition, Prisha for screener composition.

---

### Phase P7 — Documentation & generated assets

- **Goal:** Both sides' knowledge preserved without letting either side's stale prescriptions become guidance; binaries regenerated, never merged.
- **Why this phase exists:** Prose does not interleave; the redesign is ABANDONED by owner decision; two AI-migration architectures must remain distinguishable; brand binaries cannot be content-merged.
- **Files affected:** `AGENTS.md` (conflict — concatenate both new sections: A's product rules + B's quant-engine/brand rules), `CLAUDE.md`, `lib/ai/ARCHITECTURE.md`, `ai-migration/*` (keep B's as `0{1,2,3}-*.prisha.md`; keep both spike scripts), `docs/redesign/**` + `docs/concept/**` (keep, ABANDONED banners intact), `docs/{LOGO-IMPLEMENTATION,brand-guidelines}.md`, regenerate `app/{favicon.ico,icon.svg,apple-icon.png}` + `public/brand/*` via `npm run brand:assets`.
- **Dependencies:** P2 (brand generator in tree). Independent of P3–P6 otherwise.
- **Estimated conflicts:** 1 content conflict (`AGENTS.md`); the rest are adds or regeneration.
- **Merge approach:** Concatenate-and-attribute for guidance docs; rename-don't-merge for migration records; regenerate-don't-merge for binaries; confirm every doc that names an AI provider names the *seam*, not a hardcoded provider.
- **Validation steps:** `npx vitest run tests/brand*`; visual check of favicon/lockup; `git grep -n "tm-"` in docs paths only (no live code references to the abandoned terminal styling); a reader can find both migration architectures from `ai-migration/` alone.
- **Rollback strategy:** Docs and generated assets are freely re-doable; no runtime coupling.
- **Completion criteria:** `AGENTS.md` carries both sections; migration records side-by-side; assets regenerated from `lib/brand/mark.ts`; zero remaining conflict markers in the tree.
- **Effort:** S–M · **Reviewer:** Prisha (brand/docs author) + doc-owner skim of AGENTS.md.

---

### Phase P8 — Merge commit & full validation gate

- **Goal:** The single merge commit, created only from a fully green tree, with a resolution-record commit message.
- **Why this phase exists:** The merge commit is the atomic unit of rollback and the permanent record; its message must document every non-obvious resolution (the `6585052` message is the model — it is why this plan could be written).
- **Files affected:** All staged content from P2–P7.
- **Dependencies:** P2–P7 complete.
- **Estimated conflicts:** 0 remaining.
- **Merge approach:** Full gate, then `git commit` with a message enumerating: router composition + locality rule, restored route + vocabulary move, db.ts both-sides-kept, failure-copy composition, both migration record sets kept, default provider order unchanged and why.
- **Validation steps (all must pass):**
  1. `git grep -l '<<<<<<<'` → empty
  2. `npx tsc --noEmit` → silent (modulo the documented pre-existing facade-test error — verify it matches the known list, nothing new)
  3. `npx vitest run` → full union green; count ≥ P0 baseline + both sides' new suites
  4. `npx eslint app lib` → only the documented pre-existing issues
  5. `npm run build` → green (catches Server/Client boundary errors tsc misses)
  6. Browser smoke: `/` `/portfolio` `/watchlist` `/screener` `/compare` `/engine` `/settings` load; one AI call succeeds; one AI failure shows composed messaging
  7. `python verify_engine_equivalence.py` + one engine Fast Run with StageTimer output in expected range
  8. Perf spot-check vs P0 baseline (`scripts/perf-baseline.mjs`) — no route's initial JS or LCP regresses >10%
- **Rollback strategy:** Before commit: `git merge --abort`. After commit: `git reset --hard pre-merge-A` on the integration branch (nothing has been pushed or fast-forwarded).
- **Completion criteria:** All 8 gates green; merge committed; gate results pasted into the commit message or PR description.
- **Effort:** M · **Reviewer:** both authors approve the final diff-of-the-merge (`git show -m`); one of them reads the merge message for accuracy.

---

### Phase P9 — Post-merge hardening (the debt this merge itself creates)

- **Goal:** Close the specific gaps the merge process is known to leave: untested hosted path, residual duplicate strings, unverified route caller, doc-claims drift.
- **Why this phase exists:** `main`'s history shows the merge was followed by `cac4ddb` (fallout) — this phase schedules that class of work instead of discovering it.
- **Files affected:** `tests/ai-router.test.ts` (+ new hosted-bypass assertions: hosted provider skips generation gate/residency/cold-start; hosted timeout falls through), possibly a new `tests/ai-hosted-path.test.ts`; grep-driven cleanups; call-graph verification for `new-positions` (then a separate removal PR if dead); doc-truth pass over merged docs vs shipped behavior.
- **Dependencies:** P8 committed.
- **Estimated conflicts:** None (post-merge commits).
- **Merge approach:** Ordinary small commits on the integration branch: (1) hosted-path tests — this is the highest-value 100 lines in the entire plan, it is the regression trap for H1; (2) `git grep -n "ollama serve"` / hardcoded advice sweep; (3) `find_referencing_symbols` (Serena) on the new-positions handlers → keep-or-remove decision with evidence; (4) doc claims audit (the one "rewrite" recommendation from PROJECT_DIFF §2.10).
- **Validation steps:** New tests fail if a local mechanism is applied to a hosted provider (verify by temporarily inverting `isHostedProvider` — test must go red); full suite green after.
- **Rollback strategy:** Individual commit reverts; nothing structural.
- **Completion criteria:** Hosted-bypass tests exist and are load-bearing (proven red-under-fault); zero hardcoded recovery strings; new-positions has an evidence-backed disposition; docs match shipped behavior.
- **Effort:** M · **Reviewer:** Prisha for the hosted-path tests (her provider), Divit for the route disposition (his deletion).

---

### Phase P10 — Product gate: default provider order

- **Goal:** An explicit, separately-approved decision on `AI_PROVIDER_ORDER`'s default — with the merge itself having shipped **local-first** (no product change).
- **Why this phase exists:** The one lesson `main`'s history teaches loudest: B's hosted-first default was a product decision gated on unresolved Blocker-1 (confidence calibration) and Blocker-2 (cost verification) sign-offs, and it merged silently. It had to be found and reverted (`1e1a34b`). This plan makes the decision impossible to smuggle: it is its own phase, after the merge, with its own approver.
- **Files affected:** `lib/ai/config.ts` (one line, only if approved) + the status badge truthfulness check + docs.
- **Dependencies:** P8 (merged), P9 (hosted path tested); the blocker sign-offs.
- **Estimated conflicts:** None.
- **Merge approach:** Present the measured case (hosted 3.9–8.3s vs local 28–115s; nine concurrent IC prompts in 5.3s) alongside the open blockers; product owner decides. If approved: flip default, verify the header badge and every AI attribution string tells the truth for the new default, update docs. If not: record the decision and the opt-in instruction (`AI_PROVIDER_ORDER=devin,ollama`).
- **Validation steps:** With the chosen default: one end-to-end AI call per major surface (verdict, compare, digest, brief); badge/attribution audit; cost telemetry glance if available.
- **Rollback strategy:** One-line revert; explicitly designed to be trivially reversible.
- **Completion criteria:** A written decision with named approver exists either way; config, badge, and docs agree with it.
- **Effort:** S (engineering) — the sign-offs are the long pole · **Reviewer:** **Product owner** (Divit as repo owner), not a code reviewer.

---

## 3. Dependency graph (phase level)

```
P0 ──► P1 ──► P2 ──┬──► P3 ──────────────┐
                   │                     │
                   ├──► P4 ──► P5 ──┐    │
                   │                ├──► P6 ──► P8 ──► P9 ──► P10
                   └──► P7 ─────────┘    │
                        (P7 joins at P8 if run in parallel)
Parallelizable: P3, P4, P7 may proceed concurrently after P2
                (different files, different reviewers).
Serial by necessity: P4 → P5 (ai-watchlist messaging) → P6 (UI reads final seams) → P8 → P9 → P10.
```

Decision-level dependencies within phases follow PROJECT_DIFF §5 (G-nodes): locality model before router; schema before features; brand before portfolio-page compose; copy before UI.

## 4. Phase ordering, effort, critical path

| Phase | Name | Effort | May parallelize with |
|---|---|---|---|
| P0 | Preparation | S | — |
| P1 | Trial merge | S | — |
| P2 | Disjoint acceptance | M | — |
| P3 | Schema union | M | P4, P7 |
| P4 | **AI spine** | **L** | P3, P7 |
| P5 | Route restore | S | P7 |
| P6 | UI compositions | M–L | — |
| P7 | Docs & assets | S–M | P3, P4, P5 |
| P8 | Commit & full gate | M | — |
| P9 | Hardening | M | — |
| P10 | Product gate | S (+sign-off latency) | — |

**Total estimated engineering effort:** ~4–6 focused engineer-days for one executor with two reviewers (≈ 1 day P0–P2, 1.5–2 days P4, 0.5 day P3+P5, 1 day P6, 0.5 day P7+P8, 0.5–1 day P9; P10 gated on non-engineering sign-offs). If Option 0 (adopt `main`'s resolution) is chosen instead: **~1 day** (P8-style audit + P9 hardening only).

**Critical path:** `P0 → P1 → P2 → P4 → P5 → P6 → P8 → P9 → P10`. P4 dominates: it is the largest single item, it cannot be parallelized internally (models.ts → router.ts is strictly ordered), and it requires both reviewers simultaneously. Everything else on the path is mechanical by comparison. Schedule the P4 pair-review session first; the calendar bottleneck is two humans in one room, not code volume.

## 5. Risk matrix (execution view — see PROJECT_DIFF §4 for the analytical view)

| Phase | Risk | Likelihood | Impact | Mitigation in-plan |
|---|---|---|---|---|
| P4 | Clean-but-wrong router semantics (H1) | High (precedent) | Every AI feature | Never-auto-merge class, ordered sub-steps, pair review, P9 red-under-fault test |
| P10 | Default flips silently | High if unphased | Privacy + cost posture | Quarantined phase, product approver, local-first through P8 |
| P3 | Migration misorder against live DB | Medium | User data | Copies-only until P8, dual boot validation, pair review |
| P5 | Route dropped, watchlist AI breaks | Certain if defaulted | One feature flow | Explicit restore step + caller evidence + tracked disposition |
| P6 | Screener state-shape drift (H4) | Low | Screener UX | Render-based validation mandated |
| P2 | Wrong side accepted for a "disjoint" file | Low | Varies | Author spot-checks own side's arrival |
| P8 | tsc-green / render-broken page | Medium | Any page | `npm run build` + browser smoke are hard gates |
| All | Concurrent session writes into merge tree | **High (observed live)** | Merge integrity | Dedicated worktree, one-writer rule (§0.2) |
| P0 | DB unback-up-able state later | Low | Irreversible | Backup is the first action of the plan |

## 6. Reviewer assignments (summary)

| Phase | Executor | Reviewer(s) | Mode |
|---|---|---|---|
| P0–P1 | Merge engineer | Any second engineer | Witness |
| P2 | Merge engineer | Divit (A-side) + Prisha (B-side) | Spot-check own side |
| P3 | Merge engineer | Divit + second reader | **Pair** |
| P4 | Merge engineer | **Divit + Prisha together** | **Pair, synchronous** |
| P5 | Merge engineer | Divit | Standard |
| P6 | Merge engineer | Divit (portfolio) / Prisha (screener) | Split |
| P7 | Merge engineer | Prisha + doc owner | Standard |
| P8 | Merge engineer | Both authors | Final-diff approval |
| P9 | Merge engineer | Prisha (tests) / Divit (route) | Split |
| P10 | Product owner | — | Sign-off |

---

## 7. Sequential execution checklist

Execute strictly in order; do not begin a step until the previous checkbox is verified. Each ☐ is a stop-point.

**P0 — Preparation**
- [ ] 1. Confirm no other agent/session will write to the merge worktree for the duration (one-writer rule)
- [ ] 2. `git tag merge-base-98500e1 98500e1 && git tag pre-merge-A divit-local && git tag pre-merge-B origin/prisha-work`
- [ ] 3. `git worktree add ../uaa-merge -b integration/redo-best-of-both divit-local`
- [ ] 4. Copy `data/app.db` to a dated backup outside the repo
- [ ] 5. Run baseline: `npx vitest run` (record count) + perf baseline; save outputs
- [ ] 6. `git merge-tree --write-tree divit-local origin/prisha-work` — confirm exactly the 7 known conflicts; **STOP if different**

**P1 — Open the merge**
- [ ] 7. In `../uaa-merge`: `git merge --no-commit --no-ff origin/prisha-work`
- [ ] 8. Snapshot `git status`; verify conflict list matches step 6; second engineer witnesses

**P2 — Disjoint acceptance**
- [ ] 9. Verify all A-only and B-only paths staged intact (authors spot-check their own side)
- [ ] 10. Resolve `package.json` (trivial union); run `npm install` to regenerate the lockfile
- [ ] 11. Run targeted suites (simulator, watchlist, portfolio-performance, screener-engine, brand) — green
- [ ] 12. `python verify_engine_equivalence.py` — green

**P3 — Schema union** *(may run in parallel with P4/P7 by a second engineer)*
- [ ] 13. Line-read merged `lib/db.ts` `getDb()`: order, idempotency, both sides' tables/columns present
- [ ] 14. Fresh-DB boot test green; migrated-DB boot (against a COPY of the backup) green
- [ ] 15. DB suites green; pair sign-off recorded

**P4 — AI spine (pair session)**
- [ ] 16. Resolve `lib/ai/models.ts`: total `PROVIDER_LOCALITY`, `isHostedProvider()`, conservative default
- [ ] 17. Resolve `lib/ai/router.ts`: chain as outer loop; every local mechanism gated on `!isHostedProvider`; hosted timeout falls through — **apply identically in `routeStream`**
- [ ] 18. Compose failure copy in `lib/ai-app-assistant.ts` + `lib/ai-compare.ts` (A's diagnosis, B's advice)
- [ ] 19. Confirm default provider order is local-first (no product change)
- [ ] 20. `npx vitest run tests/ai-*` green; `git grep "ollama serve"` clean outside availability/docs; both reviewers sign the two invariants

**P5 — Route restore**
- [ ] 21. Restore `app/api/portfolio/new-positions/route.ts` from B; reconcile imports with `lib/ios/types.ts`
- [ ] 22. Reconcile `lib/ai-watchlist.ts` (availability message in, manual JSON extraction out)
- [ ] 23. Watchlist AI suites green; removal-after-verification issue filed

**P6 — UI compositions**
- [ ] 24. Resolve `lib/portfolio/thesis.ts` (A's engine + P4 messaging)
- [ ] 25. Compose `app/portfolio/page.tsx` (A's tabs/order + B's BrandEmptyState; Simulator reachable at zero holdings)
- [ ] 26. Line-read `app/screener/page.tsx`, `ai-assistant.tsx`, `command-palette.tsx`, `globals.css`, `audit/route.ts` drafts
- [ ] 27. Dev-server render check: `/portfolio` (empty + populated), `/screener` (results + why-empty), `/compare` (stream + forced failure)
- [ ] 28. `git grep -l '<<<<<<<'` → empty

**P7 — Docs & assets** *(may run in parallel after P2)*
- [ ] 29. `AGENTS.md`: concatenate both new sections; ABANDONED redesign banners intact
- [ ] 30. `ai-migration/`: B's records renamed `*.prisha.md`; both spike scripts kept
- [ ] 31. Regenerate brand binaries: `npm run brand:assets`; discard any merged binary drafts
- [ ] 32. `CLAUDE.md` / `lib/ai/ARCHITECTURE.md` describe the seam, not a hardcoded provider

**P8 — Commit & full gate**
- [ ] 33. Gates 1–8 (§P8): markers · tsc · full vitest ≥ baseline union · eslint (known-only) · `npm run build` · browser smoke incl. one AI success + one AI failure · engine verifier + Fast Run · perf vs baseline
- [ ] 34. Write the resolution-record commit message (model: `git show 6585052`); commit the merge
- [ ] 35. Both authors approve `git show -m` of the merge commit

**P9 — Hardening**
- [ ] 36. Add hosted-bypass tests; prove them load-bearing (invert `isHostedProvider` → red), then green
- [ ] 37. Sweep for residual hardcoded recovery strings / duplicate implementations — zero
- [ ] 38. Call-graph verdict on `new-positions` (Serena `find_referencing_symbols`); execute disposition in its own commit
- [ ] 39. Doc-claims audit: every merged doc claim verified against shipped behavior

**P10 — Product gate**
- [ ] 40. Present hosted-vs-local case + blocker status to product owner; record the default-order decision with named approver
- [ ] 41. If flipped: one-line change + badge/attribution truth audit + docs; if not: opt-in documented
- [ ] 42. Final: full suite green; integration branch ready for fast-forward/PR; remove the merge worktree; archive P0 tags and the DB backup note

---

*Plan derived from MERGE_SUMMARY.md §12–14 (risks, conflict files, never-auto-merge), CHANGE_MANIFEST.md Part C (collision table), PROJECT_DIFF.md §4–6 (risk matrix, decision graph, phase logic), and the verified resolution record `6585052` with follow-ups `cac4ddb`/`1e1a34b`. No source code was modified in producing this plan.*
