# PLAN-ai-json-hardening: Schema-safe LLM JSON at every `extractJson` call site

**Rank: #1 of 5 — do this first.**

## Goal

Eliminate the "trust-the-cast" crash class across the entire AI surface. Today, 30 call
sites parse local-LLM output with `extractJson<T>(raw)` and cast the result to a
TypeScript type with **no runtime validation**. Small local models (llama3.2, Mistral 7B)
routinely omit fields, return objects where arrays are expected, or return strings where
numbers are expected. One such omission already crashed production UI
(`/portfolio` Brief tab: missing `actionItems` → `Cannot read properties of undefined
(reading 'length')` — fixed in isolation on 2026-07-06). `DESIGN_PROGRESS.md`
("Remaining opportunities" item 2) explicitly names this pass as the top outstanding debt.

The schema-safe helper already exists and is tested: `extractJsonObject<T>(raw, defaults)`
in `lib/json-extract.ts` (see its doc comment). Two reference adopters exist:
`lib/ai-watchlist.ts` and `app/api/ai/verdict/route.ts`. This plan finishes the rollout.

## Non-goals

- Do NOT rewrite any prompt text. Prompts are hand-tuned; changing wording is out of scope.
- Do NOT change what any function returns on total parse failure if it already has a
  try/catch fallback — preserve existing fallback/logging semantics exactly.
- Do NOT touch `app/api/screener/nl/route.ts:99`. Its target type
  (`FundamentalScreenerCriteria`) is all-optional, so a partial parse is already valid.
  This was verified previously (`DESIGN_PROGRESS.md`, M7). Leave a one-line comment at
  that call site saying why it is exempt: `// all-optional schema — partial parse is valid; no defaults needed`.

## Files to touch

New helper + tests:
- `lib/json-extract.ts` — add `extractJsonArray` (spec below)
- `tests/json-extract.test.ts` — tests for the new helper

Call sites (file:line as of branch `integration/best-of-both`, working tree clean):

| File | Lines | Parsed shape |
|---|---|---|
| `lib/ai-research.ts` | 220, 368 | object of sections (nested arrays) |
| `lib/ai-compare.ts` | 268 | flat object |
| `lib/thematic-engine.ts` | 350, 413, 451, 478, 511, 541, 586 | objects |
| `lib/thematic-engine.ts` | 382 | **array** (`DependencyNode[]`) |
| `lib/event-screener.ts` | 92 | object with arrays |
| `lib/ic-valuation.ts` | 479 | object |
| `lib/ic-agents.ts` | 261 | object |
| `lib/ic-thesis.ts` | 72 | object |
| `lib/timeline.ts` | 589, 681 | objects |
| `lib/movement-explainer.ts` | 198 | object |
| `lib/knowledge-graph/traverse.ts` | 124 | object |
| `lib/scanner/company-impact.ts` | 153 | object |
| `lib/scanner/sector-impact.ts` | 118 | object |
| `lib/scanner/causal-engine.ts` | 89 | object |
| `lib/scanner/thesis-builder.ts` | 121 | object |
| `lib/scanner/classifier.ts` | 98 | object |
| `lib/scanner/dedup.ts` | 105 | object |
| `lib/scanner/index.ts` | 113, 166 | objects wrapping arrays |
| `app/api/ai/portfolio-brief/route.ts` | 111 | object (already field-defaulted manually — migrate to helper) |
| `app/api/portfolio/new-positions/route.ts` | 140 | **array** of partial objects |

(Line numbers will drift as you edit — re-locate each with
`grep -n "extractJson<" <file>` before editing. Do not skip a site because the line moved.)

Tests to extend (existing files): `tests/thematic-engine.test.ts`, `tests/timeline.test.ts`,
`tests/movement-explainer.test.ts`, `tests/scanner-*.test.ts`, `tests/ic-agents.test.ts`,
`tests/ai-compare.test.ts`. Where a module has no test file for its parse path, add cases
to the closest existing file rather than creating new files, matching repo convention.

## Step-by-step implementation order

### Step 1 — Add `extractJsonArray` to `lib/json-extract.ts`

Several sites parse top-level arrays, which `extractJsonObject` explicitly rejects
(it returns defaults for non-object results). Add:

```ts
/**
 * Like extractJsonObject but for TOP-LEVEL ARRAYS. Never throws.
 * - parse failure or non-array result → []
 * - if `sanitizeItem` is given, it maps each raw element to a valid item or null;
 *   nulls are dropped. Use it to guarantee per-item field presence.
 */
export function extractJsonArray<T>(
  raw: string,
  sanitizeItem?: (item: unknown) => T | null,
): T[] {
  let parsed: unknown;
  try {
    parsed = extractJson<unknown>(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  if (!sanitizeItem) return parsed as T[];
  const out: T[] = [];
  for (const item of parsed) {
    const v = sanitizeItem(item);
    if (v !== null) out.push(v);
  }
  return out;
}
```

Write tests FIRST in `tests/json-extract.test.ts`: parse failure → `[]`; object result →
`[]`; fenced array parses; sanitizeItem drops invalid rows; no-sanitizer passthrough.
Run `npx vitest run tests/json-extract.test.ts` and confirm green before continuing.

### Step 2 — Migrate call sites, one FILE at a time, committing per file

For **each** call site, follow this decision procedure (do not blanket-replace):

1. Read the ~30 lines after the call. List every field the code (or the UI that consumes
   the returned value) later dereferences: `.map(`, `.length`, `.filter(`, property
   access, arithmetic, string methods.
2. Build a `defaults` object containing **every** such field with a conservative default:
   `[]` for anything iterated, `""` for strings that get `.slice()`/rendered, `null` ONLY
   for fields the downstream code already null-checks, `0` for numbers used in arithmetic
   that a `0` won't corrupt (if `0` would corrupt logic, use `null` and add a null check).
3. Replace `extractJson<T>(raw)` with `extractJsonObject<T-compatible>(raw, defaults)`
   (or `extractJsonArray` for the two array sites), keeping the surrounding try/catch
   **if it also guards other throwing work** (e.g. the `runPrompt` call itself). If the
   try/catch existed ONLY to guard JSON parsing and its catch returns a fallback, keep it
   anyway — `extractJsonObject` returning defaults is not a behavior change, but the catch
   also protects against future edits. Never delete logging in catch blocks.
4. For nested arrays-of-objects the UI maps over (e.g. `sections[].bullets[]`,
   `catalysts[]` with `{title, detail}`), sanitize per-item: after extraction, map the
   array and drop/patch items missing required keys. `extractJsonObject` does NOT recurse
   — this is the edge a naive pass will miss.
5. For string-union fields (e.g. `severity: "high" | "medium" | "low"`, verdict enums,
   `trend: "up" | "down"`), validate against an allowlist and fall back to the safest
   value; the model WILL invent variants ("Medium", "HIGH", "moderate"). Normalize case
   before comparing.
6. For numeric fields used in comparisons/sorts: models sometimes return `"85"` (string).
   Where downstream sorts or compares, coerce with
   `typeof v === "number" ? v : Number(v)` and fall back to the default if `NaN`.

Recommended file order (simplest → hardest, so patterns are established early):
1. `lib/ic-thesis.ts`, `lib/ic-valuation.ts`, `lib/ai-compare.ts` (single flat objects)
2. `lib/movement-explainer.ts`, `lib/knowledge-graph/traverse.ts`, `lib/timeline.ts`
3. All six `lib/scanner/*` sites + `lib/scanner/index.ts` (objects wrapping arrays —
   default the wrapper `{ themes: [] }` / `{ alerts: [] }` and sanitize items)
4. `lib/event-screener.ts`, `lib/ic-agents.ts`
5. `lib/thematic-engine.ts` (7 sites; note line 382 is the ARRAY site → `extractJsonArray`
   with a sanitizer, and keep the existing `.slice(0, 6)`)
6. `lib/ai-research.ts` (nested sections — needs per-item sanitation)
7. `app/api/portfolio/new-positions/route.ts` (array of partials → `extractJsonArray`
   with sanitizer; preserve the existing `fromWatchlist`/`autoQualified` handling)
8. `app/api/ai/portfolio-brief/route.ts` (replace the manual per-field defaulting added
   2026-07-06 with one `extractJsonObject` call — behavior must stay identical)

### Step 3 — Add regression tests per migrated module

For each module, add 2–3 cases to its existing test file exercising the module's parse
path with: (a) valid-but-incomplete JSON (missing one iterated field), (b) a field with
the wrong kind (object where array expected), (c) total garbage (no JSON at all). Assert
no throw and that the guaranteed fields exist. Most modules expose the parse indirectly —
if the parse is buried in a private function that requires a live model call, export a
small pure `parseX(raw: string)` helper from the module and test that (this refactor is
in-bounds; keep the exported name prefixed `parse`).

### Step 4 — Final gate

Run, in order, and fix anything that breaks:
```
npx tsc --noEmit
npx eslint .
npm run test
```
Then run `graphify update .` (repo convention after code changes; AST-only, free).

## Edge cases a weaker model will miss

- **`extractJsonObject` silently swallows total parse failure.** At sites where the
  current behavior on garbage is "throw → caller catches → caller returns null/fallback
  and LOGS", returning silent defaults changes observable behavior (an empty-but-valid
  object may render as a blank card instead of the fallback message). Where the catch
  branch sets an error state or returns `null` that the UI distinguishes from "empty",
  detect the garbage case explicitly: call `extractJson` inside the existing try/catch
  and apply field defaults AFTER a successful parse instead of switching to
  `extractJsonObject`. Decide per site; when in doubt, preserve the throw-on-garbage path.
- **Top-level arrays**: `extractJsonObject` returns `{...defaults}` for arrays — using it
  on the two array sites would silently discard valid model output. Must use
  `extractJsonArray`.
- **`Partial<...>` target types** (portfolio-brief, new-positions): the cast being
  `Partial` does not make downstream safe — the route then fills fields and the CLIENT
  maps them. Defaults must reflect what the client component iterates
  (`ai-portfolio-brief.tsx`, `new-positions-panel.tsx` — read them).
- **Don't "fix" `Omit<>` types by adding the omitted field to defaults** — e.g.
  `thematic-engine.ts:451` parses `Omit<SupplyDemandScore, "commodityProxies">`; the
  omitted field is attached later by code. Defaults must match the Omit shape.
- **Preserve `.slice()` caps** (e.g. thematic dependencies `.slice(0, 6)`) — they defend
  against models returning 50 items; keep them after migration.
- **Do not add a new validation library** (zod etc.). Repo policy is zero new deps
  without cause; the two existing helpers are the pattern.
- **Streaming call sites are out of scope**: `app/api/research/chat/route.ts` and
  `app/api/portfolio/audit/route.ts` use `streamChat` free-text (no JSON parse) — leave
  them alone.

## Acceptance criteria (verify each)

1. `grep -rn "extractJson<" lib app --include='*.ts' --include='*.tsx' | grep -v extractJsonObject | grep -v extractJsonArray | grep -v json-extract.ts`
   returns **only** the exempt `app/api/screener/nl/route.ts` site (with its exemption comment).
2. `npx tsc --noEmit` clean; `npx eslint .` 0 errors 0 warnings.
3. `npm run test` passes and total test count is **strictly greater** than before you
   started (record the before number in your first commit message).
4. New `tests/json-extract.test.ts` covers `extractJsonArray` (≥5 cases).
5. Manual spot check: with the dev server and Ollama running, load `/research?symbol=AAPL`
   and `/portfolio` (Brief tab) — no console errors, AI cards render or show their
   existing fallback states.
6. Behavior preservation: for `app/api/ai/portfolio-brief/route.ts`, the response shape
   with a complete model reply is byte-identical to before (same fields, same fallbacks).
