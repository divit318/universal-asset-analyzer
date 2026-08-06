# Phase 4 addendum — Spike on THIS machine, v1 API, personal key

Date: 2026-08-02. Script: `scripts/devin-spike-v1compat.ts` (dual-API variant
of the spike; the merged `scripts/devin-spike.ts` is the v3-only movement
explainer whose results are in `04-spike-results.md`). Task: **NVDA investment
verdict** — live Yahoo quote dossier (607 chars, identical across runs),
`VerdictSchema` (Zod → Draft-7, 1,047 bytes), `max_acu_limit: 4→5`,
`devin_mode` not available on v1.

Context: this machine holds a personal `apk_user_…` key, so calls go through
the **legacy v1 API** — which lacks two things the v3 spike used:
`structured_output_required` and (initially) the playbook. That accident made
this an ablation study of what actually produces reliability.

## The ablation, 5 runs per condition, identical prompt

| Condition | Success | First-try schema-valid | Latency (ok runs) |
|---|---|---|---|
| v1, bare prompt, no playbook | 1/5 | 1/5 | 26.3s |
| v1 + `UAA Analyst` playbook | 3/5 | 3/5 | 23.1 / 25.7 / 29.0s |
| v1 + playbook + **harvest-before-blocked fix** | **5/5** | **5/5** | 24.2 / 27.2 / 33.0 / 33.1 / 41.8s — p50 33.0s |

### What the middle row's "failures" actually were

A spike bug, not a Devin failure: sessions **delivered valid structured output
and then asked "anything else?"** — v1 reports that as `blocked`
(waiting-for-user), and the spike checked `blocked` *before* checking for
harvested output, terminating sessions that had already succeeded. Ordering the
harvest check first took the same configuration from 3/5 to 5/5. Lesson pinned
for the provider (the merged `lib/ai/providers/devin/provider.ts` already
harvests on `structured_output != null`, i.e. does this correctly):
**harvest beats status** — a session's questions after delivery are noise.

The first row's failures were real, though: without the playbook the agent
asked clarifying questions BEFORE producing output in 4/5 runs. On v1 (no
`structured_output_required`), the playbook's "non-interactive, never ask, call
provide_structured_output" contract is the only thing standing between you and
a coin-flip. It is not optional decoration.

## Reuse probe (pattern 5, pseudo-chat)

Follow-up message to a completed session ("rerun assuming price −10%"):
**second Zod-valid `structured_output` in 30.2s** from message send, and the
field **does update** on follow-up turns. So multi-prompt session reuse works;
at ~30s/turn it is still not interactive-grade, confirming the architecture's
call: copilot stays on the CLI transport.

## Other observations

- Session create: 0.6s (first call of a process 1.2s). All latency is agent
  runtime, not API overhead.
- ACU: v1's GET has no `acus_consumed` field; web-app Session Insights shows
  the spend. The v3 run (04-spike-results.md) also logged 0.0 ACU same-day —
  consumption reporting appears to lag; recheck per the amendment-5 log.
- Verdict distribution across 9 ok runs: 8× HOLD (conf 38–58), 1× BUY (58) —
  NVDA at a stretched multiple reads as a coin-edge name; directionally stable,
  confidence honest. The playbook's "low-confidence honest answer is correct"
  rule is visibly obeyed.
- All spike sessions terminated after the runs (6× HTTP 200 on DELETE).

## Verdict for Phase 5 on this machine

- v1 + playbook + correct harvesting is **production-adequate for the
  background tier** (5/5, p50 33s, worst 41.8s — comfortably inside the 240s
  movement budget the provider sets).
- v3 remains preferred where available (`structured_output_required`, fast
  mode, `acus_consumed` in the response). To use it here, create a service
  user (`cog_…`) for this machine — also operationally cleaner than a personal
  key pasted in chat, which should be rotated regardless.
- `lib/ai/providers/devin/client.ts` should gain the same `apk_→v1` fallback
  the spike has, so either credential works on either machine.
