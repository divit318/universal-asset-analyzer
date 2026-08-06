# ADR-001 — AI Provider Architecture: Pluggable Multi-Provider

**Date:** 2026-08-06
**Status:** ACCEPTED (decision by Prisha, resolving the stop condition in `origin/f22/day-change`'s MERGE_UPDATE_REPORT §6/§8)
**Deciders:** Prisha Agarwal (recorded here); Divit Chauhan to co-sign on next session.

## Context

Between 2026-08-02 (`6585052`) and 2026-08-06, the two development lines made opposite architectural decisions from the same base:

- **`origin/main` (Prisha's line, 16 commits):** Devin sessions API as the *primary* analysis transport — Tranches 3–9 migrated verdict, thesis, home brief, compare (equity + class), simulator, the 9-agent IC pipeline, thematic, scanner, and the report stream onto the analysis seam; dual-generation Devin client (`cog_`/`apk_`); verdict cache warmer; `AI_PROVIDER=devin` flipped on this machine.
- **`origin/f22/day-change` (Divit's line, 42 commits):** Anthropic-only backend — provider core + key store, one backend with three effort tiers, prompt caching (`cache_control`), native structured outputs, telemetry ledger + `/dev/ai`, eval framework — with the Devin CLI, Devin sessions client, and Ollama tiers **deleted** (`0ce3c0c`), and product claims rewritten accordingly (`33c8e08`).

A trial merge (`git merge-tree`) confirms 18 conflicts, six of which are modify/delete collisions on the provider layer itself. Divit's MERGE_UPDATE_REPORT correctly halted the merge on this as a product decision that must not ride silently through a merge (precedent: `1e1a34b`). Additionally, an in-flight session on Divit's machine was observed building `gemini-provider.ts`, `openai-compatible-provider.ts`, `keys.ts`, and a settings API for provider keys — i.e., a multi-provider reconciliation is already in motion.

## Decision

**The AI layer is a pluggable multi-provider platform.** One analysis seam (`runAnalysis` / `runTask`), N provider adapters behind it:

1. **Anthropic** (Divit's provider core) — a first-class hosted backend, carrying his effort tiers, prompt caching, native structured outputs, and telemetry ledger.
2. **Devin sessions + Devin CLI** (main's Tranches 3–9) — retained as first-class hosted backends; the dual-generation client and warmer stay.
3. **Ollama** — retained as the local/offline fallback (the product's founding "works offline" promise stands).
4. **Gemini / OpenAI-compatible** — welcome as additional adapters (the in-flight work), same seam, no special casing.

Corollaries:

- **No feature code names a provider.** Tasks route via the registry/chain exactly as today; `AI_PROVIDER` / `AI_PROVIDER_ORDER` / per-task pins select transports per machine and per task.
- **Nothing is deleted for being unused on one machine.** f22's deletions of the Devin/Ollama providers are reverted by the merge (main's versions win the modify/delete conflicts); f22's Anthropic core is added alongside, not instead.
- **Cross-cutting capabilities generalize where cheap, stay provider-scoped where not:** the telemetry ledger and eval framework must observe *all* providers (they sit at the seam); prompt caching and constrained decoding are provider capabilities declared in the model/provider registry (Anthropic-only today — that is fine).
- **User-facing claims** (pricing/landing/FAQ) must describe the pluggable reality: bring-your-own-key hosted providers, local fallback. f22's truthfulness arc is preserved; only its "one backend" phrasing needs the widened wording.
- **Wire schemas converge on one story:** the seam's per-call-site wire/parse schema pairs (main's convention, which f22's native structured outputs also adopted) — the merge keeps one `schemas/` module set serving both transports.

## Consequences

- The blocked merge unblocks with a known playbook (MERGE_UPDATE_REPORT §6, EXECUTION_PLAN): mechanical phase for the ~52 non-AI files (F-22 series, auth/login, brand, fund honesty, materiality lens merge nearly clean), then the AI seam resolved *to this ADR* rather than to either branch.
- The in-flight multi-provider session gains an explicit mandate; it should land on `f22/day-change` (or a child branch) before the seam merge, per the one-writer rule.
- Both machines keep working AI regardless of which keys they hold — an env-degraded provider is skipped by the chain, never a crash (`AI_RECOVERY_HINT` behavior unchanged).
- Duplicate audit documents from the two lines are kept side-by-side, per the established `*.prisha.md` pattern.

## Rejected alternatives

- **Anthropic-only:** destroys nine tranches of shipped, validated Devin-sessions work and the offline promise; the env's Anthropic key is currently invalid, which would leave zero working hosted paths on this machine today.
- **Devin-primary with Anthropic dropped:** discards a production-grade provider core plus telemetry/caching/eval infrastructure that the platform needs regardless of transport.
- **Decide-in-merge:** explicitly forbidden by both lines' process documents; this ADR exists so the merge resolves *to a decision*, not to whichever side wins a hunk.
