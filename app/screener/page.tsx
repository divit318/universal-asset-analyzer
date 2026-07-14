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
import { PageShell, PageHeader, Button, Card, Badge } from "@/app/_components/ui";
import { downloadBlob } from "@/lib/download";
import { getAssetClass, listAssetClasses } from "@/lib/assets/registry";
import type { AssetClassId } from "@/lib/assets/types";
import type { RankedCandidate, ScreenerResponse, UniverseStatus } from "@/lib/screener/types";
import type { SavedScreen } from "@/lib/db";
import { FilterPanel } from "./_components/filter-panel";
import { ResultsTable } from "./_components/results-table";
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

/** The universe is still warming — show progress rather than an empty table. */
function UniverseBar({
  status,
  loading,
  onRefresh,
}: {
  status: UniverseStatus | null;
  loading: boolean;
  onRefresh: () => void;
}) {
  if (!status) return null;

  const building = status.stage === "building";
  const pct = status.total > 0 ? Math.round((status.ready / status.total) * 100) : 0;

  return (
    <div className="flex flex-wrap items-center gap-3 text-xs text-muted">
      {status.stage === "error" ? (
        <span className="text-rose-500">Universe failed to build: {status.error}</span>
      ) : building ? (
        <span>
          Building universe… {status.ready}/{status.total} ({pct}%)
        </span>
      ) : (
        <span>
          {status.ready.toLocaleString()} assets ready
          {status.builtAt ? ` · updated ${new Date(status.builtAt).toLocaleTimeString()}` : ""}
        </span>
      )}
      <button
        type="button"
        onClick={onRefresh}
        disabled={loading || building}
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
  const [sortKey, setSortKey] = useState("rankScore");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const [rows, setRows] = useState<RankedCandidate[] | null>(null);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [status, setStatus] = useState<UniverseStatus | null>(null);
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

  const run = useCallback(async (opts: RunOptions) => {
    lastRunRef.current = opts;
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
      if (!res.ok || json.error) throw new Error(json.error ?? "Screen failed");

      setRows(json.rows);
      setTotal(json.total);
      setOffset(json.offset);
      setStatus(json.status);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setRows([]);
    } finally {
      setLoading(false);
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
    setSortKey(next.defaultSort.key);
    setSortDir(next.defaultSort.dir);
    setSummary(null);
    setRows(null);
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
    void run({
      assetClass: "equity",
      templateId: null,
      draft: emptyDraft(),
      sortKey: getAssetClass("equity").defaultSort.key,
      sortDir: getAssetClass("equity").defaultSort.dir,
      offset: 0,
    });
    void loadSaved("equity");

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

  const toggleSort = (key: string) => {
    const dir: "asc" | "desc" = sortKey === key && sortDir === "desc" ? "asc" : "desc";
    setSortKey(key);
    setSortDir(dir);
    rerun({ sortKey: key, sortDir: dir });
  };

  const clearAll = () => {
    setTemplateId(null);
    setDraft(emptyDraft());
    setSummary(null);
    rerun({ templateId: null, draft: emptyDraft() });
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
        body: JSON.stringify({ symbol: row.symbol, name: row.name }),
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

  const activeCount = countActive(draft);

  return (
    <PageShell py="py-10">
      <div className="flex flex-col gap-3">
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
        <UniverseBar status={status} loading={loading} onRefresh={refresh} />
      </div>

      {/* 2. Templates. */}
      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium">Templates</h2>
          {templateId || activeCount > 0 ? (
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
      </section>

      <div className="grid gap-6 lg:grid-cols-[300px_1fr]">
        {/* 3. Filters — entirely registry-driven. */}
        <aside className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium">Filters</h2>
            <Button onClick={() => rerun({})} disabled={loading} className="px-3 py-1.5 text-xs">
              {loading ? "Running…" : "Run screen"}
            </Button>
          </div>

          <FilterPanel assetClass={assetClass} draft={draft} onChange={changeFilter} />

          <SavedScreens
            screens={saved}
            draft={draft}
            saving={saving}
            onSave={save}
            onLoad={loadScreen}
            onDelete={removeScreen}
          />
        </aside>

        {/* 4-5. Ranked results + explanations. */}
        <section className="flex min-w-0 flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">
                {total.toLocaleString()} {def.noun}
              </span>
              {activeCount > 0 ? (
                <Badge variant="neutral">
                  {activeCount} filter{activeCount === 1 ? "" : "s"}
                </Badge>
              ) : null}
              {templateId ? (
                <Badge variant="brand">{def.templates.find((t) => t.id === templateId)?.name}</Badge>
              ) : null}
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
        </section>
      </div>
    </PageShell>
  );
}
