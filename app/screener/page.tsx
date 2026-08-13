"use client";

/**
 * The Universal Screener.
 *
 * One screener across every screening universe in the Asset Registry: the
 * base asset classes plus market-scoped variants like India Equities
 * (indiaEquity, marketVariantOf: "equity"). Everything that differs between
 * universes — filters, templates, columns, ranking, warnings, AI framing — is
 * read from the registry (lib/assets/), so this page contains almost no
 * per-universe branching (the one exception: India's results-season strip).
 * Switching from Equities to Bonds swaps the entire filter set, the entire
 * results table and the ranking model, and the code path is identical.
 *
 * Taxonomy note: this page's navigation selects a *screening universe*, not
 * an asset class — the distinction the Compare page's tabs draw via
 * listBaseAssetClasses(). All labels, counts, and copy here are derived from
 * the registry (universeLabel(), listAssetClasses(), listBaseAssetClasses())
 * so the UI cannot drift from the data model.
 *
 * The previous version of this file was ~860 lines of equity-specific state and
 * hardcoded columns. That the replacement is shorter *while supporting every
 * universe instead of one* is the whole argument for the registry.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { PageShell, PageHeader, Button, Card, Badge, TaskProgress, useElapsedMs } from "@/app/_components/ui";
import { Reveal } from "@/app/_components/reveal";
import { downloadBlob } from "@/lib/download";
import { getAssetClass, getMetric, isAssetClassId, listAssetClasses, listBaseAssetClasses, universeLabel } from "@/lib/assets/registry";
import type { AssetClassId, FilterValues } from "@/lib/assets/types";
import { PENDING_SCREEN_KEY, type PendingScreenHandoff } from "@/app/_components/screener-handoff";
import type { RankedCandidate, ScreenerResponse, UniverseStatus } from "@/lib/screener/types";
import type { FilterDiagnostic } from "@/lib/screener/filter-engine";
import type { MetricDistribution } from "@/lib/screener/universe-stats";
import type { SavedScreen } from "@/lib/db";
import { FilterPanel } from "./_components/filter-panel";
import { ScreenDeck } from "./_components/screen-deck";
import { ResultsTable, type ResultsEmptyState } from "./_components/results-table";
import { IndiaResultsStrip } from "./_components/india-results-strip";
import { SavedScreens } from "./_components/saved-screens";
import { WhyEmpty } from "./_components/why-empty";
import { FilterChips } from "./_components/filter-chips";
import { ScreenDiff } from "./_components/screen-diff";
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
 * Cold-build progress.
 *
 * A cold build fetches fundamentals for every asset in the class and takes
 * minutes, so while it runs this shows the same real progress the Scanner does —
 * named stage, percent, elapsed, and an estimated finish — instead of a bare
 * count. A first-time user watching "0/0 (0%)" next to an empty table has no way
 * to tell a warming cache from a broken product.
 *
 * Building only: the ready-state one-liner lives in the command deck beside the
 * universe choice, and a build *failure* is explained in the results empty state
 * (kind: "universe-error"), where the user is actually looking for rows.
 */
function UniverseBar({ status, startedAt }: { status: UniverseStatus | null; startedAt: number | null }) {
  // Hook before any early return — this ticks once a second while a build runs.
  const elapsed = useElapsedMs(startedAt);

  if (status?.stage !== "building") return null;

  const pct = status.total > 0 ? (status.ready / status.total) * 100 : null;

  // Extrapolate from observed throughput. Only offered once enough of the build
  // has completed for the rate to mean anything. Elapsed comes from the shared
  // ticking hook rather than a render-time Date.now(), which would be impure.
  const remainingMs =
    pct != null && pct >= 5 && elapsed > 3000
      ? Math.round((elapsed / pct) * (100 - pct))
      : null;

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

export default function ScreenerPage() {
  // The command deck (screen-deck.tsx) renders the universe navigation; these
  // derive the subtitle's numbers from the same registry source, so copy and
  // navigation can never disagree.
  const classes = listAssetClasses();
  const baseCount = listBaseAssetClasses().length;
  const variantNames = classes.filter((c) => c.marketVariantOf).map((c) => universeLabel(c.id));

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
  /**
   * Soft preferences: metric → weight. Deliberately separate from `draft` because
   * they are not filters — they never remove a row, so they don't belong to the
   * applied/unapplied filter bookkeeping and they take effect on the next run
   * like a sort does.
   */
  const [preferences, setPreferences] = useState<Record<string, number>>({});
  const [sortKey, setSortKey] = useState("rankScore");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const [rows, setRows] = useState<RankedCandidate[] | null>(null);
  /** Present only when a screen matched nothing — see the Nothing-matched panel. */
  const [diagnostics, setDiagnostics] = useState<FilterDiagnostic[] | null>(null);
  /**
   * Per-metric universe distributions, for the histograms under each filter.
   * Fetched once per asset class rather than per screen: they describe the
   * universe, which changes every twelve hours, not the query.
   */
  const [distributions, setDistributions] = useState<Record<string, MetricDistribution> | null>(null);
  /**
   * Entries/exits for the saved screen just loaded, against the snapshot from its
   * previous run. Set once, when a screen is opened — a standing definition
   * reports what changed, and that question only has an answer at load time.
   */
  const [screenDiff, setScreenDiff] = useState<{
    name: string;
    since: string | null;
    entered: string[];
    exited: string[];
  } | null>(null);
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
  /** Symbols already held, so the screen can mark what you own. */
  const [owned, setOwned] = useState<Set<string>>(new Set());
  /**
   * Symbols staged for a batch action. Deliberately not persisted: a staging set
   * is a scratchpad for the next thirty seconds of work, and a stale one silently
   * carried across sessions would be worse than none.
   */
  const [staged, setStaged] = useState<Set<string>>(new Set());

  const [summary, setSummary] = useState<{ text: string; model: string } | null>(null);
  const [summarizing, setSummarizing] = useState(false);

  /** An assistant-handed NL screen still being parsed in the background (the
   * query text, shown in the banner), and the one that failed to parse. */
  const [nlPending, setNlPending] = useState<string | null>(null);
  const [nlFailed, setNlFailed] = useState<string | null>(null);

  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const def = getAssetClass(assetClass);

  /* ---------------------------------------------------------------------- */
  /* Running a screen                                                        */
  /* ---------------------------------------------------------------------- */

  interface RunOptions {
    assetClass: AssetClassId;
    templateId: string | null;
    draft: Draft;
    preferences: Record<string, number>;
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
          preferences: opts.preferences,
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
      setDiagnostics(json.diagnostics ?? null);
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
      setError(err instanceof Error ? err.message : "The screen failed to run — run it again.");
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

  const loadDistributions = useCallback(async (forClass: AssetClassId) => {
    try {
      const res = await fetch(`/api/screener?class=${forClass}&stats=1`);
      const json = (await res.json()) as { distributions?: Record<string, MetricDistribution> };
      setDistributions(json.distributions ?? null);
    } catch {
      // Histograms are an aid, not a dependency — the filters work without them.
    }
  }, []);

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
    // Preferences name metrics, and metric keys are class-specific.
    setPreferences({});
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
      preferences: {},
      sortKey: next.defaultSort.key,
      sortDir: next.defaultSort.dir,
      offset: 0,
    });
    void loadSaved(id);
    void loadDistributions(id);
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
      preferences: {},
      sortKey: getAssetClass("equity").defaultSort.key,
      sortDir: getAssetClass("equity").defaultSort.dir,
      offset: 0,
    };
    // An unparsed natural-language screen riding on the handoff — parsed in
    // the BACKGROUND after the default screen is already loading, so the
    // user looks at real data while the model call runs instead of at the
    // assistant's spinner (parsing in the assistant's own turn made every
    // screener request two sequential model calls).
    let nlQuery: string | null = null;
    try {
      const pending = sessionStorage.getItem(PENDING_SCREEN_KEY);
      if (pending) {
        sessionStorage.removeItem(PENDING_SCREEN_KEY);
        const handoff = JSON.parse(pending) as PendingScreenHandoff;
        if (isAssetClassId(handoff.assetClass)) {
          const handoffClass = getAssetClass(handoff.assetClass);
          initial = {
            assetClass: handoff.assetClass,
            templateId: handoff.templateId ?? null,
            draft: handoff.filters ? fromFilterValues(handoff.assetClass, handoff.filters) : emptyDraft(),
            preferences: {},
            sortKey: handoffClass.defaultSort.key,
            sortDir: handoffClass.defaultSort.dir,
            offset: 0,
          };
          if (handoff.nlQuery?.trim()) nlQuery = handoff.nlQuery.trim();
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

    if (nlQuery) {
      const q = nlQuery;
      setNlPending(q);
      void (async () => {
        try {
          const res = await fetch("/api/screener/nl", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ prompt: q, assetClass: initial.assetClass }),
          });
          const json = (await res.json()) as { filters?: FilterValues; templateId?: string | null; error?: string };
          if (!res.ok || !json.filters) throw new Error(json.error ?? "parse failed");
          const parsedDraft = fromFilterValues(initial.assetClass, json.filters);
          setDraft(parsedDraft);
          setTemplateId(json.templateId ?? null);
          void run({ ...initial, draft: parsedDraft, templateId: json.templateId ?? null });
          setNlPending(null);
        } catch {
          // The unfiltered screen is already on screen and correct — say the
          // criteria didn't apply rather than pretending they did.
          setNlPending(null);
          setNlFailed(q);
        }
      })();
    }
    void loadSaved(initial.assetClass);
    void loadDistributions(initial.assetClass);

    void (async () => {
      try {
        const res = await fetch("/api/watchlist");
        const json = (await res.json()) as { items?: { symbol: string }[] };
        setWatchlisted(new Set((json.items ?? []).map((i) => i.symbol)));
      } catch {
        // Non-fatal — the screener works fine without watchlist state.
      }
    })();

    void (async () => {
      try {
        const res = await fetch("/api/portfolio");
        const json = (await res.json()) as { holdings?: { symbol: string }[] };
        setOwned(new Set((json.holdings ?? []).map((h) => h.symbol)));
      } catch {
        // Non-fatal — "held" badges are an aid, not a dependency.
      }
    })();

    return () => {
      if (pollRef.current) clearTimeout(pollRef.current);
    };
  }, [run, loadSaved, loadDistributions]);
  /* eslint-enable react-hooks/set-state-in-effect */

  /* ---------------------------------------------------------------------- */
  /* Handlers                                                                */
  /* ---------------------------------------------------------------------- */

  const rerun = (next: Partial<{ templateId: string | null; draft: Draft; preferences: Record<string, number>; sortKey: string; sortDir: "asc" | "desc"; offset: number }>) => {
    const merged = {
      assetClass,
      templateId: next.templateId !== undefined ? next.templateId : templateId,
      draft: next.draft ?? draft,
      preferences: next.preferences ?? preferences,
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
  /**
   * Preferences are weighted 2 when on: enough to visibly tilt a ranking whose
   * default factors carry weights of 1-3, without swamping the class's own model.
   * A single toggle rather than a weight slider — the value is in expressing
   * "care about this at all", and a slider invites fiddling with a number nobody
   * can calibrate by eye.
   */
  const togglePreference = (key: string) => {
    const next = { ...preferences };
    if (next[key]) delete next[key];
    else next[key] = 2;
    setPreferences(next);
    rerun({ preferences: next });
  };

  const toggleSort = (key: string) => {
    const preferred: "asc" | "desc" = getMetric(assetClass, key)?.better === "lower" ? "asc" : "desc";
    const dir: "asc" | "desc" =
      sortKey === key ? (sortDir === "desc" ? "asc" : "desc") : preferred;
    setSortKey(key);
    setSortDir(dir);
    rerun({ sortKey: key, sortDir: dir });
  };

  /**
   * Apply a relaxation the solver suggested. Converts back out of the metric's
   * storage units into the draft's display units (AUM and market cap are entered
   * in billions), so the number that lands in the input is the number the user
   * would have typed.
   */
  const relaxFilter = (key: string, bound: "min" | "max", value: number) => {
    const metric = getMetric(assetClass, key);
    const existing = draft[key];
    const current = existing?.kind === "range" ? existing : { kind: "range" as const, min: "", max: "" };
    const framed = (current.frame ?? "absolute") !== "absolute";
    const scale = framed ? 1 : (metric?.scale ?? 1);
    // Round outward so the suggestion can't fail on a floating-point hair.
    const shown = value / scale;
    const rounded = bound === "min" ? Math.floor(shown * 100) / 100 : Math.ceil(shown * 100) / 100;

    const next: Draft = {
      ...draft,
      [key]: { ...current, kind: "range", [bound]: String(rounded) } as DraftValue,
    };
    setDraft(next);
    rerun({ draft: next });
  };

  /** Drop one filter from the applied screen and re-run immediately. */
  const removeFilter = (key: string) => {
    const next = { ...draft };
    delete next[key];
    setDraft(next);
    rerun({ draft: next });
  };

  const removePreference = (key: string) => {
    const next = { ...preferences };
    delete next[key];
    setPreferences(next);
    rerun({ preferences: next });
  };

  const clearAll = () => {
    setTemplateId(null);
    setDraft(emptyDraft());
    setPreferences({});
    setSummary(null);
    // Picking a template can change the sort, so clearing one has to put the
    // sort back too — otherwise "Clear all" left the table ordered by a
    // template's column with nothing on screen explaining why.
    setSortKey(def.defaultSort.key);
    setSortDir(def.defaultSort.dir);
    rerun({
      templateId: null,
      draft: emptyDraft(),
      preferences: {},
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
      void loadDistributions(assetClass);
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

  const loadScreen = async (screen: SavedScreen) => {
    // A saved screen's filters were validated against the registry when saved,
    // and are re-validated by the API on the next run — so a filter whose metric
    // has since lost its data provider simply disappears rather than breaking.
    const nextDraft = fromFilterValues(assetClass, screen.filters as never);
    setTemplateId(screen.templateId);
    setDraft(nextDraft);
    setSortKey(screen.sortKey);
    setSortDir(screen.sortDir);
    setSummary(null);
    setScreenDiff(null);
    rerun({
      templateId: screen.templateId,
      draft: nextDraft,
      sortKey: screen.sortKey,
      sortDir: screen.sortDir,
    });

    /*
     * The diff is computed against the *whole* match set, not the visible page,
     * because "entered the screen" is a property of the definition rather than of
     * page one. That's one extra request, on an explicit user action, and it never
     * touches the filtering path.
     */
    try {
      const res = await fetch("/api/screener", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assetClass,
          templateId: screen.templateId,
          filters: toFilterValues(assetClass, nextDraft),
          sortKey: screen.sortKey,
          sortDir: screen.sortDir,
          size: 200,
          offset: 0,
        }),
      });
      const json = (await res.json()) as ScreenerResponse & { error?: string };
      if (!res.ok || json.error) return;
      const now = json.rows.map((r) => r.symbol);

      const previous = new Set(screen.lastSymbols);
      // No baseline yet means this is the first run, not "everything is new" —
      // showing 200 entries on a screen's first open would be noise.
      if (previous.size > 0) {
        const current = new Set(now);
        setScreenDiff({
          name: screen.name,
          since: screen.lastRunAt,
          entered: now.filter((sym) => !previous.has(sym)).slice(0, 24),
          exited: screen.lastSymbols.filter((sym) => !current.has(sym)).slice(0, 24),
        });
      }

      // Re-baseline, so the next open diffs against this run.
      await fetch(`/api/screener/saved?id=${encodeURIComponent(screen.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbols: now }),
      });
      await loadSaved(assetClass);
    } catch {
      // A failed diff must never stop the screen itself from loading.
    }
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
          sourceDetail: `${universeLabel(assetClass)} screen · rank #${row.rank}`,
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

  const toggleStaged = (symbol: string) => {
    setStaged((prev) => {
      const next = new Set(prev);
      if (next.has(symbol)) next.delete(symbol);
      else next.add(symbol);
      return next;
    });
  };

  /**
   * Batch hand-off into the rest of the platform. The screener's job ends at a
   * decision to spend attention, so the useful verbs are the ones that move a set
   * of names *out* of here: into a comparison, onto the watchlist, or into the
   * research queue.
   */
  const compareStaged = () => {
    const symbols = [...staged];
    if (symbols.length < 2) return;
    window.location.href = `/compare?symbols=${encodeURIComponent(symbols.join(","))}`;
  };

  const watchStaged = async () => {
    const rowsBySymbol = new Map((rows ?? []).map((r) => [r.symbol, r]));
    const targets = [...staged].filter((sym) => !watchlisted.has(sym));
    setWatchlisted((prev) => new Set([...prev, ...targets]));
    await Promise.all(
      targets.map((sym) =>
        fetch("/api/watchlist", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ symbol: sym, name: rowsBySymbol.get(sym)?.name ?? sym }),
        }).catch(() => null),
      ),
    );
    setStaged(new Set());
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

  /**
   * The deck's AI filter builder: plain English → validated filters, via the
   * same /api/screener/nl parser the App Assistant's handoff uses in the mount
   * effect above (kept separate there because the mount path must run against
   * its own `initial` snapshot before this state exists). Anything the model
   * invents is discarded by parseFilters server-side; failure keeps the
   * current screen on screen and says the criteria did NOT apply.
   */
  const submitNl = (q: string) => {
    setNlFailed(null);
    setNlPending(q);
    void (async () => {
      try {
        const res = await fetch("/api/screener/nl", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt: q, assetClass }),
        });
        const json = (await res.json()) as { filters?: FilterValues; templateId?: string | null; error?: string };
        if (!res.ok || !json.filters) throw new Error(json.error ?? "parse failed");
        const parsedDraft = fromFilterValues(assetClass, json.filters);
        setDraft(parsedDraft);
        setTemplateId(json.templateId ?? null);
        setSummary(null);
        rerun({ draft: parsedDraft, templateId: json.templateId ?? null });
        setNlPending(null);
      } catch {
        setNlPending(null);
        setNlFailed(q);
      }
    })();
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
          : diagnostics && diagnostics.length > 0
            ? // The WhyEmpty panel above is naming the binding filter and offering
              // the threshold that fixes it; the table stays quiet.
              { kind: "diagnosed" }
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
    <PageShell py="py-8" gap="gap-5" width="wide">
      <Reveal index={0} className="flex flex-col gap-3">
        <PageHeader
          title="Universal Screener"
          description={`${classes.length} screening universes across ${baseCount} asset classes${variantNames.length > 0 ? ` (plus ${variantNames.join(" and ")})` : ""} — every result ranked, with an explanation of why it matched.`}
        />

        {/* The command deck: asset class → market → strategy → describe-it.
            Asset class and market are separate steps because they are separate
            concepts — the Market row lists this class's screening universes
            (base + marketVariantOf definitions), so India appears as a market
            of Equities, never as a peer asset class. All registry-derived. */}
        <ScreenDeck
          universe={assetClass}
          onSelectUniverse={selectAssetClass}
          templateId={templateId}
          onApplyTemplate={applyTemplate}
          onClearAll={clearAll}
          hasActiveScreen={Boolean(templateId) || draftCount > 0}
          status={status}
          loading={loading}
          onRefresh={() => void refresh()}
          onNlSubmit={submitNl}
          nlBusy={nlPending != null}
        />

        <p className="text-xs text-muted">{def.description}</p>
        <UniverseBar status={status} startedAt={buildStartedAt} />
      </Reveal>

      <div className="grid gap-5 lg:grid-cols-[350px_minmax(0,1fr)]">
        {/* Filters — entirely registry-driven. */}
        <Reveal index={1} as="aside" className="flex flex-col gap-3">
          <Button variant="primary" onClick={() => rerun({})} disabled={loading} className="w-full">
            {loading ? "Running…" : pendingFilterChanges ? "Run screen — changes pending" : "Run screen"}
          </Button>

          {pendingFilterChanges && !loading ? (
            <p className="text-xs text-warning" role="status">
              Filter changes aren&apos;t applied yet — run the screen to update the results.
            </p>
          ) : null}

          <FilterPanel
            assetClass={assetClass}
            draft={draft}
            onChange={changeFilter}
            preferences={preferences}
            onTogglePreference={togglePreference}
            distributions={distributions}
          />

          <SavedScreens
            screens={saved}
            draft={draft}
            saving={saving}
            onSave={save}
            onLoad={loadScreen}
            onDelete={removeScreen}
          />
        </Reveal>

        {/* Ranked results + explanations. */}
        <Reveal index={2} as="section" className="flex min-w-0 flex-col gap-3">
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
                {summarizing ? "Writing the explanation…" : "Explain this ranking"}
              </Button>
            </div>
          </div>

          {error ? (
            <Card className="border-rose-500/40 light:border-rose-700/40 p-4 text-sm text-rose-500 light:text-rose-700">{error}</Card>
          ) : null}

          {/* Assistant-handed NL screen being parsed in the background — the
              user is already looking at real (unfiltered) results, so this is
              a status line, not a blocker; failure says the criteria did NOT
              apply rather than letting the unfiltered list impersonate them. */}
          {nlPending ? (
            <Card className="flex items-center gap-2 border-brand/40 p-3 text-sm text-muted">
              <span className="h-2 w-2 animate-pulse rounded-full bg-brand" aria-hidden />
              Applying your criteria — “{nlPending}”…
            </Card>
          ) : null}
          {nlFailed ? (
            <Card className="flex items-center justify-between gap-2 border-amber-500/40 p-3 text-sm text-muted">
              <span>Couldn’t turn “{nlFailed}” into filters — showing the unfiltered screen instead.</span>
              <button onClick={() => setNlFailed(null)} className="shrink-0 text-xs text-muted hover:text-foreground" aria-label="Dismiss">
                ✕
              </button>
            </Card>
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

          {screenDiff ? (
            <ScreenDiff
              screenName={screenDiff.name}
              since={screenDiff.since}
              entered={screenDiff.entered}
              exited={screenDiff.exited}
              onDismiss={() => setScreenDiff(null)}
            />
          ) : null}

          {staged.size > 0 ? (
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-brand/30 bg-brand/5 px-3 py-2">
              <span className="text-xs font-medium">
                {staged.size} staged
              </span>
              <button
                type="button"
                onClick={compareStaged}
                disabled={staged.size < 2}
                title={staged.size < 2 ? "Stage at least two to compare" : "Compare the staged assets"}
                className="rounded-md border border-border bg-surface px-2 py-1 text-xs transition-colors hover:border-brand hover:text-brand disabled:opacity-40"
              >
                Compare
              </button>
              <button
                type="button"
                onClick={() => void watchStaged()}
                className="rounded-md border border-border bg-surface px-2 py-1 text-xs transition-colors hover:border-brand hover:text-brand"
              >
                Add to watchlist
              </button>
              <button
                type="button"
                onClick={() => setStaged(new Set())}
                className="ml-auto text-xs text-muted underline underline-offset-2 hover:text-fg"
              >
                Clear
              </button>
              <span className="w-full text-[10px] text-muted/70">
                Keyboard: <kbd>j</kbd>/<kbd>k</kbd> move · <kbd>space</kbd> stage ·{" "}
                <kbd>x</kbd> expand · <kbd>w</kbd> watch · <kbd>enter</kbd> research
              </span>
            </div>
          ) : null}

          {/* The applied screen, in one readable line. */}
          <FilterChips
            assetClass={assetClass}
            filters={toFilterValues(assetClass, applied.draft)}
            preferences={preferences}
            onRemoveFilter={removeFilter}
            onRemovePreference={removePreference}
          />

          {/* Earnings season for the India class — NSE-scheduled dates and
              fresh results filings across the universe (renders nothing when
              both lists are empty; never shown for other classes). */}
          {assetClass === "indiaEquity" && <IndiaResultsStrip />}

          {/* Never while the universe is still building: diagnostics computed
              against a half-built universe blame the user's filters ("Market
              Cap alone admits 0") for what is actually missing data. The
              table's own "building" empty state covers that case. */}
          {rows != null && rows.length === 0 && diagnostics && diagnostics.length > 0 && status?.stage !== "building" ? (
            <WhyEmpty
              diagnostics={diagnostics}
              metricFor={(key) => getMetric(assetClass, key)}
              onRelax={relaxFilter}
              onClearAll={clearAll}
            />
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
                owned={owned}
                staged={staged}
                onToggleStaged={toggleStaged}
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
