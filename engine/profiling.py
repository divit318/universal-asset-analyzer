"""
Stage timing for engine runs.

The engine's log has always been a narrative ("Computing features…"), which tells
you what it is doing but never what it *cost*. Every performance claim about the
engine before this module was a guess. `StageTimer` accumulates wall-clock per
named stage and prints a sorted breakdown at the end of a run, so a regression
shows up in the same log the operator is already watching.

Nesting is deliberately not supported: overlapping timers make a breakdown that
does not sum to the total, which is the one property that makes it useful.
"""

from __future__ import annotations

import os
import time
from contextlib import contextmanager


class StageTimer:
    def __init__(self, enabled: bool = True):
        self.enabled = enabled
        self.totals: dict[str, float] = {}
        self.counts: dict[str, int] = {}
        self._t0 = time.perf_counter()

    @contextmanager
    def stage(self, name: str):
        t = time.perf_counter()
        try:
            yield
        finally:
            self.add(name, time.perf_counter() - t)

    def add(self, name: str, seconds: float) -> None:
        self.totals[name] = self.totals.get(name, 0.0) + seconds
        self.counts[name] = self.counts.get(name, 0) + 1

    @property
    def elapsed(self) -> float:
        return time.perf_counter() - self._t0

    def report(self) -> list[str]:
        total = self.elapsed
        accounted = sum(self.totals.values())
        lines = [f"--- Stage timing (total {total:.1f}s) ---"]
        for name, secs in sorted(self.totals.items(), key=lambda kv: -kv[1]):
            pct = 100.0 * secs / total if total > 0 else 0.0
            n = self.counts[name]
            suffix = f" ({n} calls)" if n > 1 else ""
            lines.append(f"  {secs:8.2f}s  {pct:5.1f}%  {name}{suffix}")
        lines.append(f"  {total - accounted:8.2f}s  {100.0 * (total - accounted) / total if total else 0:5.1f}%  (unattributed)")
        return lines


def timer_enabled() -> bool:
    """Timing is cheap; it is on unless explicitly silenced."""
    return os.environ.get("UAA_ENGINE_TIMING", "1") not in ("0", "false", "no")


def raise_fd_limit(target: int = 4096) -> tuple[int, int]:
    """
    Raise this process's soft open-file limit toward `target`.

    macOS ships a soft RLIMIT_NOFILE of 256. The engine holds a DuckDB handle,
    a large price map, and up to 16 concurrent yfinance HTTP sessions at once,
    and it crossed 256 routinely — producing failures that never looked like
    resource exhaustion: "unable to open database file", a polars
    PanicException mid-scan, and `ModuleNotFoundError`-shaped import errors from
    lazily imported modules. Raising the soft limit (never above the hard limit,
    which needs no privileges) removes a whole class of spurious failure.

    Returns the (before, after) soft limits.
    """
    try:
        import resource
    except ImportError:                      # non-POSIX
        return (0, 0)

    soft, hard = resource.getrlimit(resource.RLIMIT_NOFILE)
    if soft >= target:
        return (soft, soft)
    new_soft = min(target, hard) if hard != resource.RLIM_INFINITY else target
    try:
        resource.setrlimit(resource.RLIMIT_NOFILE, (new_soft, hard))
        return (soft, new_soft)
    except (ValueError, OSError):
        return (soft, soft)
