#!/bin/bash
# stress-orphan.sh -- reproducible regression test for the orphaned-runner
# failure mode that took this host down on 2026-08-04.
#
#   scripts/ops/stress-orphan.sh [--model qwen3.5:4b]
#
# WHAT IT PROVES, in order:
#
#   0. SIGNAL MATRIX which signal to `ollama serve` orphans its runner
#   1. BASELINE      the host is healthy before we start
#   2. REPRODUCE     SIGKILL the daemon while a model is loaded -> the runner
#                    survives, reparents to launchd (PPID 1), loses its
#                    keep_alive timer, and pins its weights as wired Metal
#                    memory the pager cannot evict. The original outage, exactly.
#   3. DETECT        `uaa status` classifies it; `ollama ps` cannot see it
#   4. AUTO-RECOVER  `uaa guard --once --auto-reap` reclaims it unattended
#   5. PREVENT       `uaa stop` drains runners BEFORE the daemon, and uses
#                    SIGTERM, so it leaves no orphan. That is the actual fix.
#
# THE SIGNAL DISTINCTION IS THE WHOLE POINT, and it was established empirically
# here rather than assumed:
#
#   SIGTERM to `ollama serve`  -> runner exits with it.        wired 5.73 -> 1.93 GB
#   SIGKILL to `ollama serve`  -> runner SURVIVES as PPID 1.   wired stays 5.57 GB
#
# macOS jetsam kills with SIGKILL. So the failure is a positive feedback loop:
# memory pressure makes the kernel SIGKILL `ollama serve`, that orphans a
# multi-GB runner whose memory can never be reclaimed, which makes the pressure
# permanent, which causes more jetsam kills. Nothing recovers it but a reboot --
# which is precisely the symptom that was reported.
#
# It also means the orphan cannot be prevented purely by good habits: you cannot
# stop the kernel from SIGKILLing a process. Hence two independent defences --
# don't keep a large model resident (uaa start's default), and reap orphans
# within 60s (uaa guard).
#
# Uses the smallest installed model by default: the mechanism is size-independent,
# so a 3.4 GB reproduction is as valid as a 9.3 GB one without risking the host
# it is testing.

set -uo pipefail
SELF_DIR=$(cd "$(dirname "$0")" && pwd -P)
REPO=$(cd "$SELF_DIR/../.." && pwd -P)
. "$SELF_DIR/lib/common.sh"
cd "$REPO" || exit 1

MODEL="qwen3.5:4b"
[ "${1:-}" = "--model" ] && MODEL="${2:?}"
UAA="$SELF_DIR/uaa"

snap() { # snap <label>
  metrics_collect; procs_collect
  printf '  %-22s free=%-4s%% wired=%-6sGB metal=%-6sGB swap=%-8sMB gpu=%-3s%% orphans=%-2s managed=%-2s\n' \
    "$1" "$M_FREE_PCT" "$M_WIRED_GB" "$M_METAL_GB" "$M_SWAP_USED" "$M_GPU_UTIL" "$P_ORPHAN_N" "$P_MANAGED_N"
}
step() { printf '\n%s%s%s\n' "$C_B" "$1" "$C_N"; }
ok()   { printf '  %sPASS%s %s\n' "$C_G" "$C_N" "$1"; PASS=$((PASS+1)); }
bad()  { printf '  %sFAIL%s %s\n' "$C_R" "$C_N" "$1"; FAILED=$((FAILED+1)); }
PASS=0; FAILED=0

command -v ollama >/dev/null 2>&1 || { echo "ollama not installed; nothing to test."; exit 0; }

printf '\n%s=== orphaned-runner stress test ===%s %smodel: %s%s\n' "$C_B" "$C_N" "$C_D" "$MODEL" "$C_N"

load_model() {
  pgrep -fx "$P_SERVE" >/dev/null 2>&1 || { nohup ollama serve >/tmp/uaa-stress-ollama.log 2>&1 & sleep 3; }
  curl -s --max-time 180 http://127.0.0.1:11434/api/chat -d "{
    \"model\":\"$MODEL\",\"stream\":false,\"keep_alive\":\"30m\",
    \"messages\":[{\"role\":\"user\",\"content\":\"reply with the single word: ok\"}]}" \
    >/tmp/uaa-stress-chat.json 2>&1
}

# --------------------------------------------------------- 0. signal matrix --
# Establish the mechanism rather than assuming it. This is the step that
# corrected the original diagnosis: a graceful daemon exit is NOT what orphans
# the runner.
step "0. SIGNAL MATRIX -- which signal orphans the runner?"
"$UAA" reap --apply >/dev/null 2>&1
for SIG in TERM KILL; do
  load_model
  _r=$(pgrep -f "$P_LLAMA" | head -1); _s=$(pgrep -fx "$P_SERVE" | head -1)
  metrics_collect; _w0=$M_WIRED_GB
  [ -z "$_r" ] || [ -z "$_s" ] && { bad "could not stage SIG$SIG case"; continue; }
  kill "-$SIG" "$_s" 2>/dev/null; sleep 5
  metrics_collect
  if alive "$_r"; then
    _pp=$(ppid_of "$_r")
    printf '  SIG%-5s daemon dies -> runner %s SURVIVES (ppid=%s) wired %s -> %s GB\n' \
      "$SIG" "$_r" "$_pp" "$_w0" "$M_WIRED_GB"
    [ "$SIG" = "KILL" ] && [ "$_pp" = "1" ] && ok "SIGKILL orphans the runner (the failure mode)" \
      || bad "unexpected: SIG$SIG left a surviving runner with ppid=$_pp"
    "$UAA" reap --apply >/dev/null 2>&1; sleep 2
  else
    printf '  SIG%-5s daemon dies -> runner %s exits with it,  wired %s -> %s GB\n' \
      "$SIG" "$_r" "$_w0" "$M_WIRED_GB"
    [ "$SIG" = "TERM" ] && ok "SIGTERM tears down cleanly (what 'uaa stop' uses)" \
      || bad "unexpected: SIGKILL cleaned up"
  fi
done

# ---------------------------------------------------------------- 1. baseline
step "1. BASELINE"
"$UAA" reap --apply >/dev/null 2>&1
snap "before"
metrics_collect; procs_collect
_base_wired=$M_WIRED_GB; _base_metal=$M_METAL_GB
[ "$P_ORPHAN_N" = "0" ] && ok "no pre-existing orphans" || bad "host already has $P_ORPHAN_N orphan(s)"

# --------------------------------------------------------------- 2. reproduce
step "2. REPRODUCE the failure -- SIGKILL the daemon, as jetsam does"
printf '  loading %s (keep_alive 30m, as lib/ai/router.ts sets for interactive tasks)\n' "$MODEL"
load_model
_reply=$(python3 -c "
import json
try: print(json.load(open('/tmp/uaa-stress-chat.json'))['message']['content'][:40].strip())
except Exception: print('(no reply)')" 2>/dev/null)
printf '  model replied: %s\n' "$_reply"
snap "model loaded"
metrics_collect; procs_collect
_loaded_wired=$M_WIRED_GB
printf '  wired grew %s GB -> %s GB (Metal %s -> %s GB)\n' "$_base_wired" "$_loaded_wired" "$_base_metal" "$M_METAL_GB"
[ "$P_MANAGED_N" -ge 1 ] && ok "runner is MANAGED (parent = ollama serve, has keep_alive timer)" \
  || bad "expected a managed runner, found none"

# SIGKILL, not SIGTERM. macOS memorystatus/jetsam kills are SIGKILL, so this is
# what the kernel actually does to `ollama serve` under the very memory pressure
# that a loaded model creates. SIGTERM here would tear down cleanly and prove
# nothing -- step 0 demonstrates exactly that.
_serve_pids=$(pgrep -fx "$P_SERVE" 2>/dev/null)
printf '  %sSIGKILL ollama serve%s (pids: %s) -- simulating a jetsam kill\n' \
  "$C_Y" "$C_N" "$(echo "$_serve_pids" | tr '\n' ' ')"
for p in $_serve_pids; do kill -KILL "$p" 2>/dev/null; done
sleep 4
snap "daemon SIGKILLed"

# --------------------------------------------------------------- 3. detection
step "3. DETECT"
procs_collect
[ "$P_ORPHAN_N" -ge 1 ] && ok "orphan created and detected: $P_ORPHAN_N runner(s), ${P_ORPHAN_GB} GB, pids:${ORPHAN_LLAMA}" \
  || bad "no orphan was created -- the reproduction did not take"
for p in $ORPHAN_LLAMA; do
  [ "$(ppid_of "$p")" = "1" ] && ok "pid $p reparented to launchd (PPID=1) => keep_alive timer lost" \
    || bad "pid $p is not PPID=1"
done
_ps=$(curl -s --max-time 3 http://127.0.0.1:11434/api/ps 2>/dev/null || echo 'unreachable')
printf '  ollama /api/ps says: %s\n' "$_ps"
case "$_ps" in
  *'"models":[]'*|unreachable)
    ok "runner is invisible to Ollama => unreachable AND unexpirable" ;;
  *) bad "expected an empty model list, got: $_ps" ;;
esac
printf '\n  what a human would see:\n'
"$UAA" status 2>/dev/null | sed -n '/WARNINGS/,/^$/p' | sed 's/^/    /'

# ----------------------------------------------------------- 4. auto-recovery
step "4. AUTO-RECOVER via the watchdog (unattended)"
printf '  running one guard cycle, exactly as launchd does every 60s:\n'
"$UAA" guard --once --auto-reap 2>&1 | sed 's/^/    /'
sleep 3
snap "after guard"
procs_collect
[ "$P_ORPHAN_N" = "0" ] && ok "guard reclaimed the orphan unattended" || bad "$P_ORPHAN_N orphan(s) survived the guard"
metrics_collect
printf '  wired %s GB -> %s GB (baseline was %s GB)\n' "$_loaded_wired" "$M_WIRED_GB" "$_base_wired"

# --------------------------------------------------------------- 5. prevention
step "5. PREVENT -- the same scenario, torn down via 'uaa stop'"
printf '  starting ollama serve and re-loading %s\n' "$MODEL"
load_model
snap "model loaded"
procs_collect
[ "$(pcount "$P_LLAMA")" -ge 1 ] && ok "runner resident again ($(rss_sum "$P_LLAMA") GB)" || bad "model did not load"

printf '  %suaa stop --keep-dev%s (drains runners BEFORE the daemon):\n' "$C_C" "$C_N"
"$UAA" stop --keep-dev 2>&1 | sed -n '/ollama/,/^$/p;/verification/,/^$/p' | sed 's/^/    /'
sleep 2
procs_collect
[ "$(pcount "$P_LLAMA")" = "0" ] && ok "zero llama-server processes remain" || bad "$(pcount "$P_LLAMA") runner(s) survived uaa stop"
[ "$P_ORPHAN_N" = "0" ] && ok "zero orphans created by the correct teardown order" || bad "uaa stop orphaned $P_ORPHAN_N runner(s)"
[ "$(pgrep -fx "$P_SERVE" | wc -l | tr -d ' ')" = "0" ] && ok "daemon stopped too" || bad "ollama serve still running"

# ------------------------------------------------------------------- verdict
step "RESULT"
snap "final"
metrics_collect
printf '  wired returned to %s GB (baseline %s GB) | Metal %s GB (baseline %s GB)\n' \
  "$M_WIRED_GB" "$_base_wired" "$M_METAL_GB" "$_base_metal"
printf '\n  %s%s passed, %s failed%s\n\n' "$C_B" "$PASS" "$FAILED" "$C_N"
[ "$FAILED" = "0" ] || exit 1
exit 0
