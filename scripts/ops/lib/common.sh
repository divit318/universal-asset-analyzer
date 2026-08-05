# shellcheck shell=bash
# Shared primitives for the `uaa` host toolkit. Sourced, never executed.
#
# bash 3.2 (macOS system bash) throughout: no mapfile, no associative arrays,
# no negative array indices. And no Node dependency anywhere in this toolkit --
# deliberately, because the conditions it diagnoses are exactly the conditions
# under which starting a Node process takes 30 seconds.

# ---------------------------------------------------------------------------
# process patterns
#
# `next-server \(v` and not `next-server`: the bare string also matches the
# dev-server restart shim's own `pkill -f "next-server"` argument, and any
# shell whose command line mentions it -- including this toolkit's. That false
# positive previously caused a reaper to target the live dev server's own
# ancestor. Keep these patterns precise.
# ---------------------------------------------------------------------------
P_NEXT='next-server \(v'
P_LLAMA='llama-server'
P_SERVE='ollama serve'
P_TSSERVER='tsserver\.js'
P_TSLS='typescript-language-server'
P_SERENA='serena start-mcp-server'
P_PWMCP='playwright-mcp'
P_MCP_ALL='tsserver\.js|typescript-language-server|typingsInstaller|playwright-mcp|serena start-mcp-server'

# ------------------------------------------------------------------ colours --
if [ -t 1 ] && [ "${NO_COLOR:-}" = "" ]; then
  C_B=$'\033[1m'; C_R=$'\033[31m'; C_Y=$'\033[33m'; C_G=$'\033[32m'
  C_C=$'\033[36m'; C_D=$'\033[2m'; C_N=$'\033[0m'
else
  C_B=''; C_R=''; C_Y=''; C_G=''; C_C=''; C_D=''; C_N=''
fi

# ------------------------------------------------------------------ helpers --
pcount()   { pgrep -f "$1" 2>/dev/null | wc -l | tr -d ' '; }
ppid_of()  { ps -o ppid= -p "$1" 2>/dev/null | tr -d ' '; }
pgid_of()  { ps -o pgid= -p "$1" 2>/dev/null | tr -d ' '; }
rss_of()   { ps -o rss=  -p "$1" 2>/dev/null | tr -d ' '; }
cmd_of()   { ps -o command= -p "$1" 2>/dev/null; }
is_orphan(){ [ "$(ppid_of "$1")" = "1" ]; }
alive()    { kill -0 "$1" 2>/dev/null; }
rss_sum()  { # rss_sum <pattern> -> GB
  for p in $(pgrep -f "$1" 2>/dev/null); do rss_of "$p"; done \
    | awk '{s+=$1} END {printf "%.2f", s/1048576}'
}

# ---------------------------------------------------------------------------
# metrics_collect -- populate M_* globals. One vm_stat and one ioreg call, so
# it is cheap enough for a 60s watchdog loop (measured ~0.3s total).
# ---------------------------------------------------------------------------
metrics_collect() {
  M_TOTAL_GB=$(sysctl -n hw.memsize | awk '{printf "%.1f",$1/1073741824}')
  _vms=$(vm_stat)
  _page=$(printf '%s' "$_vms" | awk '/page size of/{print $8; exit}'); _page=${_page:-16384}
  _vmp() { printf '%s' "$_vms" | awk -F: -v k="$1" 'index($1,k)==1 {gsub(/[^0-9]/,"",$2); print $2+0; exit}'; }
  _gb()  { echo "${1:-0}" | awk -v p="$_page" '{printf "%.2f",$1*p/1073741824}'; }

  M_WIRED_GB=$(_gb "$(_vmp 'Pages wired down')")
  M_FREE_GB=$(_gb "$(_vmp 'Pages free')")
  M_ACTIVE_GB=$(_gb "$(_vmp 'Pages active')")
  M_INACTIVE_GB=$(_gb "$(_vmp 'Pages inactive')")
  M_COMP_GB=$(_gb "$(_vmp 'Pages occupied by compressor')")
  M_COMPHOLD_GB=$(_gb "$(_vmp 'Pages stored in compressor')")
  M_SWAPOUT_GB=$(_gb "$(_vmp 'Swapouts')")
  M_SWAPIN_GB=$(_gb "$(_vmp 'Swapins')")
  M_APPS_GB=$(echo "$M_ACTIVE_GB $M_INACTIVE_GB" | awk '{printf "%.2f",$1+$2}')
  M_WIRED_PCT=$(echo "$M_WIRED_GB $M_TOTAL_GB" | awk '{printf "%.0f",$1/$2*100}')

  M_SWAP_TOTAL=$(sysctl -n vm.swapusage | awk '{gsub(/M/,"",$3); print $3+0}')
  M_SWAP_USED=$(sysctl -n vm.swapusage  | awk '{gsub(/M/,"",$6); print $6+0}')
  M_SWAP_PCT=$(echo "$M_SWAP_USED $M_SWAP_TOTAL" | awk '{if($2>0)printf "%.0f",$1/$2*100; else print 0}')
  M_FREE_PCT=$(memory_pressure 2>/dev/null | awk -F': ' '/free percentage/{gsub(/%/,"",$2); print $2+0; exit}')
  M_FREE_PCT=${M_FREE_PCT:-0}

  # Apple Silicon has no discrete VRAM. "In use system memory" is the slice of
  # unified memory held by Metal allocations: model weights, KV cache,
  # WindowServer surfaces, browser compositing layers. Those pages are WIRED --
  # the pager cannot evict them, so they displace everything else into the
  # compressor and then into swap.
  #
  # Residency and utilization are INDEPENDENT measurements. An idle GPU can be
  # pinning 10 GB. That combination is the signature of a leaked model runner,
  # and distinguishing it from genuine GPU load is the single most useful thing
  # this toolkit measures.
  _gpu=$(ioreg -r -d 1 -c IOAccelerator 2>/dev/null | tr ',' '\n')
  _gpun() { printf '%s' "$_gpu" | awk -F= -v k="$1" 'index($0,k){gsub(/[^0-9]/,"",$2); print $2+0; exit}'; }
  M_METAL_GB=$(_gpun '"In use system memory"=' | awk '{printf "%.2f",$1/1073741824}')
  M_METAL_ALLOC_GB=$(_gpun '"Alloc system memory"=' | awk '{printf "%.2f",$1/1073741824}')
  M_GPU_UTIL=$(_gpun '"Device Utilization %"='); M_GPU_UTIL=${M_GPU_UTIL:-0}
  M_GPU_RESET=$(_gpun '"recoveryCount"='); M_GPU_RESET=${M_GPU_RESET:-0}

  M_DISK_GB=$(df -g / | awk 'NR==2{print $4+0}')
  M_THERMAL_OK=$(pmset -g therm 2>/dev/null | grep -c 'No thermal warning')
}

# ---------------------------------------------------------------------------
# procs_collect -- populate P_* counts and the orphan inventory.
#
# The orphan test is PPID==1. A managed llama-server's parent is `ollama serve`;
# an orphan's parent is launchd, because its daemon exited and the kernel
# reparented it. keep_alive expiry is enforced by the scheduler INSIDE that
# daemon, so an orphan has no expiry timer at all: `ollama ps` cannot see it,
# nothing can route a request to it, and nothing will ever evict it. It holds
# its wired Metal buffers until the host reboots.
# ---------------------------------------------------------------------------
procs_collect() {
  ORPHAN_LLAMA=""; MANAGED_LLAMA=""
  for p in $(pgrep -f "$P_LLAMA" 2>/dev/null); do
    if is_orphan "$p"; then ORPHAN_LLAMA="$ORPHAN_LLAMA $p"
    else MANAGED_LLAMA="$MANAGED_LLAMA $p"; fi
  done
  _n() { echo $#; }
  P_ORPHAN_N=$(_n $ORPHAN_LLAMA)
  P_MANAGED_N=$(_n $MANAGED_LLAMA)
  P_ORPHAN_GB=$(for p in $ORPHAN_LLAMA; do rss_of "$p"; done | awk '{s+=$1} END {printf "%.2f",s/1048576}')
  P_LLAMA_GB=$(rss_sum "$P_LLAMA")

  P_SERVE_N=$(pgrep -fx "$P_SERVE" 2>/dev/null | wc -l | tr -d ' ')
  P_OLLAMA_LOADED=$(curl -s --max-time 3 http://127.0.0.1:11434/api/ps 2>/dev/null | grep -c '"model"')

  P_NEXT_N=$(pcount "$P_NEXT")
  P_NEXT_GB=$(rss_sum "$P_NEXT")
  P_TS_N=$(pcount "$P_TSSERVER")
  P_TS_GB=$(rss_sum "$P_TSSERVER")
  P_SERENA_N=$(pcount "$P_SERENA")
  P_PWMCP_N=$(pcount "$P_PWMCP")
  P_MCP_GB=$(rss_sum "$P_MCP_ALL")
  P_VITEST_N=$(pcount 'vitest')
  P_AGENT_N=$(pgrep -x devin 2>/dev/null | wc -l | tr -d ' ')
  P_CHROME_N=$(pcount 'Chrome Helper \(Renderer\)')
  P_CHROME_GB=$(ps -Ao rss=,comm= | grep -i 'Google Chrome' | awk '{s+=$1} END {printf "%.2f",s/1048576}')

  ORPHAN_MCP=""
  for p in $(pgrep -f "$P_MCP_ALL" 2>/dev/null); do
    is_orphan "$p" && ORPHAN_MCP="$ORPHAN_MCP $p"
  done
  P_ORPHAN_MCP_N=$(_n $ORPHAN_MCP)
}

# ---------------------------------------------------------------------------
# reaping
# ---------------------------------------------------------------------------
REAPED_KB=0; REAPED_N=0

# term_wait_kill <pid> [grace_seconds]
# SIGTERM first so llama.cpp can release its Metal buffers cleanly; a runner
# wedged in a free path gets the grace window, then SIGKILL.
term_wait_kill() {
  _p=$1; _grace=${2:-5}
  alive "$_p" || return 0
  kill -TERM "$_p" 2>/dev/null
  _i=0
  while [ "$_i" -lt "$_grace" ]; do
    alive "$_p" || return 0
    sleep 1; _i=$((_i + 1))
  done
  kill -KILL "$_p" 2>/dev/null
  sleep 1
  return 0
}

# reap_pid <pid> <reason> ; honours $DRY (1 = report only)
reap_pid() {
  _p=$1; _reason=$2
  _rss=$(rss_of "$_p"); [ -z "$_rss" ] && return 0
  if [ "${DRY:-0}" = "1" ]; then
    printf '  %swould reap%s pid=%-7s %8s  %s\n' "$C_Y" "$C_N" "$_p" \
      "$(echo "$_rss" | awk '{printf "%.2f GB",$1/1048576}')" "$_reason"
  else
    printf '  %sreaped%s     pid=%-7s %8s  %s\n' "$C_G" "$C_N" "$_p" \
      "$(echo "$_rss" | awk '{printf "%.2f GB",$1/1048576}')" "$_reason"
  fi
  [ "${VERBOSE:-0}" = "1" ] && printf '      %s%s%s\n' "$C_D" "$(cmd_of "$_p" | cut -c1-100)" "$C_N"
  REAPED_KB=$((REAPED_KB + _rss)); REAPED_N=$((REAPED_N + 1))
  [ "${DRY:-0}" = "1" ] || term_wait_kill "$_p" 5
  return 0
}

reaped_gb() { echo "$REAPED_KB" | awk '{printf "%.2f",$1/1048576}'; }

# ---------------------------------------------------------------------------
# ollama_stop_all -- guarantee no runner survives.
#
# ORDER IS LOAD-BEARING. Killing `ollama serve` first reparents its runners to
# launchd, which is precisely how an immortal orphan is created: the runner
# loses the only timer that could ever evict it. Always drain the runners, then
# the daemon, then re-scan -- because the daemon can spawn a replacement runner
# in the window between the two.
# ---------------------------------------------------------------------------
ollama_stop_all() {
  _round=0
  while [ "$_round" -lt 3 ]; do
    _found=0
    for p in $(pgrep -f "$P_LLAMA" 2>/dev/null); do
      _found=1; reap_pid "$p" "ollama model runner"
    done
    for p in $(pgrep -fx "$P_SERVE" 2>/dev/null); do
      _found=1; reap_pid "$p" "ollama serve daemon"
    done
    [ "$_found" = "0" ] && break
    [ "${DRY:-0}" = "1" ] && break
    _round=$((_round + 1))
    sleep 1
  done
  # Verify, and say so unambiguously: "no orphaned Ollama processes remain" is a
  # guarantee this toolkit makes, so it has to be checked rather than assumed.
  if [ "${DRY:-0}" != "1" ]; then
    _left=$(pcount "$P_LLAMA")
    if [ "$_left" != "0" ]; then
      for p in $(pgrep -f "$P_LLAMA" 2>/dev/null); do kill -9 "$p" 2>/dev/null; done
      sleep 1
      _left=$(pcount "$P_LLAMA")
    fi
    OLLAMA_RESIDUE=$_left
  else
    OLLAMA_RESIDUE=0
  fi
}

# ---------------------------------------------------------------------------
# dev_stop -- stop the Next.js dev server by PROCESS GROUP.
#
# The tree is `bash(shim) -> npm -> next dev -> next-server`, all sharing one
# PGID. Killing any single member leaves the rest running and reparented, which
# is how duplicate/orphaned dev servers accumulate. Signalling the group kills
# it whole. Falls back to per-pid if the group cannot be determined.
# ---------------------------------------------------------------------------
dev_stop() {
  _pids=$(pgrep -f "$P_NEXT" 2>/dev/null)
  [ -z "$_pids" ] && return 0
  _groups=""
  for p in $_pids; do
    _g=$(pgid_of "$p")
    case " $_groups " in *" $_g "*) ;; *) _groups="$_groups $_g";; esac
  done
  for g in $_groups; do
    [ -z "$g" ] && continue
    _gb=$(for p in $(pgrep -g "$g" 2>/dev/null); do rss_of "$p"; done | awk '{s+=$1} END {printf "%.2f",s/1048576}')
    _nmem=$(pgrep -g "$g" 2>/dev/null | wc -l | tr -d ' ')
    if [ "${DRY:-0}" = "1" ]; then
      printf '  %swould reap%s pgid=%-6s %8s  dev-server process group (%s procs)\n' \
        "$C_Y" "$C_N" "$g" "${_gb} GB" "$_nmem"
      continue
    fi
    kill -TERM "-$g" 2>/dev/null
    _i=0
    while [ "$_i" -lt 8 ]; do
      [ -z "$(pgrep -f "$P_NEXT" 2>/dev/null)" ] && break
      sleep 1; _i=$((_i + 1))
    done
    [ -n "$(pgrep -g "$g" 2>/dev/null)" ] && kill -KILL "-$g" 2>/dev/null
    printf '  %sreaped%s     pgid=%-6s %8s  dev-server process group (%s procs)\n' \
      "$C_G" "$C_N" "$g" "${_gb} GB" "$_nmem"
  done
  # A shim can survive its group if it was started detached; sweep childless ones.
  for p in $(pgrep -f 'pkill -f .next-server' 2>/dev/null); do
    is_orphan "$p" || continue
    [ -n "$(pgrep -P "$p" 2>/dev/null)" ] && continue
    reap_pid "$p" "childless dev-server restart shim"
  done
  return 0
}

# ---------------------------------------------------------------------------
# grading + output
# ---------------------------------------------------------------------------
# grade <value> <warn_at> <fail_at>  (higher is worse)
grade() { awk -v v="$1" -v w="$2" -v f="$3" 'BEGIN{print (v+0>=f)?"FAIL":(v+0>=w)?"WARN":"OK"}'; }

FAIL_N=0; WARN_N=0
row() { # row <label> <value> <verdict> [note]
  _c=$C_G
  case "$3" in
    FAIL) _c=$C_R; FAIL_N=$((FAIL_N + 1)) ;;
    WARN) _c=$C_Y; WARN_N=$((WARN_N + 1)) ;;
  esac
  printf "  %-24s %-22s ${_c}%-4s${C_N} ${C_D}%s${C_N}\n" "$1" "$2" "$3" "${4:-}"
}
hdr()  { printf '\n%s%s%s %s%s%s\n' "$C_B" "$1" "$C_N" "$C_D" "${2:-}" "$C_N"; }
note() { printf '  %s%s%s\n' "$C_D" "$1" "$C_N"; }
