# MERGE_POLICY.md — Autonomous Integration Policy for UAA

**Audience: the AI agent performing an integration.** When a developer says
"use the merge policy and integrate everything" (or anything similar), this
file IS the task specification. Follow it without asking for restatement.

**Authority / precedence** (highest wins):

1. ADRs in `docs/decisions/` — settled architecture decisions
2. AGENTS.md / CLAUDE.md / ARCHITECTURE.md — project rules and invariants
3. **This file** — how integrations are performed
4. The developer's prompt for this specific integration
5. Generic Git defaults

If this file ever contradicts an ADR or AGENTS.md, the ADR/AGENTS.md wins —
and fix the contradiction here as part of the task.

---

## 1. The branch model

```
                    ┌── prisha-work   (Prisha)
main ───────────────┤
                    └── f22/day-change (Divit; historical: divit-local)

           ↓ frequent integration back into ↓

                    main  = the latest integrated, validated state
```

- **Canonical integration branch: `main`** on `origin`
  (github.com/divit318/universal-asset-analyzer).
- **Prisha's branch: `prisha-work`.** This machine (`/Users/prishaagarwal`)
  is Prisha's; unattributed uncommitted work here is presumed hers.
- **Divit's branch: `f22/day-change`** (older `divit-local` is fully merged
  into `main` and is historical).
- `redesign-terminal-archive` is an archive — never merge it, never delete it.
- `decision/ai-architecture` carries ADRs; merge it into `main` when asked.

Developers do NOT routinely merge each other's long-lived branches directly.
Integration flows through `main`: feature branch ← `main` (update), then
`main` ← feature branch (integrate), then optionally the *other* developer's
branch ← `main` (sync).

If reality has drifted from this model (it has before), do not force it back
with history rewrites. Integrate along the shortest safe path toward "main is
the superset", and say what you did.

## 2. The standard integration procedure

When told to integrate, do all of this autonomously:

1. **Survey.** Run `npm run integrate` (read-only: fetches, prints working
   tree state, branch ahead/behind table, and a conflict preview). Read its
   output instead of reconstructing the picture with a dozen git commands.
2. **Protect uncommitted work** (see §3). Never proceed onto a dirty tree
   with merge/checkout operations until the work is committed or deliberately
   set aside.
3. **Identify source and target.** Default interpretation of "integrate my
   work": current developer's branch → `main`, after first updating the
   developer's branch from `origin/main`. "Integrate everything" also means:
   fold in the other developer's pushed branch if it has commits `main`
   lacks.
4. **Update the feature branch from `main` first**: `git merge origin/main`
   *on the feature branch*. Resolve conflicts per §4–§6. This keeps conflict
   resolution off `main`.
5. **Validate** per §7 on the feature branch.
6. **Integrate into `main`**: merge the feature branch into `main` (a normal
   merge commit; fast-forward is fine when true). The merge should now be
   clean because conflicts were resolved in step 4.
7. **Re-validate on `main`** (quick gate at minimum; full gate if step 6 was
   not a fast-forward).
8. **Commit and push `origin/main`.** Then, if asked or clearly intended,
   update the other developer's branch from `main` *only if it merges
   cleanly*; if it conflicts, leave it and note it — its owner integrates on
   their own machine.
9. **Report**: one short summary — what was merged, conflicts and how each
   was resolved, validation results, what was pushed.

Merge-commit message format:

```
Merge <source> into <target>: <one-line what this brings in>

Conflicts: <files, or "none">
Resolution notes: <one line per meaningful decision>
```

## 3. Uncommitted work — the prime safety rule

This repo has a history of huge dirty working trees. Rules:

- **Never** run `git reset --hard`, `git clean -fd`, `git checkout -- <path>`
  over files you did not create this session, or any equivalent, to make an
  integration easier. No exceptions without explicit per-command user
  approval.
- Before any merge/branch operation, read `git status`. If the tree is dirty:
  - If the changes form coherent work (they usually do — check diffs against
    recent commit themes), **commit them first** on the owning developer's
    branch, in one or a few coherent commits with honest messages. WIP is
    acceptable: `wip: <area> — <state>` is better than risking the work.
  - If you genuinely cannot tell what the changes are or whether they are
    wanted (e.g. they look like another agent's half-finished session),
    **stop and ask** — this is one of the few legitimate stops.
- Prefer committing over stashing. Stashes get lost; commits on the owner's
  branch don't.
- Never force-push, never rewrite published history, never delete branches,
  never amend other people's commits.

## 4. What a merge is

> A merge is not "pick ours or theirs." A merge is: understand what each
> side was trying to accomplish, preserve the strongest parts of each, and
> produce the best combined implementation that stays architecturally
> coherent and functional.

Three kinds of conflict, three levels of effort:

- **Type 1 — trivial textual.** Adjacent-line edits, import lists, doc
  wording. Resolve mechanically, don't overthink, don't spend reasoning.
- **Type 2 — overlapping implementations.** Both changed the same
  function/component with different goals. Read both sides' diffs *and their
  commit messages* (intent is usually stated), then compose: one side's data
  handling with the other's error handling, one's UI states with the other's
  abstraction. You are allowed — encouraged — to make small compatibility
  refactors so both improvements coexist cleanly. The goal is preserving the
  best functionality and design decisions from both sides, not every line.
- **Type 3 — genuine architectural conflict.** Both sides redesigned the
  same subsystem around incompatible shapes. Check ADRs, AGENTS.md,
  ARCHITECTURE.md, callers, and tests for evidence of which shape the
  project has committed to. If evidence decides it, choose that shape and
  port the other side's compatible functionality onto it. Only if there is
  no objectively defensible choice, stop per §9.

For any Type 2/3 conflict, weigh: **intent** (what was each side trying to
do), **functionality** (what does each add), **architecture** (which fits
UAA's established patterns), **correctness** (which behavior is right —
AGENTS.md's "Correctness Rules" section is the canon), **compatibility**
(callers, API contracts, DB schema, providers, UI behavior),
**performance** (no redundant AI calls or per-row fetches), and
**maintainability**. Never resolve by "newest wins", "biggest wins",
"`main` wins", "ours/theirs wins", or "one developer is authoritative".

## 5. Repo-specific merge rules (learned from real incidents)

| Area | Rule |
|---|---|
| `lib/ai/router.ts`, `lib/ai/task-registry.ts`, `lib/ai/config.ts` | **Never trust a clean auto-merge here.** In the 2026-08 merge, git auto-merged `routeStream` *cleanly and wrongly* (applied a local-generation gate to hosted providers; compiled, tests green, behavior wrong). After any merge touching `lib/ai/`, read the merged routing logic end-to-end and run `npx vitest run tests/ai-*`. |
| `lib/db.ts` schema | **Union, never choose.** Both sides' tables and columns coexist (this is the established pattern: A's 6 tables + B's snapshot columns both kept). Migrations are additive. Also: no backticks inside SQL comments in `db.exec(...)` template literals — it's a build-breaking syntax error that reads as prose. |
| `app/globals.css` | Theme tokens resolve by source order under `:root, [data-theme="dark"]` / `[data-theme="light"]`. Never accept a merged result that appends an unconditional `:root {}` or `.dark {}` token block (the shadcn incident). |
| `package.json` | Union dependencies/scripts. Then **regenerate `package-lock.json` with `npm install`** — never hand-merge the lockfile. |
| `AGENTS.md`, `CLAUDE.md`, ARCHITECTURE docs | Learnings are append-heavy: prefer keeping **both** sides' sections. Reconcile only true contradictions (then the newer *dated* rule usually reflects the later product decision — verify against the code). |
| `MERGE_SUMMARY.md`, `MERGE_COMPLETION_REPORT.md`, `CHANGE_MANIFEST.md`, `PLAN-*.md`, `HANDOFF-*.md`, `docs/audits/` | Historical records. On conflict keep both sides' text (union); never "fix" history to match the merge you are doing now. |
| `data/`, `*.tsbuildinfo`, `dev.log`, `test-results/`, `bench-out/`, `.next/`, `graphify-out/` | Generated/ignored. Never merge by hand; if one shows up in a conflict something is wrong — check `.gitignore`. |
| `.env*` | Never commit (only `.env.example` is tracked). Never print contents. |
| Terminal redesign | The 2026-08 "terminal" redesign is ABANDONED (owner decision). If a merge would reintroduce `.tm-*` styling, The Desk, or command-line chrome, that side loses by default. |
| Scoring / recommendation | One implementation per concern: bands in `lib/recommendation.ts`, batch scoring in `lib/composite.ts`, single-name in `lib/scoring.ts`, total return in `lib/portfolio-performance.ts`. A merge must not resurrect a second copy of any of these. Run `tests/scoring-consistency.test.ts` after touching them. |
| AI calls | Everything goes through `runPrompt(taskType, …)` / the Router. A merge must not reintroduce direct provider calls or model names in feature code. |

## 6. Semantic regression sweep (after resolving, before committing)

Compilation is necessary, not sufficient. A merge can compile and be wrong.
After resolving significant conflicts:

1. `git grep -n '<<<<<<<\|>>>>>>>'` — zero conflict markers.
2. **Modify/delete audit**: for every file deleted on one side and modified
   on the other, decide from commit messages whether the deletion was an
   intentional replacement (find the successor) or an accident (restore).
3. **Disappearance check**: skim `git diff --stat` of the merge against
   *each parent*. A feature, route, UI state, data field, provider, or
   validation that existed on one parent and is absent from the result must
   be either intentionally superseded (name the successor) or restored.
4. **Caller check**: for every exported symbol whose signature/behavior
   changed in resolution, `git grep` its callers and confirm they still make
   sense.
5. Run the targeted tests for the touched areas (`npx vitest run
   tests/<area>*`), then the full gate per §7.

Fix straightforward fallout (imports, types, renamed fields, simple test
updates) yourself; that is part of the job, not a reason to stop.

## 7. Validation gate

`npm run integrate:check` runs the quick gate; `npm run integrate:check --
--full` adds the production build.

| Check | Command | When |
|---|---|---|
| Typecheck | `npx tsc --noEmit` (must be silent) | Always |
| Unit tests | `npx vitest run` | Always |
| Lint | `npx eslint app lib` (baseline is clean; any error is a regression) | Always |
| Build | `npm run build` | Any non-trivial integration into `main`. **Never while `next dev` is running** (they race for `.next/`) — run `scripts/ops/uaa stop` first or check `pgrep -f "next dev"`. |
| Targeted tests | `npx vitest run tests/<area>*` | After each significant conflict resolution, before the full gate |
| Live AI evals | `npx tsx scripts/ai-eval.ts`, `LIVE_AI=1 npx vitest run tests/ai-platform-live.test.ts` | Only for AI-layer routing/prompt/provider changes, **only with the user's OK** (spends real money) |

Small doc-only or trivial merges: quick gate is enough. Push to `main` only
with the gate green (CI runs tsc + vitest + build on `main` — don't hand it
a red commit).

## 8. Speed discipline

Merge frequency should make merges cheaper, not turn each one into a
research project.

- Let git do everything mechanical; spend reasoning only on real conflicts.
- Read the conflicting *hunks* and their `git log -p` context, not entire
  modules. Use targeted searches for callers.
- Use targeted tests first; full gate once at the end.
- Don't re-read the whole repo or rebuild the architecture picture — this
  file plus AGENTS.md already contain it.

## 9. When to stop and ask a human

Stop **only** for: (a) a Type 3 conflict with no evidence-based winner,
(b) uncommitted work you cannot attribute or safely preserve, (c) anything
requiring a destructive/history-rewriting operation, (d) credentials/auth
failures. Everything else — ordinary conflicts, combinable overlaps, small
refactors to fit both sides together, import/type/API fixups, test fallout,
commits, pushes to the branches named in §1 — you handle yourself.

When stopping, use exactly this shape (concise — no essays):

```
ARCHITECTURAL DECISION REQUIRED

Prisha's implementation: <one line>
Divit's implementation: <one line>

Why they cannot coexist: <one line>

What I recommend: <one line + why>

I stopped before committing because this requires a human decision.
```

Everything mergeable around the stopped area should already be merged,
validated, and committed; isolate the undecided question, don't hold the
whole integration hostage to it.

## 10. Coordination convention (for the humans)

Overlap is normal and the merge system handles it. But before starting a
*multi-day architectural rebuild* of a subsystem (provider routing, portfolio
engines, screener pipeline, …), send the other developer one message:
"I'm taking <subsystem> this week." That's the whole process. It exists only
to prevent two simultaneous three-day rebuilds of the same subsystem — the
one case §4 cannot fix cheaply.
