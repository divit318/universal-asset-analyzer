# Tranche 4 — Portfolio Thesis + Home Brief

Date: 2026-08-05. Verified: tsc silent, **2,697 tests pass**, eslint clean,
`next build` green, both surfaces exercised live through the running app under
`AI_PROVIDER=devin`.

## What migrated

**Portfolio Thesis** (`lib/portfolio/thesis.ts`) — `runAnalysis` with
`PortfolioThesisWireSchema` (v1). The wire schema deliberately permits an
EMPTY `bearCase`: the prompt instructs "return an empty string rather than
manufacturing one", and a min-length constraint would have converted honesty
into fabrication at the platform-validation layer. All coercion/defaulting
stays in thesis.ts (cleanList/cleanString, per-field fallbacks,
`resolveSectionConflicts`) — the parse view is the new shared
`LooseObjectSchema` (`lib/ai/schemas/loose.ts`), following the verdict
precedent. Outer content-hash cache in `scanner_cache` unchanged; no
`maxAgeMs` on the seam so the two cache layers cannot fight.

**Home Brief** (`lib/home/brief.ts`) — `runAnalysis` with
`HomeBriefWireSchema` (v1; `note` nullable on the wire — "no long-form note
today" is a legal answer, not a validation failure). This call site had a
quirk: it historically ran the local model WITHOUT `format:"json"` and mopped
up with extractJson. That quirk is now explicit seam surface —
`AnalysisRequest.ollamaJsonMode?: boolean` — rather than silently "fixed",
because byte-identical-under-Ollama is the discipline every migration has
shipped under. Grounding gate (throw away a brief whose headline invents
facts) unchanged and provider-agnostic.

Task registry: `devinTimeoutMs: 240_000` declared for `portfolio-intelligence`
and `daily-briefing`. Both are `latency: "standard"` so they migrate under the
global flag (no pins needed).

`tests/portfolio-thesis.test.ts` reseated from the runPrompt mock to a
runAnalysis mock that records the same (taskType, prompt) tuple — all 20
assertions pass unchanged, including the garbage-response → useful-fallback
path (unparseable output now throws inside the seam instead of returning
defaults; both roads end at the same deterministic fallback).

## Parity gates (records in bench-out/parity/)

| Task | Subject | Devin (sessions API) | Token stack | Flags |
|---|---|---|---|---|
| thesis | live portfolio (7 holdings, health 49, 5.5KB dossier) | ok 53.7s — identity 5, strengths 3, risks 3, bear case present | ok 22.8s — identity 4, strengths 2, risks 3, bear case present | 0 wire-incomplete, 0 ungrounded numbers |
| brief | live home (regime + portfolio) | ok 34.8s | ok 11.9s | 0 / 0 |
| brief | DEGENERATE: no portfolio | ok 35.0s — narrated market only, invented no holdings | ok 4.4s — same | 0 / 0 |

Same caveat as tranche 3: the "token stack" column resolves to the Devin CLI
transport on this machine; pre-hosted Ollama behavior is pinned by the
untouched unit tests.

## Live under the flag

- `/api/home/brief`: streamed headline in 28s, grounded (regime %, health
  grade, inflation sensitivity all traceable to the dossier).
- `/api/portfolio/thesis`: the design goal made visible — the model combined
  QQQM 54% + MSFT/TSM/MU/META + beta 1.89 + factor loading +1.37 into "a
  single high-beta bet on US large-cap technology; the 'diversified' labels
  describe fund structure, not exposure". That is the hidden-risk synthesis
  the deterministic engines cannot produce and the reason this feature exists.

## Next in the agreed order

compare → simulator → scanner (fan-out ≤40 validated; **still gated on the
Settings > Plans reading**) → IC report → thematic → streaming redesigns.
