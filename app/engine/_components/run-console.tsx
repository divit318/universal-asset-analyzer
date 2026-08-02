/**
 * Run console — universe selection, the two run modes, and the live log.
 *
 * The engine is the only module in UAA that *produces* data rather than reading
 * it, and a full pass takes minutes. So the console is built around never leaving
 * the user blocked: the run streams its log line by line, the engine writes a
 * partial snapshot at each stage, and the page polls that snapshot so the desk
 * above fills in progressively while the run continues. Nothing here waits for
 * the slowest stage.
 */

"use client";

import { useEffect, useRef } from "react";
import { LoadingMark } from "@/app/_components/loading-mark";
import { Button } from "@/app/_components/ui";

export interface EngineProgress {
  stage: "factors" | "factors+mc" | "complete" | string | null;
  updated_at: string | null;
  n_ready: number;
  n_total: number;
}

/** Each stage publishes a usable snapshot, so the label says what is *already
 *  readable* rather than only what is pending. */
const STAGE_LABEL: Record<string, string> = {
  factors: "Factor scores published — running Monte Carlo valuations",
  "factors+mc": "Monte Carlo published — running probabilistic forecasts",
  complete: "Run complete",
};

const UNIVERSE_GROUPS: [string, [string, string][]][] = [
  ["India", [
    ["nifty50", "Nifty 50"],
    ["india_largecap", "India Large-Cap (~100)"],
    ["india_midcap", "India Mid-Cap (~100)"],
    ["india_smallcap", "India Small-Cap (~100)"],
    ["full_india", "India Large + Mid (~200)"],
    ["india_best", "India Best Recommendations (~200)"],
  ]],
  ["US", [
    ["us_largecap", "US Large-Cap (~100)"],
    ["us_midcap", "US Mid-Cap (~100)"],
    ["us_smallcap", "US Small-Cap (~100)"],
    ["us_growth", "US Growth Tech (~80)"],
    ["full_us", "US Full (~250)"],
  ]],
  ["Funds", [
    ["etf", "ETFs (~50)"],
    ["mf", "Mutual Funds (~30)"],
  ]],
  ["Global", [["global", "Global US + India (~220)"]]],
];

export function RunConsole({
  universe,
  onUniverseChange,
  skipFetch,
  onSkipFetchChange,
  running,
  progress,
  log,
  onRun,
  onExport,
  canExport,
}: {
  universe: string;
  onUniverseChange: (u: string) => void;
  skipFetch: boolean;
  onSkipFetchChange: (v: boolean) => void;
  running: boolean;
  progress: EngineProgress | null;
  log: string | null;
  onRun: (opts: { noForecast: boolean }) => void;
  onExport: () => void;
  canExport: boolean;
}) {
  const logRef = useRef<HTMLDivElement>(null);

  // Follow the tail as lines stream in. In an effect, not a ref callback, so it
  // re-runs on every appended line rather than only on mount.
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [log]);

  const pct = progress?.n_total ? Math.round((progress.n_ready / progress.n_total) * 100) : 0;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={universe}
          onChange={(e) => onUniverseChange(e.target.value)}
          disabled={running}
          aria-label="Universe to score"
          className="rounded-control border border-border bg-surface-2 px-3 py-2 text-sm outline-none transition-[border-color,box-shadow] focus:border-brand focus:ring-2 focus:ring-brand/25 disabled:opacity-60"
        >
          {UNIVERSE_GROUPS.map(([group, options]) => (
            <optgroup key={group} label={group}>
              {options.map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </optgroup>
          ))}
        </select>

        <label
          className="flex cursor-pointer items-center gap-1.5 rounded-control border border-border px-3 py-2 text-xs text-muted transition-colors hover:border-border-strong"
          title="Reuse cached prices and fundamentals instead of re-downloading them. Safe for same-day reruns — the engine still tops up the last few days of prices."
        >
          <input
            type="checkbox"
            className="cursor-pointer accent-brand"
            checked={skipFetch}
            onChange={(e) => onSkipFetchChange(e.target.checked)}
            disabled={running}
          />
          Use cached data
        </label>

        <Button variant="secondary" onClick={() => onRun({ noForecast: true })} disabled={running}>
          {running ? "Running…" : "Fast run"}
        </Button>
        <Button variant="primary" onClick={() => onRun({ noForecast: false })} disabled={running}>
          {running ? "Running…" : "Full run + forecasts"}
        </Button>

        {canExport && (
          <Button variant="ghost" onClick={onExport} className="ml-auto">
            ↓ Export Excel
          </Button>
        )}
      </div>

      <p className="text-caption text-faint">
        Fast run scores the universe on factors, regime and Monte Carlo valuation (seconds once
        prices are current). The full run adds the quantile-forecast stage, which is the slow part
        (a few minutes). Either way the desk above updates as each stage publishes — you never have
        to wait for the end.
      </p>

      {(running || log) && (
        <div className="overflow-hidden rounded-card border border-border bg-surface">
          <div className="flex items-center gap-2.5 border-b border-border px-4 py-2.5">
            {running ? <LoadingMark size={16} /> : <LoadingMark size={16} state="done" />}
            <span className="text-sm font-medium">
              {running ? `Running ${universe}` : `Finished ${universe}`}
            </span>
            {log && (
              <span className="ml-auto font-mono text-label tabular-nums text-faint">
                {log.split("\n").filter(Boolean).length} steps
              </span>
            )}
          </div>

          {running && progress?.stage && (
            <div className="flex items-center gap-3 border-b border-border bg-brand/5 px-4 py-2">
              <div className="relative h-1 w-28 shrink-0 overflow-hidden rounded-full bg-surface-2">
                <div
                  className="absolute inset-y-0 left-0 rounded-full bg-brand transition-[width] duration-500"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <span className="text-xs text-muted">
                {STAGE_LABEL[progress.stage] ?? progress.stage} ·{" "}
                <span className="font-mono tabular-nums">
                  {progress.n_ready}/{progress.n_total}
                </span>{" "}
                names published
              </span>
            </div>
          )}

          {log && (
            <div ref={logRef} className="flex max-h-56 flex-col gap-0.5 overflow-y-auto p-3 text-xs">
              {log.split("\n").filter(Boolean).map((line, i) => {
                const isErr = /error|fail|exception/i.test(line);
                const isOk = /done|success|complete|saved|✓/i.test(line);
                const isWarn = /warn|skip|stale/i.test(line);
                return (
                  <div
                    key={i}
                    className={`flex gap-2 font-mono leading-5 ${
                      isErr ? "text-negative" : isOk ? "text-positive" : isWarn ? "text-warning" : "text-muted"
                    }`}
                  >
                    <span className="shrink-0 select-none">
                      {isErr ? "✗" : isOk ? "✓" : isWarn ? "⚠" : "·"}
                    </span>
                    <span className="break-all">{line}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
