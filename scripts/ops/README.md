# `uaa` — development host toolkit

Keeps the **development host** healthy. Distinct from `scripts/README.md`, which
is about UAA's own portfolio alert monitor.

```
uaa start        preflight gate -> prereqs -> reap stale -> one dev server -> health
uaa stop         teardown in the order that cannot orphan anything, then verify
uaa status       RAM, swap, Metal, Ollama, Next, tsserver, MCP, pressure, warnings
uaa doctor       full diagnostic: every finding gets a why and a fix
uaa reap         reclaim leaked memory (dry-run unless --apply)
uaa guard        watchdog (launchd runs `--once --auto-reap` every 60s)
uaa preflight    the health gate; wired to `npm run dev` via the predev hook
uaa install      symlinks + launchd agent + shell env    uaa uninstall
uaa selftest     13 assertions over the toolkit's own logic
```

`uaa install` also exposes `uaa-start`, `uaa-stop`, `uaa-status`, `uaa-doctor`
(argv[0] dispatch), and `npm run host:status` / `host:doctor` / `host:stop` work
from inside the repo.

All bash 3.2 (macOS system bash), no Node dependency anywhere — deliberately,
because the conditions this diagnoses are exactly the conditions under which
starting a Node process takes 30 seconds.

---

## The failure this exists to prevent

On 2026-08-04 this 16 GB M4 Air was found with **11.5 GB of 16 GB wired**, 0.06 GB
free, **158 GB written to swap** since boot, and **790 jetsam kills in 24 h**
(138 in the final hour alone). Cause: **one** `llama-server` process — PPID 1,
alive 11 h 37 m at 0 % CPU, holding `qwen3:14b`, 9.49 GB — while `ollama ps`
reported `{"models":[]}` and the GPU sat at 14 % utilization.

Reaping that single process took wired from **11.50 GB → 1.83 GB** and free from
12 % → 77 %.

### Mechanism (established experimentally, not assumed)

`stress-orphan.sh` step 0 measures which signal to `ollama serve` orphans its
runner. The answer is the whole story:

| signal to `ollama serve` | runner outcome | wired |
|---|---|---|
| `SIGTERM` | exits with the daemon | 5.73 → **1.93 GB** |
| `SIGKILL` | **survives, PPID→1, immortal** | stays **5.57 GB** |

1. Ollama loads weights with `--no-mmap` into Metal buffers. Those pages are
   **wired** — unlike `mmap`'d file-backed pages they cannot be evicted, only
   displaced, which forces everything else into the compressor and then swap.
2. `keep_alive` expiry is enforced by the scheduler **inside `ollama serve`**.
3. **macOS jetsam kills with `SIGKILL`.** Under the very memory pressure a loaded
   model creates, the kernel SIGKILLs `ollama serve`. Its runner survives, is
   reparented to launchd, and loses its only expiry timer.
4. The runner is now **unreachable** (`ollama ps` can't see it, nothing can route
   to it) **and unexpirable**. It holds its GB until reboot.

That is a **positive feedback loop**: memory pressure creates the condition that
makes memory pressure permanent. It is why nothing but a reboot ever helped.

It also means the orphan **cannot be prevented by good habits alone** — you cannot
stop the kernel from SIGKILLing a process. Hence two independent defences:

- **Don't keep a large model resident.** `uaa start` leaves Ollama off; the router
  (`lib/ai/router.ts`) already tries hosted Devin CLI first anyway.
- **Reap orphans within 60 s.** The launchd guard, unattended.

### The diagnostic signature worth memorising

**An idle GPU pinning multiple GB.** Metal residency and GPU utilization are
independent measurements; a process can hold 10 GB while doing no GPU work. That
single comparison distinguishes *"my GPU is busy"* from *"my RAM is hostage"*, and
`uaa status` prints it on one line.

---

## Interpreting `uaa status`

| Row | Healthy | Unhealthy | Why |
|---|---|---|---|
| free | > 30 % | < 12 % | Below ~12 % the kernel jetsam-kills daemons. That *is* a beachball. |
| wired | < 35 % | > 55 % | The one page class the pager cannot reclaim. Decides whether the host survives. |
| apps (active+inactive) | high | low | Counter-intuitive: **low is bad.** 1.6 GB meant your work had been squeezed out. 11 GB means it is resident. |
| compressor | < 2 GB | > 4 GB | A large footprint means everything else was already crushed. |
| swap | < 40 % | > 75 % **and** free < 30 % | **Lagging indicator.** High swap with plenty free is drained residue, not a problem. |
| Metal in use | < 4 GB | > 7 GB | On unified memory this *is* RAM. |
| GPU utilization | tracks residency | < 20 % holding > 4 GB | Leaked runner, not GPU load. |
| GPU resets | 0 | > 0 | Real driver faults — a different bug entirely. |
| orphaned runners | 0 | ≥ 1 | Never legitimate. Pure loss. |
| ollama reports loaded | = runner count | 0 with a live runner | Confirms the leak. |
| dev servers | exactly 1 | > 1 | Next.js silently falls back to :3001 rather than refusing. |
| tsserver | ≤ 4 | > 8 | ~0.4–1.0 GB each warm, multiplied by agent sessions. |

A `tsserver` total that looks impossibly small (0.02 GB across 8) is itself a
finding: they have been swapped out entirely, which is *why* agent tooling feels
slow — every symbol lookup faults ~400 MB back from disk.

---

## Why the reaper only targets PPID=1 and duplicates

Deliberately conservative: it must never kill a process a live session owns.

One case is worth knowing, because the dry-run default caught it during
development. The `bash -c 'sleep 1; pkill -f next-server; npm run dev'` restart
shim has PPID 1, so it *looks* like debris — but it is usually still the ancestor
of the **live** dev server (`bash → npm → next dev → next-server`). Killing it
would orphan that tree, manufacturing the very leak the reaper exists to clean up.
It therefore skips any shim that still has children, and `uaa selftest` asserts
that guard is present.

Relatedly, `pgrep -f 'next-server'` is **wrong**: it also matches the shim's own
`pkill -f "next-server"` argument and the toolkit's own command line. Match
`next-server \(v` instead. Both patterns live in `lib/common.sh` as `P_*`
constants; `uaa selftest` asserts they exclude shims and self.

`uaa stop` kills the dev server by **process group**, because signalling one
member leaves the rest running and reparented — which is how duplicates
accumulate in the first place.

---

## Regression test

```bash
scripts/ops/stress-orphan.sh          # 12 assertions, ~3 min, uses qwen3.5:4b
```

Proves, in order: the signal matrix (step 0); that SIGKILL reproduces the outage;
that `uaa status` detects it; that the guard auto-recovers it unattended; and that
`uaa stop` never creates it. Uses the smallest installed model — the mechanism is
size-independent, so a 3.4 GB reproduction is as valid as a 9.3 GB one without
risking the host it is testing.

---

## What `uaa install` changes outside the repo

| Target | Change | Reverted by |
|---|---|---|
| `~/.local/bin/` | 5 symlinks to `scripts/ops/uaa` | `uaa uninstall` |
| `~/Library/LaunchAgents/com.uaa.guard.plist` | guard, 60 s, auto-reap, `Nice 5` + `LowPriorityIO` | `uaa uninstall` |
| `~/.zshrc` | one marked block: `OLLAMA_MAX_LOADED_MODELS=1`, `NUM_PARALLEL=1`, `KEEP_ALIVE=5m` | `uaa uninstall` |
| `data/ .next/ node_modules/ graphify-out/ bench-out/ .venv/` | `.metadata_never_index` + `tmutil addexclusion` | delete the marker files |

The Ollama caps matter because the **default** `OLLAMA_MAX_LOADED_MODELS` is
3×GPU-count — Ollama will hold three models at once given the chance.

Guard history accumulates in `data/host-guard.jsonl` (gitignored), one JSON
object per sample, enough to reconstruct a freeze after the fact.
