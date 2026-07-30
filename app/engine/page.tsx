/**
 * The Quant Engine — UAA's systematic investing desk.
 *
 * The question this page answers is deliberately different from every other
 * module's. Research Hub answers "what do we think about this company"; Compare
 * answers "which of these is better"; Screener answers "which names pass my
 * filters". The desk answers "what opportunities is the market creating today, and
 * why" — one market state, one set of adaptive factor weights, one ranked book,
 * and an honest account of whether the model is currently working.
 *
 * ── Layout is ordered by cost, not by importance ──
 *
 * Every section fetches independently and renders the instant its own data lands,
 * so the page is readable long before the expensive parts finish:
 *
 *   1. Regime + breadth + movers + conviction + factor lab — all from ONE
 *      precomputed file (`data/engine_dashboard.json`, written by the engine at
 *      each run stage). Single request, no DuckDB, no Python: first paint.
 *   2. Model health — a small CSV parse.
 *   3. Full scorecard — the heaviest render on the page (a row per name with
 *      bars), so it is code-split and only mounts once its data arrives.
 *   4. Model validation — never runs on load. Explicitly user-triggered, because
 *      it fetches price history for every logged signal.
 *
 * Nothing awaits anything else, and every fetch is bounded server-side, so a slow
 * or missing input degrades one section instead of hanging the page.
 */

"use client";

import dynamicImport from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useBootReady } from "@/app/_components/boot-context";
import { LoadingMark } from "@/app/_components/loading-mark";
import { Reveal } from "@/app/_components/reveal";
import { Badge, Button, PageShell, SectionHeader, Skeleton } from "@/app/_components/ui";
import { downloadBlob } from "@/lib/download";
import { isDashboardEmpty, type DashboardResponse, type ScorecardRow } from "@/lib/engine-desk";
import { useDataset } from "@/lib/platform/client/use-dataset";
import { BreadthMap } from "./_components/breadth-map";
import { ChangedToday } from "./_components/changed-today";
import { ConvictionBook } from "./_components/conviction-book";
import { DeskRail, type RailSection, type RailState } from "./_components/desk-rail";
import { FactorLab } from "./_components/factor-lab";
import { ModelHealth, type OosMetrics } from "./_components/model-health";
import { ModelValidation } from "./_components/model-validation";
import { RegimeHero } from "./_components/regime-hero";
import { RunConsole, type EngineProgress } from "./_components/run-console";

/** Code-split: the widest, heaviest DOM on the page, and nothing above it needs
 *  the module to be in the initial bundle. */
const ScorecardTable = dynamicImport(
  () => import("./_components/scorecard-table").then((m) => m.ScorecardTable),
  { ssr: false, loading: () => <TableSkeleton /> },
);

/** `brief` gates whether a section is rendered at all — see the rail note below. */
const SECTION_META: { id: string; label: string; needsBrief: boolean }[] = [
  { id: "desk-regime", label: "Regime", needsBrief: false },
  { id: "desk-changed", label: "Changed", needsBrief: true },
  { id: "desk-book", label: "Book", needsBrief: true },
  { id: "desk-factors", label: "Factors", needsBrief: true },
  { id: "desk-breadth", label: "Breadth", needsBrief: true },
  { id: "desk-scorecard", label: "Scorecard", needsBrief: false },
  { id: "desk-health", label: "Health", needsBrief: false },
  { id: "desk-validation", label: "Validation", needsBrief: false },
];

export default function EnginePage() {
  const [universe, setUniverse] = useState("nifty50");
  const [skipFetch, setSkipFetch] = useState(false);
  const [signalFilter, setSignalFilter] = useState("ALL");
  const [expanded, setExpanded] = useState<string | null>(null);

  const [running, setRunning] = useState(false);
  const [runLog, setRunLog] = useState<string | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [progress, setProgress] = useState<EngineProgress | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  useEffect(() => {
    document.title = "Quant Engine · UAA";
    return () => { document.title = "Universal Asset Analyzer"; };
  }, []);

  /* ---------------------------------------------------------------------- */
  /* Data — three independent datasets, each rendering the moment it lands   */
  /* ---------------------------------------------------------------------- */

  const dashboardFetcher = useCallback(async (signal: AbortSignal) => {
    const res = await fetch("/api/engine/dashboard", { signal });
    if (!res.ok) throw new Error("Could not load the market brief");
    return (await res.json()) as DashboardResponse;
  }, []);

  const scorecardFetcher = useCallback(async (signal: AbortSignal) => {
    const res = await fetch("/api/engine", { signal });
    const json = (await res.json()) as { scorecard?: ScorecardRow[]; error?: string };
    // A missing snapshot is an empty desk, not a failure — the route returns 200
    // with an explanation so the empty state can be specific.
    if (!res.ok) throw new Error(json.error ?? "Could not load the scorecard");
    return json.scorecard ?? [];
  }, []);

  const healthFetcher = useCallback(async (signal: AbortSignal) => {
    const res = await fetch("/api/engine/oos-metrics", { signal });
    if (!res.ok) throw new Error("Could not load model health");
    return (await res.json()) as OosMetrics;
  }, []);

  const dashboard = useDataset<DashboardResponse>("engineDashboard", null, dashboardFetcher);
  const scorecard = useDataset<ScorecardRow[]>("engineScorecard", null, scorecardFetcher);
  const health = useDataset<OosMetrics>("engineHealth", null, healthFetcher);

  // Dismiss the boot splash as soon as the *brief* lands — not the scorecard, not
  // model health. The brief is what the first screen renders, so waiting on
  // anything slower would hold a full-screen splash over a desk that is already
  // readable. (The old page never reported at all, which is why it sat behind the
  // splash until it timed out.)
  useBootReady(!dashboard.isInitialLoading, "engine");

  const brief = dashboard.data && !isDashboardEmpty(dashboard.data) ? dashboard.data : null;
  const briefEmpty = dashboard.data && isDashboardEmpty(dashboard.data) ? dashboard.data : null;
  // Memoised so the identity is stable across renders — `rows` is a dependency of
  // the Excel export callback and a prop to the (heavy) scorecard table, and a
  // fresh `[]` each render would churn both.
  const rows = useMemo(() => scorecard.data ?? [], [scorecard.data]);

  /* ---------------------------------------------------------------------- */
  /* Running the engine                                                     */
  /* ---------------------------------------------------------------------- */

  // Held in a ref so the mid-run poll never closes over a stale refresh fn, and
  // so `runEngine` doesn't need the three refreshers as dependencies (which would
  // recreate it — and with it the button handlers — on every store update).
  // Synced in an effect, not during render: mutating a ref mid-render is unsafe
  // once React can discard a render pass.
  const refreshRef = useRef({ dashboard: dashboard.refresh, scorecard: scorecard.refresh, health: health.refresh });
  useEffect(() => {
    refreshRef.current = { dashboard: dashboard.refresh, scorecard: scorecard.refresh, health: health.refresh };
  }, [dashboard.refresh, scorecard.refresh, health.refresh]);

  const runEngine = useCallback(async ({ noForecast }: { noForecast: boolean }) => {
    setRunning(true);
    setRunLog("");
    setRunError(null);
    setProgress(null);

    // The engine republishes its snapshots at every stage, so polling them mid-run
    // fills the desk in progressively instead of making the user wait for the end.
    const poll = setInterval(() => {
      void fetch("/api/engine/progress")
        .then((r) => (r.ok ? r.json() : null))
        .then((p) => { if (p) setProgress(p as EngineProgress); })
        .catch(() => { /* next tick retries */ });
      refreshRef.current.dashboard();
      refreshRef.current.scorecard();
    }, 4000);

    try {
      const res = await fetch("/api/engine", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ universe, noFetch: skipFetch, noForecast }),
      });
      if (!res.ok || !res.body) {
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(json.error ?? "Engine failed to start");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let done = false;
      let failed = false;
      while (!done) {
        const { value, done: streamDone } = await reader.read();
        done = streamDone;
        if (!value) continue;
        for (const line of decoder.decode(value).split("\n").filter(Boolean)) {
          if (line.startsWith("ERROR:")) {
            failed = true;
            setRunError(line.replace("ERROR: ", ""));
          } else if (line === "DONE") {
            done = true;
          } else {
            setRunLog((prev) => (prev ?? "") + line + "\n");
          }
        }
      }
      if (!failed) {
        refreshRef.current.dashboard();
        refreshRef.current.scorecard();
        refreshRef.current.health();
      }
    } catch (e) {
      setRunError(e instanceof Error ? e.message : "Engine failed");
    } finally {
      clearInterval(poll);
      setRunning(false);
    }
  }, [universe, skipFetch]);

  const exportExcel = useCallback(() => {
    setExportError(null);
    void downloadBlob(
      "/api/export/engine",
      `quant-engine-${new Date().toISOString().slice(0, 10)}.xlsx`,
      "POST",
      { rows },
    ).catch((e: unknown) => setExportError(e instanceof Error ? e.message : "Export failed"));
  }, [rows]);

  /** Opens a name's full working in the scorecard, from anywhere on the desk. */
  const inspect = useCallback((symbol: string) => {
    setSignalFilter("ALL");
    setExpanded(symbol);
    requestAnimationFrame(() => {
      document.getElementById("desk-scorecard")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, []);

  /* ---------------------------------------------------------------------- */
  /* Rail state — mirrors each section's real load state                    */
  /* ---------------------------------------------------------------------- */

  const briefState: RailState =
    dashboard.isInitialLoading ? "loading" : dashboard.error ? "error" : brief ? "ready" : "empty";

  // Only sections that are actually in the DOM. This is load-bearing twice over:
  // the rail must not offer a jump target that doesn't exist, and the rail's
  // IntersectionObserver re-subscribes when this list changes — so excluding the
  // brief-gated sections until `brief` lands is what makes the observer pick them
  // up once they mount. (Passing a fixed list meant the observer only ever saw the
  // sections present on first paint, and the rail stayed stuck on "Regime".)
  const sections: RailSection[] = useMemo(
    () =>
      SECTION_META.filter((s) => !s.needsBrief || brief != null).map(({ id, label }) => ({
        id,
        label,
        state:
          id === "desk-scorecard"
            ? scorecard.isInitialLoading ? "loading" : scorecard.error ? "error" : rows.length ? "ready" : "empty"
            : id === "desk-health"
              ? health.isInitialLoading ? "loading" : health.error ? "error" : "ready"
              : id === "desk-validation"
                ? "ready"
                : briefState,
      })),
    [brief, briefState, scorecard.isInitialLoading, scorecard.error, rows.length, health.isInitialLoading, health.error],
  );

  const nothingAtAll =
    !dashboard.isInitialLoading && !scorecard.isInitialLoading && !brief && rows.length === 0;

  // Deep trailing padding is functional, not decorative: without it the document
  // ends before the last sections can be scrolled to the top, so the rail could
  // never mark them current, and clicking "Health" would leave it stranded
  // mid-viewport. This gives every jump target room to actually reach the top.
  return (
    <PageShell gap="gap-8" py="py-8 pb-[40vh]">
      <DeskRail sections={sections} />

      {/* ── Masthead ── */}
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2.5">
              <h1 className="text-2xl font-semibold tracking-tight">Quant Engine</h1>
              <Badge variant="brand">Systematic desk</Badge>
              {(dashboard.revalidating || scorecard.revalidating) && !running && (
                <LoadingMark size={14} label="Refreshing" />
              )}
            </div>
            <p className="max-w-2xl text-sm text-muted">
              What the market is creating today, and why — one adaptive model over a whole universe.
              Regime state, probability distributions, position sizing, and a running account of
              whether the model is currently earning its keep.
            </p>
          </div>

          {brief && (
            <div className="flex flex-col items-end gap-0.5 text-right">
              <span className="font-mono text-sm tabular-nums">{brief.latest_date}</span>
              <span className="text-label text-faint">
                {brief.n_symbols} names scored
                {brief.prev_date && ` · prior run ${brief.prev_date}`}
              </span>
            </div>
          )}
        </div>

        <RunConsole
          universe={universe}
          onUniverseChange={setUniverse}
          skipFetch={skipFetch}
          onSkipFetchChange={setSkipFetch}
          running={running}
          progress={progress}
          log={runLog}
          onRun={(o) => void runEngine(o)}
          onExport={exportExcel}
          canExport={rows.length > 0}
        />

        {runError && (
          <p className="rounded-card border border-negative/40 bg-negative/10 px-4 py-3 text-sm text-negative">
            {runError}
          </p>
        )}
        {exportError && <p className="text-xs text-negative">{exportError}</p>}
      </div>

      {/* ── Cold start ── */}
      {nothingAtAll && (
        <ColdStart
          reason={briefEmpty?.reason ?? "No scored universe on file yet."}
          degraded={Boolean(briefEmpty?.degraded)}
          running={running}
          onRun={() => void runEngine({ noForecast: true })}
          onRetry={() => { dashboard.refresh(); scorecard.refresh(); }}
        />
      )}

      {/* ── 1. Regime ── */}
      <DeskSection id="desk-regime" label="Market regime" description="The model's read on the tape, and what it implies">
        {dashboard.isInitialLoading ? (
          <HeroSkeleton />
        ) : dashboard.error ? (
          <SectionFailure message={dashboard.error} onRetry={dashboard.refresh} />
        ) : brief ? (
          <Reveal index={0}>
            <RegimeHero
              regime={brief.regime}
              breadth={brief.breadth}
              latestDate={brief.latest_date}
              nSymbols={brief.n_symbols}
            />
          </Reveal>
        ) : (
          <SectionNote>{briefEmpty?.reason ?? "No regime on file."}</SectionNote>
        )}
      </DeskSection>

      {/* ── 2. What changed ── */}
      {brief && (
        <DeskSection id="desk-changed" label="Changed today" description="Deltas since the previous run — where the new work is">
          <ChangedToday movers={brief.movers} prevDate={brief.prev_date} />
        </DeskSection>
      )}

      {/* ── 3. Conviction book ── */}
      {brief && (
        <DeskSection
          id="desk-book"
          label="Conviction book"
          description="Highest-conviction longs and shorts, with the distribution behind each"
        >
          <ConvictionBook
            longs={brief.conviction.longs}
            shorts={brief.conviction.shorts}
            hasForecasts={brief.conviction.has_forecasts}
            onInspect={inspect}
          />
        </DeskSection>
      )}

      {/* ── 4. Factor lab ── */}
      {brief && (
        <DeskSection
          id="desk-factors"
          label="Factor lab"
          description="Which factors are carrying the signal, and how the weighting has rotated"
        >
          <FactorLab weights={brief.factor_weights} />
        </DeskSection>
      )}

      {/* ── 5. Breadth ── */}
      {brief && (
        <DeskSection id="desk-breadth" label="Market breadth" description="The shape of the whole scored universe">
          <BreadthMap breadth={brief.breadth} onFilterSignal={setSignalFilter} activeSignal={signalFilter} />
        </DeskSection>
      )}

      {/* ── 6. Full scorecard ── */}
      <DeskSection
        id="desk-scorecard"
        label="Full scorecard"
        description="Every scored name and every factor column — the complete record"
      >
        {scorecard.isInitialLoading ? (
          <TableSkeleton />
        ) : scorecard.error ? (
          <SectionFailure message={scorecard.error} onRetry={scorecard.refresh} />
        ) : rows.length > 0 ? (
          <ScorecardTable
            rows={rows}
            signalFilter={signalFilter}
            onSignalFilterChange={setSignalFilter}
            expanded={expanded}
            onExpandedChange={setExpanded}
          />
        ) : (
          <SectionNote>No scorecard snapshot yet — run the engine to score a universe.</SectionNote>
        )}
      </DeskSection>

      {/* ── 7. Model health ── */}
      <DeskSection
        id="desk-health"
        label="Model health"
        description="The engine's continuous, out-of-sample report on itself"
      >
        {health.isInitialLoading ? (
          <GridSkeleton />
        ) : health.error ? (
          <SectionFailure message={health.error} onRetry={health.refresh} />
        ) : health.data ? (
          <ModelHealth metrics={health.data} />
        ) : (
          <SectionNote>No health data available.</SectionNote>
        )}
      </DeskSection>

      {/* ── 8. Validation ── */}
      <DeskSection
        id="desk-validation"
        label="Model validation"
        description="Did the engine's own calls actually pay? Runs only when you ask"
      >
        <ModelValidation />
      </DeskSection>
    </PageShell>
  );
}

/* -------------------------------------------------------------------------- */
/* Section chrome                                                             */
/* -------------------------------------------------------------------------- */

/** A desk section: anchor id for the rail, header, and body. Bare (no Card) —
 *  each section composes its own internal panels, and wrapping every one in a card
 *  is exactly the "dashboard full of cards" look the desk is avoiding. */
function DeskSection({
  id,
  label,
  description,
  children,
}: {
  id: string;
  label: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="flex scroll-mt-24 flex-col gap-4">
      <SectionHeader label={label} description={description} />
      {children}
    </section>
  );
}

function SectionNote({ children }: { children: React.ReactNode }) {
  return <p className="py-4 text-sm text-muted">{children}</p>;
}

/** A failed section fails alone: its own message, its own retry, siblings intact. */
function SectionFailure({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-start gap-2 rounded-card border border-negative/30 bg-negative/5 px-4 py-3">
      <p className="text-sm text-negative">{message}</p>
      <Button variant="secondary" size="sm" onClick={onRetry}>
        Retry
      </Button>
    </div>
  );
}

function ColdStart({
  reason,
  degraded,
  running,
  onRun,
  onRetry,
}: {
  reason: string;
  degraded: boolean;
  running: boolean;
  onRun: () => void;
  onRetry: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-5 rounded-card border border-border bg-surface px-6 py-12 text-center">
      <LoadingMark size={32} state={running ? "loading" : "done"} />
      <div className="flex max-w-lg flex-col gap-2">
        <p className="text-sm font-semibold">{degraded ? "Brief unavailable" : "The desk has no data yet"}</p>
        <p className="text-xs leading-relaxed text-muted">{reason}</p>
        {!degraded && (
          <p className="text-xs leading-relaxed text-muted">
            Pick a universe above and run the engine. Results start appearing before the run finishes —
            factor scores publish first, then Monte Carlo valuations, then forecasts.
          </p>
        )}
      </div>
      <div className="flex gap-2">
        <Button variant="primary" onClick={onRun} disabled={running}>
          {running ? "Running…" : "Run the engine"}
        </Button>
        <Button variant="secondary" onClick={onRetry} disabled={running}>
          Retry load
        </Button>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Skeletons — shape-matched, so nothing shifts when the real content lands    */
/* -------------------------------------------------------------------------- */

function HeroSkeleton() {
  return (
    <div className="grid gap-6 rounded-card border border-border bg-surface p-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,20rem)]" aria-hidden>
      <div className="flex flex-col gap-3">
        <Skeleton height="h-6" width="w-40" radius="rounded-full" />
        <Skeleton height="h-3" />
        <Skeleton height="h-3" width="w-4/5" />
        <div className="mt-2 grid grid-cols-3 gap-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} height="h-12" />
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-2 rounded-card border border-border p-4">
        {[0, 1, 2, 3, 4].map((i) => (
          <Skeleton key={i} height="h-2.5" radius="rounded-full" />
        ))}
      </div>
    </div>
  );
}

function GridSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4" aria-hidden>
      {[0, 1, 2, 3].map((i) => (
        <Skeleton key={i} height="h-16" radius="rounded-card" />
      ))}
    </div>
  );
}

function TableSkeleton() {
  return (
    <div className="flex flex-col gap-2" aria-hidden>
      <Skeleton height="h-8" width="w-64" radius="rounded-control" />
      <Skeleton height="h-64" radius="rounded-card" />
    </div>
  );
}
