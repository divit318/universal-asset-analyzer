"use client";

/**
 * The Universal Screener.
 *
 * One screener, seven asset classes. Everything that differs between them —
 * filters, templates, columns, ranking, warnings, AI framing — is read from the
 * Asset Registry (lib/assets/), so this page contains no per-asset-class
 * branching whatsoever. Switching from Equities to Bonds swaps the entire
 * filter set, the entire results table and the ranking model, and the code path
 * is identical.
 *
 * The previous version of this file was ~860 lines of equity-specific state and
 * hardcoded columns. That the replacement is shorter *while supporting seven
 * asset classes instead of one* is the whole argument for the registry.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { PageShell, PageHeader, Button, Card, Badge, TaskProgress, useElapsedMs } from "@/app/_components/ui";
import { Reveal } from "@/app/_components/reveal";
import { downloadBlob } from "@/lib/download";
import { getAssetClass, getMetric, isAssetClassId, listAssetClasses } from "@/lib/assets/registry";
import type { AssetClassId } from "@/lib/assets/types";
import { PENDING_SCREEN_KEY, type PendingScreenHandoff } from "@/app/_components/screener-handoff";
import type { RankedCandidate, ScreenerResponse, UniverseStatus } from "@/lib/screener/types";
import type { SavedScreen } from "@/lib/db";
import { FilterPanel } from "./_components/filter-panel";
import { ResultsTable, type ResultsEmptyState } from "./_components/results-table";
import { SavedScreens } from "./_components/saved-screens";
import {
  countActive,
  draftFromTemplate,
  emptyDraft,
  fromFilterValues,
  toFilterValues,
  type Draft,
  type DraftValue,
} from "./_components/filter-state";

const PAGE_SIZE = 50;

/**
 * Universe state.
 *
 * A cold build fetches fundamentals for every asset in the class and takes
 * minutes, so while it runs this shows the same real progress the Scanner does —
 * named stage, percent, elapsed, and an estimated finish — instead of a bare
 * count. A first-time user watching "0/0 (0%)" next to an empty table has no way
 * to tell a warming cache from a broken product.
 */
function UniverseBar({
  status,
  loading,
  startedAt,
  onRefresh,
}: {
  status: UniverseStatus | null;
  loading: boolean;
  startedAt: number | null;
  onRefresh: () => void;
}) {
  // Hook before any early return — this ticks once a second while a build runs.
  const elapsed = useElapsedMs(startedAt);

  if (!status) return null;

  const building = status.stage === "building";
  const pct = status.total > 0 ? (status.ready / status.total) * 100 : null;

  // Extrapolate from observed throughput. Only offered once enough of the build
  // has completed for the rate to mean anything. Elapsed comes from the shared
  // ticking hook rather than a render-time Date.now(), which would be impure.
  const remainingMs =
    building && pct != null && pct >= 5 && elapsed > 3000
      ? Math.round((elapsed / pct) * (100 - pct))
      : null;

  if (building) {
    return (
      <div className="rounded-card border border-border bg-surface p-4">
        <TaskProgress
          label="Building the screening universe"
          detail={
            status.total > 0
              ? `${status.ready.toLocaleString()} of ${status.total.toLocaleString()} assets priced`
              : "Fetching the asset list"
          }
          pct={pct}
          elapsedMs={elapsed}
          remainingMs={remainingMs}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-3 text-xs text-muted">
      {status.stage === "error" ? (
        <span className="text-negative">Universe failed to build: {status.error}</span>
      ) : (
        <span>
          {status.ready.toLocaleString()} assets ready
          {status.builtAt ? ` · updated ${new Date(status.builtAt).toLocaleTimeString()}` : ""}
        </span>
      )}
      <button
        type="button"
        onClick={onRefresh}
        disabled={loading}
        className="underline underline-offset-2 transition-colors hover:text-brand disabled:opacity-40"
      >
        Refresh data
      </button>
    </div>
  );
}

export default function ScreenerPage() {
  const classes = listAssetClasses();

  const [assetClass, setAssetClass] = useState<AssetClassId>("equity");
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  /**
   * The filter set the *visible rows* were produced with, as opposed to the
   * draft the user is editing. Filters only take effect on "Run screen", so
   * these two diverge the moment anything is typed — and reporting the draft's
   * count next to the results made the table claim "1,541 stocks · 1 filter"
   * while showing the completely unfiltered universe.
   */
  const [applied, setApplied] = useState<{ draft: Draft; templateId: string | null }>({
    draft: emptyDraft(),
    templateId: null,
  });
  const [sortKey, setSortKey] = useState("rankScore");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const [rows, setRows] = useState<RankedCandidate[] | null>(null);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [status, setStatus] = useState<UniverseStatus | null>(null);
  /** When the current universe build was first observed — drives elapsed/ETA. */
  const [buildStartedAt, setBuildStartedAt] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [saved, setSaved] = useState<SavedScreen[]>([]);
  const [saving, setSaving] = useState(false);
  const [watchlisted, setWatchlisted] = useState<Set<string>>(new Set());

  const [summary, setSummary] = useState<{ text: string; model: string } | null>(null);
  const [summarizing, setSummarizing] = useState(false);

  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const def = getAssetClass(assetClass);

  /* ---------------------------------------------------------------------- */
  /* Running a screen                                                        */
  /* ---------------------------------------------------------------------- */

  interface RunOptions {
    assetClass: AssetClassId;
    templateId: string | null;
    draft: Draft;
    sortKey: string;
    sortDir: "asc" | "desc";
    offset: number;
  }

  /** The last screen we ran, so the poll below can re-run exactly it. */
  const lastRunRef = useRef<RunOptions | null>(null);

  /**
   * Monotonic id of the most recently *requested* screen.
   *
   * Screens are fired on every class switch, template pick, sort and page turn,
   * and they do not come back in the order they were sent — the equity universe
   * is 1,500 names with a live price layer, so its response routinely lands
   * seconds after a subsequent ETF one. Without this guard the slower, older
   * response wins the `setRows` race and the table renders another asset class's
   * rows under the current class's columns: select ETFs, get equities, with the
   * count reading "1,545 funds". (Reproduced live before this was added.)
   *
   * Anything that isn't the newest request is therefore dropped outright rather
   * than merged, including its `loading`/`error`/`status` side effects.
   */
  const runSeqRef = useRef(0);

  const run = useCallback(async (opts: RunOptions) => {
    lastRunRef.current = opts;
    const seq = ++runSeqRef.current;
    const isCurrent = () => seq === runSeqRef.current;
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/screener", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assetClass: opts.assetClass,
          templateId: opts.templateId,
          filters: toFilterValues(opts.assetClass, opts.draft),
          sortKey: opts.sortKey,
          sortDir: opts.sortDir,
          size: PAGE_SIZE,
          offset: opts.offset,
        }),
      });

      const json = (await res.json()) as ScreenerResponse & { error?: string };
      if (!isCurrent()) return;
      if (!res.ok || json.error) throw new Error(json.error ?? "Screen failed");
      // Belt and braces: a response that isn't for the class we asked about can
      // never be rendered, whatever the sequencing above concluded.
      if (json.assetClass !== opts.assetClass) return;

      setRows(json.rows);
      setTotal(json.total);
      setOffset(json.offset);
      setStatus(json.status);
      // The filters the visible rows were actually produced with — see
      // `pendingFilterChanges` below for why the draft alone isn't enough.
      setApplied({ draft: opts.draft, templateId: opts.templateId });

      // Latch the moment a build was first observed, so elapsed/ETA measure the
      // build rather than the age of the last poll.
      setBuildStartedAt((prev) =>
        json.status.stage === "building" ? prev ?? Date.now() : null,
      );
    } catch (err) {
      if (!isCurrent()) return;
      setError(err instanceof Error ? err.message : "Something went wrong");
      setRows([]);
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, []);

  /**
   * While a universe is still warming, the API returns whatever is ready so
   * far. Poll until it's done, then re-run so the user ends up looking at the
   * full result set rather than a partial one.
   *
   * This lives in its own effect keyed on the build stage rather than as a
   * self-scheduling setTimeout inside `run` — a callback that recursively
   * references itself can't be declared before it's used, and the indirection
   * needed to work around that is worse than just letting the status drive it.
   */
  useEffect(() => {
    if (status?.stage !== "building") return;
    const opts = lastRunRef.current;
    if (!opts) return;

    pollRef.current = setTimeout(() => void run(opts), 2500);
    return () => {
      if (pollRef.current) clearTimeout(pollRef.current);
    };
  }, [status, run]);

  const loadSaved = useCallback(async (forClass: AssetClassId) => {
    try {
      const res = await fetch(`/api/screener/saved?class=${forClass}`);
      const json = (await res.json()) as { screens?: SavedScreen[] };
      setSaved(json.screens ?? []);
    } catch {
      // A failed saved-screens fetch shouldn't break the screener itself.
    }
  }, []);

  /**
   * Switching asset class resets the whole screen — filters, template, sort and
   * the AI summary are all class-specific and none of them survive the move.
   *
   * This is done here, in the event handler, rather than in an effect keyed on
   * `assetClass`: the reset is a direct consequence of the user's click, not a
   * synchronization with an external system, and doing it in an effect would
   * mean rendering once with the old class's filters against the new class's
   * data before correcting itself.
   */
  const selectAssetClass = (id: AssetClassId) => {
    if (id === assetClass) return;
    const next = getAssetClass(id);
    const fresh = emptyDraft();

    setAssetClass(id);
    setTemplateId(null);
    setDraft(fresh);
    // Cleared alongside the draft so the results header never describes the
    // previous class's filters while the new class's screen is in flight.
    setApplied({ draft: fresh, templateId: null });
    setSortKey(next.defaultSort.key);
    setSortDir(next.defaultSort.dir);
    setSummary(null);
    setRows(null);
    // Also zeroed: the count is rendered with the *new* class's noun, so a
    // leftover total read "456 bond funds" while the bond universe was still
    // building — a number that described the ETFs the user just navigated away
    // from.
    setTotal(0);
    setOffset(0);
    setError(null);

    void run({
      assetClass: id,
      templateId: null,
      draft: fresh,
      sortKey: next.defaultSort.key,
      sortDir: next.defaultSort.dir,
      offset: 0,
    });
    void loadSaved(id);
  };

  /**
   * First load. The disable is for the mount-time fetch only: `run()` flips
   * `loading` on synchronously before it awaits, which is exactly the pattern
   * this rule is aimed at — but there is no way to kick off an initial fetch
   * without it, and the same disable is used for the same reason in
   * app/research/page.tsx. The genuinely-avoidable case (resetting state when
   * the asset class changes) is handled in `selectAssetClass` above instead.
   */
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    // The AI Assistant hands off a parsed natural-language screen this way —
    // sessionStorage rather than the URL, since a filter object is richer
    // than a clean query string (see app/_components/screener-handoff.ts).
    // Applied once, then cleared, so a later plain visit to /screener isn't
    // silently re-filtered.
    let initial: RunOptions = {
      assetClass: "equity",
      templateId: null,
      draft: emptyDraft(),
      sortKey: getAssetClass("equity").defaultSort.key,
      sortDir: getAssetClass("equity").defaultSort.dir,
      offset: 0,
    };
    try {
      const pending = sessionStorage.getItem(PENDING_SCREEN_KEY);
      if (pending) {
        sessionStorage.removeItem(PENDING_SCREEN_KEY);
        const handoff = JSON.parse(pending) as PendingScreenHandoff;
        if (isAssetClassId(handoff.assetClass)) {
          const handoffClass = getAssetClass(handoff.assetClass);
          initial = {
            assetClass: handoff.assetClass,
            templateId: handoff.templateId,
            draft: fromFilterValues(handoff.assetClass, handoff.filters),
            sortKey: handoffClass.defaultSort.key,
            sortDir: handoffClass.defaultSort.dir,
            offset: 0,
          };
        }
      }
    } catch {
      // Malformed/missing handoff — fall through to the equity default.
    }

    setAssetClass(initial.assetClass);
    setTemplateId(initial.templateId);
    setDraft(initial.draft);
    setSortKey(initial.sortKey);
    setSortDir(initial.sortDir);

    void run(initial);
    void loadSaved(initial.assetClass);

    void (async () => {
      try {
        const res = await fetch("/api/watchlist");
        const json = (await res.json()) as { items?: { symbol: string }[] };
        setWatchlisted(new Set((json.items ?? []).map((i) => i.symbol)));
      } catch {
        // Non-fatal — the screener works fine without watchlist state.
      }
    })();

    return () => {
      if (pollRef.current) clearTimeout(pollRef.current);
    };
  }, [run, loadSaved]);
  /* eslint-enable react-hooks/set-state-in-effect */

  /* ---------------------------------------------------------------------- */
  /* Handlers                                                                */
  /* ---------------------------------------------------------------------- */

  const rerun = (next: Partial<{ templateId: string | null; draft: Draft; sortKey: string; sortDir: "asc" | "desc"; offset: number }>) => {
    const merged = {
      assetClass,
      templateId: next.templateId !== undefined ? next.templateId : templateId,
      draft: next.draft ?? draft,
      sortKey: next.sortKey ?? sortKey,
      sortDir: next.sortDir ?? sortDir,
      offset: next.offset ?? 0,
    };
    void run(merged);
  };

  const applyTemplate = (id: string) => {
    const isSame = templateId === id;
    const nextTemplate = isSame ? null : id;
    const nextDraft = isSame ? emptyDraft() : draftFromTemplate(assetClass, id);
    const template = nextTemplate ? def.templates.find((t) => t.id === nextTemplate) : null;
    const nextSortKey = template?.sort?.key ?? def.defaultSort.key;
    const nextSortDir = template?.sort?.dir ?? def.defaultSort.dir;

    setTemplateId(nextTemplate);
    setDraft(nextDraft);
    setSortKey(nextSortKey);
    setSortDir(nextSortDir);
    setSummary(null);
    rerun({ templateId: nextTemplate, draft: nextDraft, sortKey: nextSortKey, sortDir: nextSortDir });
  };

  const changeFilter = (key: string, value: DraftValue | undefined) => {
    setDraft((prev) => {
      const next = { ...prev };
      if (value === undefined) delete next[key];
      else next[key] = value;
      return next;
    });
  };

  /**
   * Sort by a column, toggling direction on repeat clicks.
   *
   * The *first* click follows the metric's own `better` direction rather than
   * always sorting descending: clicking "Fwd P/E" or "Expense Ratio" used to
   * put the most expensive names on top, which is the opposite of what someone
   * clicking a cheapness column is asking for. Registry-driven, so it's right
   * for every metric on every class without a per-column list.
   */
  const toggleSort = (key: string) => {
    const preferred: "asc" | "desc" = getMetric(assetClass, key)?.better === "lower" ? "asc" : "desc";
    const dir: "asc" | "desc" =
      sortKey === key ? (sortDir === "desc" ? "asc" : "desc") : preferred;
    setSortKey(key);
    setSortDir(dir);
    rerun({ sortKey: key, sortDir: dir });
  };

  const clearAll = () => {
    setTemplateId(null);
    setDraft(emptyDraft());
    setSummary(null);
    // Picking a template can change the sort, so clearing one has to put the
    // sort back too — otherwise "Clear all" left the table ordered by a
    // template's column with nothing on screen explaining why.
    setSortKey(def.defaultSort.key);
    setSortDir(def.defaultSort.dir);
    rerun({
      templateId: null,
      draft: emptyDraft(),
      sortKey: def.defaultSort.key,
      sortDir: def.defaultSort.dir,
    });
  };

  const refresh = async () => {
    setLoading(true);
    try {
      await fetch("/api/screener", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assetClass, refresh: true }),
      });
    } finally {
      rerun({});
    }
  };

  const save = async (name: string) => {
    setSaving(true);
    try {
      await fetch("/api/screener/saved", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          assetClass,
          templateId,
          filters: toFilterValues(assetClass, draft),
          sortKey,
          sortDir,
        }),
      });
      await loadSaved(assetClass);
    } finally {
      setSaving(false);
    }
  };

  const loadScreen = (screen: SavedScreen) => {
    // A saved screen's filters were validated against the registry when saved,
    // and are re-validated by the API on the next run — so a filter whose metric
    // has since lost its data provider simply disappears rather than breaking.
    const nextDraft = fromFilterValues(assetClass, screen.filters as never);
    setTemplateId(screen.templateId);
    setDraft(nextDraft);
    setSortKey(screen.sortKey);
    setSortDir(screen.sortDir);
    setSummary(null);
    rerun({
      templateId: screen.templateId,
      draft: nextDraft,
      sortKey: screen.sortKey,
      sortDir: screen.sortDir,
    });
  };

  const removeScreen = async (id: string) => {
    await fetch(`/api/screener/saved?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    await loadSaved(assetClass);
  };

  const watch = async (row: RankedCandidate) => {
    setWatchlisted((prev) => new Set(prev).add(row.symbol));
    try {
      await fetch("/api/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Provenance: which screen produced this idea, so the Pipeline board can
        // answer "why am I seeing this?" months later (lib/idea-source.ts).
        body: JSON.stringify({
          symbol: row.symbol,
          name: row.name,
          source: "screener",
          sourceDetail: `${def.label} screen · rank #${row.rank}`,
        }),
      });
    } catch {
      setWatchlisted((prev) => {
        const next = new Set(prev);
        next.delete(row.symbol);
        return next;
      });
    }
  };

  const exportXlsx = async () => {
    if (!rows?.length) return;
    try {
      await downloadBlob(
        "/api/export/screener",
        `uaa-${assetClass}-screen.xlsx`,
        "POST",
        { assetClass, rows },
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export failed");
    }
  };

  const explain = async () => {
    setSummarizing(true);
    setSummary(null);
    try {
      const res = await fetch("/api/screener/explain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assetClass,
          templateId,
          filters: toFilterValues(assetClass, draft),
          sortKey,
          sortDir,
        }),
      });
      const json = (await res.json()) as { summary?: string; model?: string; error?: string };
      if (json.error) throw new Error(json.error);
      setSummary({ text: json.summary ?? "", model: json.model ?? "local" });
    } catch (err) {
      setSummary({
        text: err instanceof Error ? err.message : "Could not explain this ranking.",
        model: "error",
      });
    } finally {
      setSummarizing(false);
    }
  };

  /* ---------------------------------------------------------------------- */

  const draftCount = countActive(draft);
  const appliedCount = countActive(applied.draft);
  /** Has the user edited filters since the visible results were produced? */
  const pendingFilterChanges =
    JSON.stringify(toFilterValues(assetClass, draft)) !==
    JSON.stringify(toFilterValues(assetClass, applied.draft));

  /* Why an empty results table is empty. Resolved here, where the universe
     status and the filter draft both live, so the table never has to guess —
     and never again tells a user to loosen filters they have not set.
     `appliedCount`, not the draft count: the question is which filters produced
     the rows on screen, not which ones the user is midway through editing. */
  const emptyState: ResultsEmptyState =
    status?.stage === "error"
      ? { kind: "universe-error", error: status.error ?? "Unknown error." }
      : status?.stage === "building"
        ? { kind: "building", ready: status.ready, total: status.total }
        : appliedCount === 0
          ? { kind: "not-run" }
          : { kind: "no-matches", activeFilterCount: appliedCount };

  /*
   * Revealed at section granularity — the four blocks a user actually perceives
   * (identity, templates, filters, results), not the table rows.
   *
   * Staggering 50 result rows was the obvious move and the wrong one: a screen
   * is re-run constantly, so every filter change would re-animate the whole
   * table, and a ranked list rippling in draws the eye down the page when the
   * information is at the top. The panels arrive; the data inside them is
   * simply there.
   */
  return (
    <PageShell py="py-10" width="wide">
      <Reveal index={0} className="flex flex-col gap-3">
        <PageHeader
          title="Universal Screener"
          description="One screener across seven asset classes. Pick a class, start from a template or build your own filters, and every result comes back ranked with an explanation of why it matched."
        />

        {/* 1. Asset class selection — the first decision the user makes. */}
        <nav className="flex flex-wrap gap-1.5" aria-label="Asset class">
          {classes.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => selectAssetClass(c.id)}
              aria-current={assetClass === c.id}
              className={`rounded-lg border px-3 py-1.5 text-sm transition-colors ${
                assetClass === c.id
                  ? "border-brand bg-brand/10 font-medium text-brand"
                  : "border-border bg-surface text-muted hover:border-brand/50 hover:text-fg"
              }`}
            >
              {c.label}
            </button>
          ))}
        </nav>

        <p className="text-sm text-muted">{def.description}</p>
        <UniverseBar status={status} loading={loading} startedAt={buildStartedAt} onRefresh={refresh} />
      </Reveal>

      {/* 2. Templates. */}
      <Reveal index={1} as="section" className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium">Templates</h2>
          {templateId || draftCount > 0 ? (
            <button
              type="button"
              onClick={clearAll}
              className="text-xs text-muted underline underline-offset-2 hover:text-brand"
            >
              Clear all
            </button>
          ) : null}
        </div>

        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {def.templates.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => applyTemplate(t.id)}
              aria-pressed={templateId === t.id}
              className={`rounded-xl border p-3 text-left transition-colors ${
                templateId === t.id
                  ? "border-brand bg-brand/5"
                  : "border-border bg-surface hover:border-brand/50"
              }`}
            >
              <p className="text-sm font-medium">{t.name}</p>
              <p className="mt-0.5 text-xs text-muted">{t.tagline}</p>
            </button>
          ))}
        </div>
      </Reveal>

      <div className="grid gap-6 lg:grid-cols-[300px_1fr]">
        {/* 3. Filters — entirely registry-driven. */}
        <Reveal index={2} as="aside" className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium">Filters</h2>
            <Button onClick={() => rerun({})} disabled={loading} className="px-3 py-1.5 text-xs">
              {loading ? "Running…" : pendingFilterChanges ? "Run screen •" : "Run screen"}
            </Button>
          </div>

          {pendingFilterChanges && !loading ? (
            <p className="text-xs text-warning" role="status">
              Filter changes aren&apos;t applied yet — run the screen to update the results.
            </p>
          ) : null}

          <FilterPanel assetClass={assetClass} draft={draft} onChange={changeFilter} />

          <SavedScreens
            screens={saved}
            draft={draft}
            saving={saving}
            onSave={save}
            onLoad={loadScreen}
            onDelete={removeScreen}
          />
        </Reveal>

        {/* 4-5. Ranked results + explanations. */}
        <Reveal index={3} as="section" className="flex min-w-0 flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">
                {total.toLocaleString()} {def.noun}
              </span>
              {/* Both badges describe the *applied* screen, not the draft. */}
              {appliedCount > 0 ? (
                <Badge variant="neutral">
                  {appliedCount} filter{appliedCount === 1 ? "" : "s"}
                </Badge>
              ) : null}
              {applied.templateId ? (
                <Badge variant="brand">
                  {def.templates.find((t) => t.id === applied.templateId)?.name}
                </Badge>
              ) : null}
              {pendingFilterChanges ? <Badge variant="warning">Filters not applied</Badge> : null}
            </div>

            <div className="flex items-center gap-2">
              <Button
                onClick={exportXlsx}
                disabled={!rows?.length}
                className="px-3 py-1.5 text-xs"
              >
                Export
              </Button>
              <Button
                onClick={explain}
                disabled={summarizing || !rows?.length}
                className="px-3 py-1.5 text-xs"
              >
                {summarizing ? "Thinking…" : "Explain this ranking"}
              </Button>
            </div>
          </div>

          {error ? (
            <Card className="border-rose-500/40 p-4 text-sm text-rose-500">{error}</Card>
          ) : null}

          {summary ? (
            <Card className="flex flex-col gap-2 p-4">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">AI read on this ranking</span>
                <span className="rounded-full bg-brand/10 px-2 py-0.5 text-[10px] font-medium text-brand">
                  Local · {summary.model.split(":")[0]}
                </span>
              </div>
              <div className="flex flex-col gap-2 text-sm leading-relaxed text-muted">
                {summary.text.split("\n").filter(Boolean).map((para, i) => (
                  <p key={i}>{para}</p>
                ))}
              </div>
            </Card>
          ) : null}

          {rows == null ? (
            <Card className="p-12 text-center text-sm text-muted">Loading {def.noun}…</Card>
          ) : (
            <>
              <ResultsTable
                assetClass={assetClass}
                rows={rows}
                sortKey={sortKey}
                sortDir={sortDir}
                onSort={toggleSort}
                watchlisted={watchlisted}
                onWatch={watch}
                emptyState={emptyState}
              />

              {total > PAGE_SIZE ? (
                <div className="flex items-center justify-between text-xs text-muted">
                  <span>
                    {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} of {total.toLocaleString()}
                  </span>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => rerun({ offset: Math.max(offset - PAGE_SIZE, 0) })}
                      disabled={offset === 0 || loading}
                      className="rounded-md border border-border px-2 py-1 transition-colors hover:border-brand hover:text-brand disabled:opacity-40"
                    >
                      Previous
                    </button>
                    <button
                      type="button"
                      onClick={() => rerun({ offset: offset + PAGE_SIZE })}
                      disabled={offset + PAGE_SIZE >= total || loading}
                      className="rounded-md border border-border px-2 py-1 transition-colors hover:border-brand hover:text-brand disabled:opacity-40"
                    >
                      Next
                    </button>
                  </div>
                </div>
              ) : null}
            </>
          )}
        </Reveal>
      </div>
    </PageShell>
  );
}
