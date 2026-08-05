"use client";

/**
 * The Watchlist — a ranked, sortable list of the names you are tracking, the
 * level you are waiting for on each, and whether each one belongs in your book.
 *
 * ## Vocabulary
 *
 * Two columns were renamed because their old labels did not describe what they
 * computed:
 *
 * - **"Target" → "My target".** The number is the user's own, typed into the
 *   editor on this page and stored in `watchlist.target_price`. Research shows
 *   the *analyst consensus* target and calls it "Mean target", so an unqualified
 *   "Target" here read as though this page were also showing consensus.
 *
 * - **"To target" → "Upside".** The old column computed
 *   `(price − target) / target` and coloured negative values green — the opposite
 *   sign to every other upside figure in UAA, normalized by the wrong leg, so a
 *   name trading 23% below the level you were waiting for reported a green
 *   "−23.08%". Upside is now `(target − price) / price`, the same formula the
 *   analyst card, `/dcf`, `/compare` and `/ic-report` use, with positive green.
 *   All of the arithmetic lives in `lib/watchlist-metrics.ts`.
 *
 * ## Ordering
 *
 * Filtering happens here; ordering is the table's job, because "which of my 57
 * names is furthest from its target" is a sort, not a preset. The quick filters
 * are the presets that a sort genuinely cannot express — "only the ones firing an
 * alert", "only the ones I own" — and the chosen sort persists across visits.
 */

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { downloadBlob } from "@/lib/download";
import type { IdeaStage, Quote, TargetDirection, WatchlistGroup, WatchlistItem } from "@/lib/types";
import type { WatchlistDigest } from "@/lib/ai-watchlist";
import { AI_RECOVERY_HINT } from "@/lib/ai/availability";
import type { PortfolioFitAnalysis } from "@/lib/ios/types";
import type { FitEnrichment } from "@/lib/watchlist-fit";
import { formatCurrency, formatDate, formatPercent, toneClass } from "@/lib/format";
import {
  formatAge,
  isTargetReached,
  isUsablePrice,
  percentFrom52WeekHigh,
  resolveTargetDirection,
  upsidePercent,
} from "@/lib/watchlist-metrics";
import { formatAsOf } from "@/lib/live-quotes";
import { detectMarket, type MarketRegion } from "@/lib/market";
import { IDEA_STAGES, STAGE_LABEL } from "@/lib/idea-stage";
import { ConfirmDialog } from "@/app/_components/dialog";
import { useToast } from "@/app/_components/toast";
import { useIOSSafe } from "@/lib/ios-context";
import { WatchlistAlerts } from "./_components/watchlist-alerts";
import { WatchlistDigestPanel } from "./_components/digest-panel";
import { TargetModal, type TargetPatch } from "./_components/target-modal";
import { NotesModal } from "./_components/notes-modal";
import { WatchlistRowDetail, type FiringAlert } from "./_components/row-detail";
import { StageBadge } from "./_components/stage-badge";
import { ListSwitcher } from "./_components/list-switcher";
import { useLiveQuotes } from "./_components/use-live-quotes";
import { usePersistedState } from "./_components/use-view-state";
import { AddToPortfolioModal } from "@/app/_components/portfolio/add-to-portfolio-modal";
import { ArrivalHighlight, useArrivalTarget } from "@/app/_components/arrival-highlight";
import {
  PageShell,
  Skeleton,
  DataTable,
  DataTableAction,
  ScoreChip,
  type DataTableColumn,
  type Density,
  type SortDir,
} from "@/app/_components/ui";
import { Reveal } from "@/app/_components/reveal";
import { LoadingMark } from "@/app/_components/loading-mark";

/* -------------------------------------------------------------------------- */
/* Row model                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * A watchlist row with everything derived about it computed exactly once.
 *
 * The page used to call `checkAlerts` four separate times per row per render (in
 * the symbol cell, in `rowTone`, in the detail panel, and again in the header
 * count) and re-derived the upside inside both `sortValue` and `render`. Deriving
 * once and passing the result down is what lets the columns be memoized, which is
 * what makes the table's own sort memo effective — with a fresh `columns` array
 * on every render it was re-sorting on every keystroke.
 */
interface Row {
  item: WatchlistRow;
  quote: Quote | undefined;
  currency: string;
  price: number | null;
  changePercent: number | null;
  /** Direction resolved from the stored value, or from the price for legacy rows. */
  direction: TargetDirection;
  upside: number | null;
  fromHigh: number | null;
  fit: PortfolioFitAnalysis | undefined;
  owned: boolean;
  alerts: FiringAlert[];
  /** Analyst consensus — the street's view, never conflated with `item.targetPrice`. */
  consensus: { mean: number | null; high: number | null; low: number | null; opinions: number | null };
  /** Upside to the consensus target, for comparison with the user's own. */
  consensusUpside: number | null;
  /** Today's move minus the active list's benchmark move. Null without a benchmark. */
  vsBenchmark: number | null;
  /** Price direction on the most recent live refresh, for the tick flash. */
  tick: "up" | "down" | undefined;
}

/** A watchlist item as the API returns it — with the revision count joined on. */
type WatchlistRow = WatchlistItem & { targetRevisionCount?: number };

function buildAlerts(
  item: WatchlistItem,
  quote: Quote | undefined,
  direction: TargetDirection,
): FiringAlert[] {
  if (!quote || !isUsablePrice(quote.price)) return [];
  const alerts: FiringAlert[] = [];
  const currency = quote.currency;

  if (isTargetReached(quote.price, item.targetPrice, direction)) {
    alerts.push({
      type: "target_reached",
      message: `Reached your ${formatCurrency(item.targetPrice, currency)} target — now ${formatCurrency(quote.price, currency)}.`,
    });
  }

  // The threshold is a magnitude, so the message has to re-apply the sign. It
  // used to print `formatPercent(Math.abs(changePercent))`, rendering a decline
  // as "Down +8.45% today".
  if (item.alertPctDrop != null && quote.changePercent <= -Math.abs(item.alertPctDrop)) {
    alerts.push({
      type: "significant_drop",
      message: `Down ${formatPercent(quote.changePercent)} today, past your ${formatPercent(-Math.abs(item.alertPctDrop))} drop alert.`,
    });
  }
  return alerts;
}

/* -------------------------------------------------------------------------- */
/* View state                                                                  */
/* -------------------------------------------------------------------------- */

const QUICK_FILTERS = ["all", "alerts", "owned", "no-target", "thesis"] as const;
type QuickFilter = (typeof QUICK_FILTERS)[number];

const QUICK_FILTER_LABEL: Record<QuickFilter, string> = {
  all: "All",
  alerts: "Alerts firing",
  owned: "Owned",
  "no-target": "No target set",
  thesis: "Has thesis",
};

const SORT_KEYS = [
  "symbol",
  "price",
  "change",
  "vsBenchmark",
  "target",
  "upside",
  "consensus",
  "consensusUpside",
  "fromHigh",
  "fit",
  "stage",
  "sector",
  "added",
  "notes",
] as const;

const isSortKey = (v: unknown): v is string => typeof v === "string" && (SORT_KEYS as readonly string[]).includes(v);
const isSortDir = (v: unknown): v is SortDir => v === "asc" || v === "desc";
const isDensity = (v: unknown): v is Density => v === "compact" || v === "comfortable";
const isQuickFilter = (v: unknown): v is QuickFilter =>
  typeof v === "string" && (QUICK_FILTERS as readonly string[]).includes(v);

/** Rows beyond this get the grid its own scrollport, which is what makes the
 *  header genuinely sticky. Below it, the page scroll is the nicer behaviour. */
const STICKY_AFTER_ROWS = 18;

/**
 * Freshness of the live prices.
 *
 * "Live" is a claim, and a table of prices with no visible "as of" cannot back it
 * up — the difference between a 20-second-old price and a 40-minute-old one is
 * the difference between acting and not. The paused state is stated explicitly
 * rather than hidden, because polling stops on purpose (hidden tab, closed
 * market) and a user who sees a frozen number deserves to know why.
 */
function LiveIndicator({
  status,
  lastUpdatedAt,
  onRefresh,
}: {
  status: "idle" | "polling" | "paused" | "error";
  lastUpdatedAt: number | null;
  onRefresh: () => void;
}) {
  // Re-render on a timer so "20s ago" keeps counting up without a data change.
  const [, setBeat] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setBeat((n) => n + 1), 10_000);
    return () => clearInterval(t);
  }, []);

  const tone =
    status === "error" ? "text-warning" : status === "paused" ? "text-muted/60" : "text-positive";
  const dot =
    status === "error" ? "bg-warning" : status === "paused" ? "bg-muted/50" : "bg-positive";
  const label =
    status === "error"
      ? "retrying"
      : status === "paused"
        ? "paused"
        : status === "idle"
          ? "connecting"
          : "live";

  return (
    <button
      type="button"
      onClick={onRefresh}
      title={
        status === "paused"
          ? "Auto-refresh is paused — the tab is in the background, or every tracked market is closed. Click to refresh now."
          : "Prices refresh automatically. Click to refresh now."
      }
      className="inline-flex items-center gap-1.5 rounded-control border border-border px-2 py-0.5 text-[11px] transition-colors hover:bg-surface-2"
    >
      <span aria-hidden="true" className={`inline-block h-1.5 w-1.5 rounded-full ${dot}`} />
      <span className={tone}>{label}</span>
      <span className="font-mono tabular-nums text-muted/70">{formatAsOf(lastUpdatedAt)}</span>
    </button>
  );
}

export default function WatchlistPage() {
  return (
    <Suspense fallback={null}>
      <WatchlistPageInner />
    </Suspense>
  );
}

function WatchlistPageInner() {
  const [items, setItems] = useState<WatchlistRow[]>([]);
  const [groups, setGroups] = useState<WatchlistGroup[]>([]);
  /** null until the first load resolves, then always a real list id. */
  const [activeGroupId, setActiveGroupId] = usePersistedState<number | null>(
    "uaa.watchlist.activeGroup",
    null,
    (v): v is number | null => v === null || (typeof v === "number" && Number.isInteger(v)),
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exportErr, setExportErr] = useState<string | null>(null);
  const [editingTarget, setEditingTarget] = useState<WatchlistItem | null>(null);
  const [editingNotes, setEditingNotes] = useState<WatchlistItem | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<WatchlistItem | null>(null);
  const [buyingItem, setBuyingItem] = useState<WatchlistItem | null>(null);
  const [ownedSymbols, setOwnedSymbols] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState("");
  const [digest, setDigest] = useState<WatchlistDigest | null>(null);
  const [digestLoading, setDigestLoading] = useState(false);
  const [digestError, setDigestError] = useState<string | null>(null);
  const digestInFlight = useRef(false);
  const searchRef = useRef<HTMLInputElement>(null);
  // Full research inputs (composite scores, sector, beta, geography) per symbol,
  // fetched on demand so every watchlist stock — including newly-added ones —
  // gets an accurate, differentiated fit score instead of a data-poor neutral.
  const [fitData, setFitData] = useState<Map<string, FitEnrichment>>(new Map());
  const toast = useToast();
  const ios = useIOSSafe();
  const highlightTarget = useArrivalTarget();

  const [sortKey, setSortKey] = usePersistedState<string>("uaa.watchlist.sortKey", "", isSortKey);
  const [sortDir, setSortDir] = usePersistedState<SortDir>("uaa.watchlist.sortDir", "desc", isSortDir);
  const [density, setDensity] = usePersistedState<Density>("uaa.watchlist.density", "compact", isDensity);
  const [quickFilter, setQuickFilter] = usePersistedState<QuickFilter>(
    "uaa.watchlist.quickFilter",
    "all",
    isQuickFilter,
  );

  useEffect(() => {
    document.title = "Watchlist · UAA";
    return () => { document.title = "Universal Asset Analyzer"; };
  }, []);

  const loadOwned = useCallback(async () => {
    try {
      const res = await fetch("/api/portfolio");
      const json = await res.json();
      if (!res.ok) return;
      const holdings = (json.holdings ?? []) as { symbol: string | null }[];
      setOwnedSymbols(new Set(holdings.filter((h) => h.symbol).map((h) => h.symbol!.toUpperCase())));
    } catch {
      /* owned-status is an enhancement — degrade gracefully */
    }
  }, []);

  /**
   * Load the active list's membership and metadata. Prices are NOT fetched here
   * any more — `useLiveQuotes` owns them, so a list switch does not re-request
   * quotes the poller already holds.
   */
  const load = useCallback(async () => {
    try {
      const scope = activeGroupId != null ? `?group=${activeGroupId}` : "";
      const res = await fetch(`/api/watchlist${scope}`);
      /* Parsed defensively. A truncated or empty body — a dev-server recompile, a
         dropped connection, a proxy error page — otherwise surfaces the browser's
         own "Failed to execute 'json' on 'Response'", which tells the user
         nothing about what to do. */
      const json = await res
        .json()
        .catch(() => {
          throw new Error(
            res.ok
              ? "The server returned an empty or malformed response. Retry in a moment."
              : `The server returned ${res.status}. Retry in a moment.`,
          );
        });
      if (!res.ok) throw new Error(json.error ?? "Failed to load watchlist");

      const nextGroups = (json.groups ?? []) as WatchlistGroup[];
      setGroups(nextGroups);
      setError(null);

      /* Reconcile the persisted selection against reality: a list deleted in
         another tab, or a first visit with nothing stored, must resolve to a real
         id rather than silently showing the union of everything. */
      const stillExists = activeGroupId != null && nextGroups.some((g) => g.id === activeGroupId);
      if (!stillExists && nextGroups.length > 0) {
        setActiveGroupId(nextGroups[0].id);
        return; // the id change re-runs this effect with the right scope
      }

      setItems(json.items as WatchlistRow[]);
      void loadOwned();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadOwned, activeGroupId]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  /* Focus the filter with "/" and clear it with Escape — the two keystrokes a
     terminal user reaches for without thinking on a list this long. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement;
      const typing = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement;
      if (e.key === "/" && !typing && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (e.key === "Escape" && el === searchRef.current) {
        setFilter("");
        searchRef.current?.blur();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const symbolsKey = items.map((i) => i.symbol).join(",");

  const activeGroup = groups.find((g) => g.id === activeGroupId) ?? null;
  const benchmarkSymbol = activeGroup?.benchmark ?? null;

  /* ---------------------------------------------------------------------- */
  /* Live prices                                                            */
  /* ---------------------------------------------------------------------- */

  /**
   * The benchmark rides along in the same batch request as the holdings, so a
   * "vs SPY" column costs zero additional round-trips.
   */
  const liveSymbols = useMemo(() => {
    const set = new Set(items.map((i) => i.symbol.toUpperCase()));
    if (benchmarkSymbol) set.add(benchmarkSymbol.toUpperCase());
    return [...set];
  }, [symbolsKey, benchmarkSymbol]); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * Listing regions drive the poll cadence: a US-only list stops being polled
   * every 30s once New York closes, but a list holding an Indian name or crypto
   * stays live. Derived from the quotes themselves, so it needs no extra data.
   */
  const [quoteRegions, setQuoteRegions] = useState<MarketRegion[]>(["US"]);

  const {
    quotes,
    lastUpdatedAt,
    status: liveStatus,
    error: liveError,
    moved,
    refreshNow,
  } = useLiveQuotes(liveSymbols, quoteRegions, {
    /* Gated on HOLDINGS, not on `liveSymbols`. The benchmark is known from the
       groups payload one render before the membership arrives, so keying off
       `liveSymbols` fired an immediate request for the benchmark alone that was
       then superseded — one wasted round-trip on every page load. */
    enabled: !loading && items.length > 0,
    onQuotes: useCallback((next: Record<string, Quote>) => {
      const regions = new Set<MarketRegion>();
      for (const q of Object.values(next)) {
        regions.add(
          detectMarket({ symbol: q.symbol, currency: q.currency, exchange: q.exchange, assetType: q.assetType }),
        );
      }
      setQuoteRegions(regions.size > 0 ? [...regions] : ["US"]);
    }, []),
  });

  /**
   * Non-fatal price problems, DERIVED rather than stored.
   *
   * Both cases are pure functions of data already in hand — the transport error,
   * and which symbols the provider returned nothing for (an ADR, a delisted
   * ticker). Holding them in state meant an effect that mirrored one piece of
   * state into another, which is both redundant and a render-cycle write.
   */
  const quoteError = useMemo(() => {
    if (liveError) return `Live prices unavailable — ${liveError}`;
    if (lastUpdatedAt == null) return null; // nothing fetched yet; not a gap
    const missing = items.filter((i) => !quotes[i.symbol]).map((i) => i.symbol);
    // All missing means the whole request failed, which `liveError` already
    // covers; a strict subset is the genuinely interesting case.
    if (missing.length === 0 || missing.length === items.length) return null;
    const shown = missing.slice(0, 4).join(", ");
    return `No live price for ${shown}${missing.length > 4 ? ` and ${missing.length - 4} more` : ""}.`;
  }, [liveError, lastUpdatedAt, items, quotes]);

  const benchmarkQuote = benchmarkSymbol ? quotes[benchmarkSymbol.toUpperCase()] : undefined;
  const benchmarkChange =
    benchmarkQuote && Number.isFinite(benchmarkQuote.changePercent) ? benchmarkQuote.changePercent : null;

  const fetchDigest = useCallback(() => {
    // One run at a time. Opt-in generation puts a button in the user's hand,
    // so a double-click is now the ordinary way to fire this twice. A ref, not
    // the `digestLoading` state, because this callback's closure would capture
    // a stale value of the latter.
    if (digestInFlight.current) return;
    digestInFlight.current = true;
    setDigestLoading(true);
    setDigestError(null);
    const portfolioContext = ios?.profile.hasPortfolio
      ? {
          objective: ios.profile.objective,
          holdingSymbols: ios.profile.holdingSymbols,
          sectorWeights: ios.profile.sectorWeights,
          missingSectors: ios.profile.missingSectors,
          overweightSectors: ios.profile.overweightSectors,
        }
      : undefined;
    fetch("/api/ai/watchlist", {
      method: "POST",
      headers: portfolioContext ? { "Content-Type": "application/json" } : {},
      body: portfolioContext ? JSON.stringify({ portfolioContext }) : undefined,
    })
      .then(async (r) => {
        const json = (await r.json()) as WatchlistDigest & { error?: string };
        if (!r.ok || json.error) throw new Error(json.error ?? "The AI did not respond.");
        setDigest(json);
      })
      .catch((e: unknown) => {
        // Never leave the panel silently empty after a skeleton — say what failed.
        setDigestError(
          e instanceof Error
            ? e.message
            : `AI is unavailable. ${AI_RECOVERY_HINT}`,
        );
      })
      .finally(() => {
        digestInFlight.current = false;
        setDigestLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ios?.profile.builtAt, ios?.profile.hasPortfolio]);

  async function remove(symbol: string) {
    const snapshot = items;
    setItems((prev) => prev.filter((i) => i.symbol !== symbol));
    try {
      /* Scoped to the active list. The server keeps the symbol's target, thesis
         and stage as long as it is still in another list, and only deletes the
         research row on the last removal — so "remove from this list" cannot
         silently destroy months of notes. */
      const scope = activeGroupId != null ? `&group=${activeGroupId}` : "";
      const res = await fetch(`/api/watchlist?symbol=${encodeURIComponent(symbol)}${scope}`, {
        method: "DELETE",
      });
      const json = (await res.json().catch(() => ({}))) as { removedEntirely?: boolean };
      if (!res.ok) throw new Error("Server rejected the removal");
      // Refresh so the tab counts stay truthful.
      void load();
      toast(
        json.removedEntirely
          ? `${symbol} removed — target and thesis deleted`
          : `${symbol} removed from this list — still tracked elsewhere`,
        "info",
      );
    } catch {
      // Roll the optimistic delete back. Without this the row vanished from the
      // UI and reappeared on the next reload, still in the database.
      setItems(snapshot);
      void load();
      toast(`Could not remove ${symbol} — restored`, "error");
    }
  }

  const patchItem = useCallback(
    async (
      symbol: string,
      patch: Partial<Pick<WatchlistItem, "targetPrice" | "targetDirection" | "alertPctDrop" | "notes">> & {
        targetNote?: string | null;
      },
    ) => {
      const res = await fetch("/api/watchlist", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol, ...patch }),
      });
      if (!res.ok) {
        // The old version ignored the response entirely and toasted success
        // regardless, so a rejected write looked like a saved one until reload.
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(json.error ?? "Could not save your change.");
      }
      // `targetNote` belongs to the revision, not to the item, so it must not be
      // merged into local row state.
      const itemPatch = { ...patch };
      delete itemPatch.targetNote;
      const touchedTarget = "targetPrice" in patch || "targetDirection" in patch;
      setItems((prev) =>
        prev.map((i) =>
          i.symbol === symbol
            ? {
                ...i,
                ...itemPatch,
                // A target change appends a revision; keep the count in step so
                // the history affordance appears without a full reload.
                targetRevisionCount: touchedTarget
                  ? (i.targetRevisionCount ?? 0) + 1
                  : i.targetRevisionCount,
              }
            : i,
        ),
      );
    },
    [],
  );

  /* ---------------------------------------------------------------------- */
  /* Named-list mutations                                                    */
  /* ---------------------------------------------------------------------- */

  /** Every group mutation returns the fresh collection, so one helper covers all. */
  const groupRequest = useCallback(
    async (init: RequestInit & { url?: string }, onDone?: (json: { groups?: WatchlistGroup[] }) => void) => {
      const res = await fetch(init.url ?? "/api/watchlist/groups", init);
      const json = (await res.json().catch(() => ({}))) as { groups?: WatchlistGroup[]; error?: string };
      if (!res.ok) throw new Error(json.error ?? "Could not update your watchlists");
      if (json.groups) setGroups(json.groups);
      onDone?.(json);
      return json;
    },
    [],
  );

  const createList = useCallback(
    async (name: string) => {
      try {
        const res = await fetch("/api/watchlist/groups", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name }),
        });
        const json = (await res.json()) as { group?: WatchlistGroup; error?: string };
        if (!res.ok || !json.group) throw new Error(json.error ?? "Could not create the list");
        // Switch to the new list immediately — creating one and staying put would
        // leave the user wondering whether it worked.
        setActiveGroupId(json.group.id);
        toast(`Created “${json.group.name}”`);
      } catch (err) {
        toast(err instanceof Error ? err.message : "Could not create the list", "error");
      }
    },
    [setActiveGroupId, toast],
  );

  const renameList = useCallback(
    async (id: number, name: string) => {
      try {
        await groupRequest({
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, name }),
        });
      } catch (err) {
        toast(err instanceof Error ? err.message : "Could not rename the list", "error");
      }
    },
    [groupRequest, toast],
  );

  const duplicateList = useCallback(
    async (id: number, name: string) => {
      try {
        const res = await fetch("/api/watchlist/groups", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, duplicateOf: id }),
        });
        const json = (await res.json()) as { group?: WatchlistGroup; error?: string };
        if (!res.ok || !json.group) throw new Error(json.error ?? "Could not duplicate the list");
        setActiveGroupId(json.group.id);
        toast(`Duplicated as “${json.group.name}”`);
      } catch (err) {
        toast(err instanceof Error ? err.message : "Could not duplicate the list", "error");
      }
    },
    [setActiveGroupId, toast],
  );

  const deleteList = useCallback(
    async (id: number) => {
      try {
        const json = await groupRequest({ method: "DELETE", url: `/api/watchlist/groups?id=${id}` });
        const moved = (json as { movedSymbols?: number }).movedSymbols ?? 0;
        // Say what happened to the symbols — silently relocating them would look
        // like data loss.
        toast(
          moved > 0
            ? `List deleted · ${moved} name${moved === 1 ? "" : "s"} moved to your first list`
            : "List deleted",
        );
        // `load` reconciles the active id against what survived.
        setActiveGroupId(null);
      } catch (err) {
        toast(err instanceof Error ? err.message : "Could not delete the list", "error");
      }
    },
    [groupRequest, setActiveGroupId, toast],
  );

  const reorderLists = useCallback(
    async (orderedIds: number[]) => {
      // Optimistic: reordering tabs should feel instant.
      setGroups((prev) => orderedIds.map((id) => prev.find((g) => g.id === id)!).filter(Boolean));
      try {
        await groupRequest({
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ order: orderedIds }),
        });
      } catch (err) {
        void load();
        toast(err instanceof Error ? err.message : "Could not reorder", "error");
      }
    },
    [groupRequest, load, toast],
  );

  const setBenchmark = useCallback(
    async (id: number, benchmark: string | null) => {
      await groupRequest({
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, benchmark }),
      });
      toast(benchmark ? `Benchmark set to ${benchmark}` : "Benchmark cleared");
    },
    [groupRequest, toast],
  );

  /** Add the symbol to another list, or move it between lists. */
  const changeMembership = useCallback(
    async (symbol: string, addTo: number | null, removeFrom: number | null) => {
      try {
        const res = await fetch("/api/watchlist/membership", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ symbol, addTo, removeFrom }),
        });
        if (!res.ok) {
          const json = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(json.error ?? "Could not update lists");
        }
        await load();
        const target = groups.find((g) => g.id === addTo);
        toast(
          removeFrom != null && addTo != null
            ? `${symbol} moved to “${target?.name ?? "list"}”`
            : `${symbol} added to “${target?.name ?? "list"}”`,
        );
      } catch (err) {
        toast(err instanceof Error ? err.message : "Could not update lists", "error");
      }
    },
    [groups, load, toast],
  );

  const setStage = useCallback(
    async (item: WatchlistItem, stage: IdeaStage) => {
      setItems((prev) => prev.map((i) => (i.symbol === item.symbol ? { ...i, stage } : i)));
      try {
        const res = await fetch("/api/pipeline", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ symbol: item.symbol, stage, name: item.name }),
        });
        if (!res.ok) throw new Error();
        toast(`${item.symbol} → ${STAGE_LABEL[stage]}`);
      } catch {
        setItems((prev) => prev.map((i) => (i.symbol === item.symbol ? { ...i, stage: item.stage } : i)));
        toast(`Could not move ${item.symbol}`, "error");
      }
    },
    [toast],
  );

  // Fetch full research inputs for every symbol. Keyed on the symbol set so
  // adding/removing a stock re-enriches (server-side cache makes repeats cheap).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- clearing cached fit data when the list empties, not derivable at render time since fitData persists across item removal
    if (items.length === 0) { setFitData(new Map()); return; }
    let cancelled = false;
    fetch("/api/watchlist/fit")
      .then((r) => (r.ok ? r.json() : null))
      .then((json: { items?: FitEnrichment[] } | null) => {
        if (cancelled || !json?.items) return;
        const map = new Map<string, FitEnrichment>();
        for (const e of json.items) map.set(e.symbol.toUpperCase(), e);
        setFitData(map);
      })
      .catch(() => { /* fit inputs are an enhancement — degrade gracefully */ });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbolsKey]);

  const quoteKeys = Object.keys(quotes).sort().join(",");
  const fitDataKey = [...fitData.keys()].sort().join(",");
  const fitScores = useMemo(() => {
    if (!ios?.profileReady) return new Map<string, PortfolioFitAnalysis>();
    const map = new Map<string, PortfolioFitAnalysis>();
    for (const item of items) {
      const q = quotes[item.symbol];
      const enr = fitData.get(item.symbol.toUpperCase());
      // Compute ONCE and reuse for both score and tier — computing the tier
      // from a second call with different inputs was producing score/tier
      // mismatches at band boundaries.
      map.set(
        item.symbol,
        ios.getPortfolioFit({
          symbol: item.symbol,
          sector: enr?.sector ?? item.sector ?? null,
          marketCap: enr?.marketCap ?? q?.marketCap ?? null,
          compositeScores: enr?.compositeScores ?? null,
          dividendYield: enr?.dividendYield ?? item.dividendYield ?? null,
          beta: enr?.beta ?? null,
          geography: enr?.geography ?? null,
          isOnWatchlist: true,
        }),
      );
    }
    return map;
  // `symbolsKey`, not `items.length`: renaming a symbol or swapping one for
  // another kept the length identical, so the memo went stale.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ios?.profile.builtAt, ios?.profileReady, symbolsKey, quoteKeys, fitDataKey]);

  /* Everything derived, once per row. */
  const rows = useMemo<Row[]>(
    () =>
      items.map((item) => {
        const quote = quotes[item.symbol];
        const price = isUsablePrice(quote?.price) ? quote!.price : null;
        const direction = resolveTargetDirection(item.targetDirection, item.targetPrice, price);
        const changePercent = quote && Number.isFinite(quote.changePercent) ? quote.changePercent : null;
        const enr = fitData.get(item.symbol.toUpperCase());
        const consensus = {
          mean: enr?.analystTargetMean ?? null,
          high: enr?.analystTargetHigh ?? null,
          low: enr?.analystTargetLow ?? null,
          opinions: enr?.analystOpinions ?? null,
        };
        return {
          item,
          quote,
          currency: quote?.currency ?? "USD",
          price,
          changePercent,
          direction,
          upside: upsidePercent(price, item.targetPrice),
          fromHigh: percentFrom52WeekHigh(price, quote?.fiftyTwoWeekHigh),
          fit: fitScores.get(item.symbol),
          owned: ownedSymbols.has(item.symbol.toUpperCase()),
          alerts: buildAlerts(item, quote, direction),
          consensus,
          consensusUpside: upsidePercent(price, consensus.mean),
          /* Relative performance is only meaningful when BOTH legs are known —
             a benchmark whose own quote failed would otherwise make every name
             look like it was outperforming by exactly its own move. */
          vsBenchmark:
            changePercent != null && benchmarkChange != null && item.symbol.toUpperCase() !== benchmarkSymbol
              ? changePercent - benchmarkChange
              : null,
          tick: moved[item.symbol],
        };
      }),
    [items, quotes, fitScores, fitData, ownedSymbols, benchmarkChange, benchmarkSymbol, moved],
  );

  /* Search: case-insensitive, whitespace/comma tokenised, so "nvda amd" and a
     pasted "NVDA, AMD" both work, and any token matching ticker OR name keeps
     the row. Memoized so a 57-row list is not re-lowercased on every render. */
  const filteredRows = useMemo(() => {
    const tokens = filter
      .toLowerCase()
      .split(/[\s,]+/)
      .filter(Boolean);
    return rows.filter((r) => {
      switch (quickFilter) {
        case "alerts": if (r.alerts.length === 0) return false; break;
        case "owned": if (!r.owned) return false; break;
        case "no-target": if (r.item.targetPrice != null) return false; break;
        case "thesis": if (!r.item.notes) return false; break;
        default: break;
      }
      if (tokens.length === 0) return true;
      const haystack = `${r.item.symbol} ${r.item.name}`.toLowerCase();
      return tokens.some((t) => haystack.includes(t));
    });
  }, [rows, filter, quickFilter]);

  const alertCount = useMemo(() => rows.reduce((n, r) => n + r.alerts.length, 0), [rows]);
  const stats = useMemo(() => {
    let gainers = 0;
    let losers = 0;
    let priced = 0;
    let targeted = 0;
    /* Averaged across EXIT targets only.
       A mean that mixes an exit target's +20% with a buy limit's −40% is a
       number with no interpretation: it looked authoritative in the summary
       strip and read as "this watchlist is expected to lose 19%" when in fact
       every target in it was a level to buy at. Restricted to `above` targets,
       it answers a real question — how much headroom the names I want to exit
       into still have. */
    let exitUpsideSum = 0;
    let exitUpsideCount = 0;
    for (const r of filteredRows) {
      if (r.changePercent != null) {
        priced += 1;
        if (r.changePercent > 0) gainers += 1;
        else if (r.changePercent < 0) losers += 1;
      }
      if (r.item.targetPrice != null) targeted += 1;
      if (r.upside != null && r.direction === "above") {
        exitUpsideSum += r.upside;
        exitUpsideCount += 1;
      }
    }
    return {
      gainers,
      losers,
      priced,
      targeted,
      exitUpside: exitUpsideCount > 0 ? exitUpsideSum / exitUpsideCount : null,
      exitUpsideCount,
    };
  }, [filteredRows]);

  const hasPortfolio = Boolean(ios?.profileReady && ios.profile.hasPortfolio);

  /**
   * The active sort, fully controlled.
   *
   * `defaultSortKey` alone could not express this: the table reads it once, in a
   * `useState` initializer, and the IOS profile is not ready on the first render —
   * so "default to Portfolio fit when the user has a portfolio" silently never
   * happened and the grid always opened on Added. Deriving it instead means the
   * default settles correctly the moment readiness resolves, while an explicit
   * user choice (persisted, so `sortKey` is non-empty) always wins.
   */
  const effectiveSortKey = sortKey || (hasPortfolio ? "fit" : "added");

  /**
   * The columns.
   *
   * Memoized on the derived rows, which is what makes the table's internal sort
   * memo work at all: it depends on `columns` identity, and a literal array in
   * the render body invalidated it on every keystroke and every state change.
   */
  const columns = useMemo<DataTableColumn<Row>[]>(
    () => [
      {
        key: "symbol",
        label: "Symbol",
        firstSortDir: "asc",
        sortValue: (r) => r.item.symbol,
        render: (r) => (
          <span className="flex flex-col gap-0.5">
            <span className="flex items-center gap-1.5">
              <Link
                href={`/research?symbol=${r.item.symbol}`}
                onClick={(e) => e.stopPropagation()}
                className="rounded-control font-mono text-sm font-semibold text-brand hover:underline"
              >
                {r.item.symbol}
              </Link>
              {r.owned && (
                <span
                  title="Currently held in your portfolio"
                  className="rounded-full border border-positive/30 bg-positive/10 px-1 py-0 text-[9px] font-bold uppercase tracking-wide text-positive"
                >
                  Owned
                </span>
              )}
              {r.alerts.length > 0 && (
                <span
                  title={r.alerts.map((a) => a.message).join(" ")}
                  className="rounded-full bg-negative/15 px-1 py-0 text-[9px] font-bold uppercase tracking-wide text-negative"
                >
                  Alert
                </span>
              )}
              {r.item.notes && (
                <span
                  title={r.item.notes}
                  aria-label="Has a thesis note"
                  className="text-[10px] leading-none text-muted/50"
                >
                  ✎
                </span>
              )}
            </span>
            <span className="block max-w-56 truncate text-[11px] text-muted" title={r.item.name}>
              {r.item.name}
            </span>
          </span>
        ),
      },
      {
        key: "price",
        label: "Last",
        numeric: true,
        help: "Most recent price from the quote provider, in the security's own currency. Refreshes automatically while the tab is open and a tracked market is trading.",
        sortValue: (r) => r.price,
        render: (r) =>
          r.price == null ? (
            <span className="text-muted/40">—</span>
          ) : (
            /* Keyed on the tick so React remounts the span and the CSS animation
               replays; without a changing key the class is already present and
               the browser will not re-run it. */
            <span
              key={r.tick ? `${r.price}-${r.tick}` : "static"}
              className={
                r.tick === "up"
                  ? "inline-block rounded-control px-1 animate-tick-up"
                  : r.tick === "down"
                    ? "inline-block rounded-control px-1 animate-tick-down"
                    : undefined
              }
            >
              {formatCurrency(r.price, r.currency)}
            </span>
          ),
      },
      {
        key: "change",
        label: "Today",
        numeric: true,
        help: "Change against the previous close.",
        sortValue: (r) => r.changePercent,
        render: (r) =>
          r.changePercent == null ? (
            <span className="text-muted/40">—</span>
          ) : (
            <span className={toneClass(r.changePercent)}>{formatPercent(r.changePercent)}</span>
          ),
      },
      /* Relative performance, only when the active list has a benchmark. A column
         that would be entirely "—" is not shown at all rather than occupying
         width to say nothing. */
      ...(benchmarkSymbol
        ? [
            {
              key: "vsBenchmark",
              label: `vs ${benchmarkSymbol}`,
              numeric: true,
              help: `Today's move minus ${benchmarkSymbol}'s move. Positive means it outperformed the benchmark today. Set per watchlist.`,
              sortValue: (r: Row) => r.vsBenchmark,
              render: (r: Row) =>
                r.vsBenchmark == null ? (
                  <span className="text-muted/40">—</span>
                ) : (
                  <span className={toneClass(r.vsBenchmark)}>{formatPercent(r.vsBenchmark)}</span>
                ),
              hideBelow: "lg" as const,
            },
          ]
        : []),
      {
        key: "target",
        label: "My target",
        numeric: true,
        help: "Your own price target for this name, and the level its alert fires at. This is not the analyst consensus — Research shows that separately as \"Mean target\".",
        sortValue: (r) => r.item.targetPrice,
        render: (r) =>
          r.item.targetPrice != null ? (
            <span
              title={`Alert fires when the price ${r.direction === "above" ? "rises to or above" : "falls to or below"} this level`}
              className="inline-flex items-baseline gap-1"
            >
              {formatCurrency(r.item.targetPrice, r.currency)}
              <span aria-hidden="true" className="text-[9px] text-muted/50">
                {r.direction === "above" ? "▲" : "▼"}
              </span>
            </span>
          ) : (
            // An unset user-editable field deserves an affordance, not a dash.
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setEditingTarget(r.item);
              }}
              className="rounded-control font-sans text-[11px] text-muted/50 transition-colors hover:text-brand hover:underline"
            >
              Set
            </button>
          ),
        hideBelow: "sm",
      },
      {
        key: "upside",
        label: "Upside",
        numeric: true,
        help: "Return from today's price to your target: (target − price) ÷ price. Positive means your target is above the current price. Blank when no target is set.",
        sortValue: (r) => r.upside,
        render: (r) =>
          r.upside == null ? (
            <span className="text-muted/40">—</span>
          ) : (
            <span className={toneClass(r.upside)}>{formatPercent(r.upside)}</span>
          ),
      },
      /* Analyst consensus, immediately after the user's own target and upside so
         the two views sit side by side and can be compared at a glance — while
         being separately labelled and separately sourced so they can never be
         mistaken for one another. */
      {
        key: "consensus",
        label: "Consensus",
        numeric: true,
        help: "Mean analyst price target from the quote provider — the street's view, not yours. Blank when no analyst covers the name.",
        sortValue: (r) => r.consensus.mean,
        render: (r) =>
          r.consensus.mean == null ? (
            <span className="text-muted/40">—</span>
          ) : (
            <span
              title={
                r.consensus.opinions != null
                  ? `${r.consensus.opinions} analyst${r.consensus.opinions === 1 ? "" : "s"}${
                      r.consensus.low != null && r.consensus.high != null
                        ? `, range ${formatCurrency(r.consensus.low, r.currency)}–${formatCurrency(r.consensus.high, r.currency)}`
                        : ""
                    }`
                  : undefined
              }
              className="text-muted"
            >
              {formatCurrency(r.consensus.mean, r.currency)}
            </span>
          ),
        hideBelow: "xl",
      },
      {
        key: "consensusUpside",
        label: "Cons. upside",
        numeric: true,
        help: "Return from today's price to the analyst consensus target. Directly comparable with the Upside column, which uses your own target.",
        sortValue: (r) => r.consensusUpside,
        render: (r) =>
          r.consensusUpside == null ? (
            <span className="text-muted/40">—</span>
          ) : (
            <span className={toneClass(r.consensusUpside)}>{formatPercent(r.consensusUpside)}</span>
          ),
        hideBelow: "xl",
      },
      {
        key: "fromHigh",
        label: "From high",
        numeric: true,
        help: "How far below the 52-week high the price is. Always zero or negative; 0.00% means it is at the high.",
        sortValue: (r) => r.fromHigh,
        render: (r) =>
          r.fromHigh == null ? (
            <span className="text-muted/40">—</span>
          ) : (
            <span className={r.fromHigh < -20 ? "text-warning" : "text-muted"}>
              {formatPercent(r.fromHigh)}
            </span>
          ),
        hideBelow: "lg",
      },
      {
        key: "fit",
        label: "Portfolio fit",
        numeric: true,
        help: hasPortfolio
          ? "Does this belong in YOUR book? Weighs your existing sector weights, concentration, objective and style. Not a view on the asset itself. Click a score for its breakdown, or open the row for the full analysis."
          : "Needs a portfolio to score against — add holdings on the Portfolio page and every row here becomes personalized.",
        sortValue: (r) => r.fit?.fitScore ?? null,
        render: (r) => (
          <ScoreChip
            kind="fit"
            score={r.fit?.fitScore ?? null}
            /* Shown inline only when it should change how the number is read.
               A 73 backed by 30% of the scoring weight is a very different claim
               from a 73 backed by 90% — but printing "94% conf" on all 57 rows
               made the column three values wide and buried the handful that
               genuinely need discounting. The full figure is always in the
               chip's popover. */
            confidence={r.fit && !r.fit.isGeneric && r.fit.confidence < 70 ? r.fit.confidence : null}
            why={r.fit?.reasons}
            size="sm"
            showLabel={false}
          />
        ),
        hideBelow: "md",
      },
      {
        key: "stage",
        label: "Stage",
        help: "Where this idea is in your process: Surfaced → Researching → Thesis → Owned, or Passed / Exited. The same field the Portfolio pipeline board edits.",
        // Sorted by funnel position rather than alphabetically, so the order on
        // screen is the order of the process.
        sortValue: (r) => IDEA_STAGES.indexOf(r.item.stage),
        firstSortDir: "asc",
        render: (r) => <StageBadge stage={r.item.stage} />,
        hideBelow: "lg",
      },
      {
        key: "sector",
        label: "Sector",
        help: "From cached fundamentals. Blank for names that have never been screened.",
        firstSortDir: "asc",
        sortValue: (r) => r.item.sector ?? null,
        render: (r) =>
          r.item.sector ? (
            <span className="block max-w-32 truncate text-[11px] text-muted" title={r.item.sector}>
              {r.item.sector}
            </span>
          ) : (
            <span className="text-muted/40">—</span>
          ),
        hideBelow: "xl",
      },
      {
        key: "added",
        label: "Added",
        numeric: true,
        help: "How long this name has been on the list. Sorted newest first.",
        sortValue: (r) => Date.parse(r.item.addedAt) || null,
        render: (r) => <span title={formatDate(r.item.addedAt)}>{formatAge(r.item.addedAt)}</span>,
        hideBelow: "lg",
      },
      {
        key: "notes",
        label: "Thesis",
        // Sorted by whether a thesis exists, not alphabetically by its text —
        // "which names have I never written up" is the useful question, and
        // ranking notes A→Z answers nothing.
        help: "Your written reason for watching this. Sorts written-up names first.",
        sortValue: (r) => (r.item.notes ? 1 : 0),
        render: (r) =>
          r.item.notes ? (
            <span className="line-clamp-1 block max-w-44 text-[11px] italic text-muted/80" title={r.item.notes}>
              {r.item.notes}
            </span>
          ) : (
            <span className="text-muted/40">—</span>
          ),
        hideBelow: "xl",
      },
    ],
    [hasPortfolio, benchmarkSymbol],
  );

  const stickyHeight = filteredRows.length > STICKY_AFTER_ROWS ? "min(72vh, 900px)" : undefined;

  /* Onboarding copy earns its space only until the user has data. */
  const showHint = items.length > 0 && items.length <= 3;

  // Scoped to current `items`, not all of `quotes` — removing a symbol doesn't
  // prune its stale quote from state, so counting every cached quote would
  // keep a removed stock's gain/loss in the summary strip until next reload.
  const trackedQuotes = items.map((i) => quotes[i.symbol]).filter((q): q is Quote => q != null);
  const gainers = trackedQuotes.filter((q) => q.changePercent > 0).length;
  const losers  = trackedQuotes.filter((q) => q.changePercent < 0).length;
  const hasQuotes = trackedQuotes.length > 0;

  return (
    <PageShell py="py-10" width="wide">
      <ArrivalHighlight targetId={highlightTarget} />
      <Reveal index={0} className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">Watchlist</h1>
            {alertCount > 0 && (
              // Actionable, not decorative: the count was a pulsing badge that
              // told you something needed attention and then made you find it.
              <button
                type="button"
                onClick={() => setQuickFilter(quickFilter === "alerts" ? "all" : "alerts")}
                aria-pressed={quickFilter === "alerts"}
                className="rounded-full border border-negative/30 bg-negative/15 px-2.5 py-0.5 text-xs font-semibold text-negative transition-colors hover:bg-negative/25"
              >
                {alertCount} alert{alertCount > 1 ? "s" : ""} firing
                <span className="ml-1 font-normal opacity-70">
                  {quickFilter === "alerts" ? "· show all" : "· show"}
                </span>
              </button>
            )}
          </div>
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
            <span>Live prices, your own price targets, and the thesis behind each name.</span>
            {/* Freshness is part of the claim "live". A price with no "as of" is
                an assertion the UI cannot back up. */}
            {!loading && items.length > 0 && (
              <LiveIndicator status={liveStatus} lastUpdatedAt={lastUpdatedAt} onRefresh={refreshNow} />
            )}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Link
            href="/"
            className="flex items-center rounded-lg border border-border px-4 py-2 text-sm text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
          >
            The Desk
          </Link>
          <Link
            href="/knowledge-graph?scope=watchlist&id=watchlist"
            className="flex items-center rounded-lg border border-border px-4 py-2 text-sm text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
          >
            Graph
          </Link>
          <button
            onClick={() => { void load(); refreshNow(); }}
            className="rounded-lg border border-border px-4 py-2 text-sm transition-colors hover:bg-surface-2"
          >
            ↻ Refresh
          </button>
          <button
            onClick={() => {
              setExportErr(null);
              // Scoped to the list on screen, and named after it, so exporting
              // three lists does not produce three identically-named files.
              const scope = activeGroupId != null ? `?group=${activeGroupId}` : "";
              const slug = (activeGroup?.name ?? "watchlist").toLowerCase().replace(/[^a-z0-9]+/g, "-");
              void downloadBlob(
                `/api/export/watchlist${scope}`,
                `${slug}-${new Date().toISOString().slice(0, 10)}.csv`,
              ).catch((e: unknown) => setExportErr(e instanceof Error ? e.message : "Export failed"));
            }}
            className="rounded-lg border border-border px-4 py-2 text-sm transition-colors hover:bg-surface-2"
          >
            ↓ Export
          </button>
        </div>
      </Reveal>

      {/* Named lists. Rendered whenever there is more than one, or the single
          default one has anything in it — a lone empty list needs no switcher. */}
      {!loading && groups.length > 0 && (groups.length > 1 || items.length > 0) && (
        <ListSwitcher
          groups={groups}
          activeId={activeGroupId}
          onSelect={setActiveGroupId}
          onCreate={createList}
          onRename={renameList}
          onDuplicate={duplicateList}
          onDelete={deleteList}
          onReorder={reorderLists}
          onSetBenchmark={setBenchmark}
        />
      )}

      {/* Summary strip */}
      {!loading && items.length > 0 && hasQuotes && (
        <Reveal index={1} className="flex flex-wrap items-center gap-4 rounded-xl border border-border bg-surface px-5 py-3">
          <div className="flex flex-col gap-0.5">
            <span className="text-label font-semibold uppercase tracking-widest text-muted/60">
              {filteredRows.length === rows.length ? "Watching" : "Showing"}
            </span>
            <span className="font-mono text-sm font-semibold tabular-nums">
              {filteredRows.length}
              {filteredRows.length !== rows.length && (
                <span className="text-muted/60"> / {rows.length}</span>
              )}
            </span>
          </div>
          {stats.priced > 0 && (
            <>
              <span aria-hidden="true" className="h-8 w-px bg-border" />
              <div className="flex flex-col gap-0.5">
                <span className="text-label font-semibold uppercase tracking-widest text-muted/60">Today</span>
                <div className="flex items-center gap-2 font-mono text-xs tabular-nums">
                  <span className="text-positive">↑ {stats.gainers}</span>
                  <span className="text-negative">↓ {stats.losers}</span>
                  {stats.priced - stats.gainers - stats.losers > 0 && (
                    <span className="text-muted">– {stats.priced - stats.gainers - stats.losers}</span>
                  )}
                </div>
              </div>
            </>
          )}
          <>
            <span aria-hidden="true" className="h-8 w-px bg-border" />
            <div className="flex flex-col gap-0.5">
              <span className="text-label font-semibold uppercase tracking-widest text-muted/60">
                Targets set
              </span>
              <span className="font-mono text-xs tabular-nums">
                {stats.targeted}
                <span className="text-muted/60"> / {filteredRows.length}</span>
              </span>
            </div>
          </>
          {stats.exitUpside != null && (
            <>
              <span aria-hidden="true" className="h-8 w-px bg-border" />
              <div className="flex flex-col gap-0.5">
                <span
                  className="text-label font-semibold uppercase tracking-widest text-muted/60"
                  title="Simple average upside across the names whose target sits above the market. Buy limits are excluded — averaging the two directions together produces a number that cannot be read."
                >
                  Avg upside to exit
                </span>
                <span className="font-mono text-xs tabular-nums">
                  <span className={`font-semibold ${toneClass(stats.exitUpside)}`}>
                    {formatPercent(stats.exitUpside)}
                  </span>
                  {/* The denominator, always visible: an average over 3 of 57 names
                      is a different claim from an average over all of them. */}
                  <span className="text-muted/60"> · {stats.exitUpsideCount} target{stats.exitUpsideCount === 1 ? "" : "s"}</span>
                </span>
              </div>
            </>
          )}
          {alertCount > 0 && (
            <>
              <span aria-hidden="true" className="h-8 w-px bg-border" />
              <div className="flex flex-col gap-0.5">
                <span className="text-label font-semibold uppercase tracking-widest text-muted/60">Alerts</span>
                <span className="font-mono text-xs font-semibold tabular-nums text-negative">
                  {alertCount} firing
                </span>
              </div>
            </>
          )}
        </Reveal>
      )}

      {/* AI Watchlist Intelligence — OPT-IN. Generation is user-triggered (the
          panel's idle state carries the button) rather than auto-firing on load:
          this is local inference on every tracked name, and opening a page is not
          a request to spend it. The same control regenerates afterwards, which is
          also the only way the digest can reflect symbols added since it ran. */}
      {!loading && items.length > 0 && (
        <Reveal index={2}>
          <WatchlistDigestPanel
            digest={digest}
            loading={digestLoading}
            error={digestError}
            onGenerate={fetchDigest}
          />
        </Reveal>
      )}

      {/* Structured, deterministic per-asset alerts */}
      {!loading && digest && digest.alerts.length > 0 && (
        <Reveal index={3}>
          <WatchlistAlerts alerts={digest.alerts} />
        </Reveal>
      )}

      {exportErr && (
        <p role="alert" className="text-xs text-negative">
          {exportErr}
        </p>
      )}

      {error && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-negative/40 bg-negative/10 px-4 py-3 text-sm text-negative"
        >
          <span>{error}</span>
          <button
            type="button"
            onClick={() => { setError(null); setLoading(true); void load(); }}
            className="rounded-lg border border-negative/40 px-3 py-1 text-xs font-medium transition-colors hover:bg-negative/15"
          >
            Retry
          </button>
        </div>
      )}

      {quoteError && !error && (
        <p className="rounded-lg border border-warning/30 bg-warning/[0.07] px-4 py-2.5 text-xs text-warning">
          {quoteError} Targets, notes and stages are unaffected.
        </p>
      )}

      {/* Filter row. Always present once there is anything to filter, so the
          control does not appear and disappear as the list crosses a threshold. */}
      {!loading && items.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-56 flex-1">
            <input
              ref={searchRef}
              type="search"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              aria-label="Filter watchlist by ticker or company name"
              placeholder="Filter by ticker or name…"
              className="w-full rounded-lg border border-border bg-surface px-4 py-2.5 pr-16 text-sm outline-none placeholder:text-muted focus:border-brand"
            />
            {filter ? (
              <button
                type="button"
                onClick={() => setFilter("")}
                aria-label="Clear filter"
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-control px-2 py-0.5 text-xs text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
              >
                Clear
              </button>
            ) : (
              <kbd
                aria-hidden="true"
                className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rounded border border-border px-1.5 py-0.5 font-mono text-[10px] text-muted/60"
              >
                /
              </kbd>
            )}
          </div>
          <div role="group" aria-label="Quick filters" className="flex flex-wrap gap-1">
            {QUICK_FILTERS.map((qf) => (
              <button
                key={qf}
                type="button"
                onClick={() => setQuickFilter(qf)}
                aria-pressed={quickFilter === qf}
                className={`rounded-lg border px-2.5 py-1.5 text-xs transition-colors ${
                  quickFilter === qf
                    ? "border-brand/40 bg-brand/10 text-brand"
                    : "border-border text-muted hover:bg-surface-2 hover:text-foreground"
                }`}
              >
                {QUICK_FILTER_LABEL[qf]}
              </button>
            ))}
          </div>
        </div>
      )}

      {loading ? (
        /* Shaped like the table it becomes, so nothing jumps when data lands. */
        <div className="flex flex-col gap-2" aria-busy="true" aria-label="Loading watchlist">
          <div className="h-4 w-40 animate-pulse rounded bg-surface-2" />
          <div className="overflow-hidden rounded-card border border-border">
            <div className="h-9 border-b border-border bg-surface-2" />
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 border-b border-hairline px-3 py-2.5 last:border-0">
                <div className="h-3.5 w-20 animate-pulse rounded bg-surface-2" />
                <div className="h-3.5 flex-1 animate-pulse rounded bg-surface-2 opacity-60" />
                <div className="h-3.5 w-16 animate-pulse rounded bg-surface-2" />
                <div className="h-3.5 w-16 animate-pulse rounded bg-surface-2" />
                <div className="hidden h-3.5 w-16 animate-pulse rounded bg-surface-2 md:block" />
              </div>
            ))}
          </div>
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center gap-5 rounded-xl border border-border bg-surface py-14 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full border border-border bg-surface-2 text-muted">
            <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M5 3a2 2 0 012-2h6a2 2 0 012 2v14l-5-3-5 3V3z" />
            </svg>
          </div>
          <div className="flex flex-col gap-1.5">
            <p className="text-sm font-semibold">Your watchlist is empty</p>
            <p className="max-w-xs text-xs leading-5 text-muted">
              Add symbols from Research or Screener, then set a price target, a drop alert and a
              thesis on each one.
            </p>
          </div>
          <div className="flex gap-3">
            <Link href="/research" className="rounded-lg bg-brand-strong px-5 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90">
              Research a stock →
            </Link>
            <Link href="/screener" className="rounded-lg border border-border px-5 py-2 text-sm transition-colors hover:bg-surface-2">
              Browse Screener
            </Link>
          </div>
        </div>
      ) : (
        <DataTable
          rows={filteredRows}
          rowKey={(r) => r.item.symbol}
          label="Watchlist"
          columns={columns}
          sortKey={effectiveSortKey}
          sortDir={sortDir}
          onSortChange={(key, dir) => { setSortKey(key); setSortDir(dir); }}
          density={density}
          onDensityChange={setDensity}
          maxBodyHeight={stickyHeight}
          rowTone={(r) => (r.alerts.length > 0 ? "alert" : "default")}
          toolbar={
            <span>
              {filteredRows.length === rows.length
                ? `${rows.length} name${rows.length === 1 ? "" : "s"}`
                : `${filteredRows.length} of ${rows.length}`}
              {showHint && " · click a row for its fit breakdown, target and thesis"}
            </span>
          }
          /* A filter that matches nothing is a state to design, not a bare
             sentence under an empty frame. */
          empty={
            <div className="flex flex-col items-center gap-3 py-12 text-center">
              <p className="text-sm font-medium">No names match</p>
              <p className="max-w-xs text-xs leading-5 text-muted">
                {filter && quickFilter !== "all"
                  ? <>Nothing matches “{filter}” within <span className="text-foreground">{QUICK_FILTER_LABEL[quickFilter]}</span>.</>
                  : filter
                    ? <>Nothing matches “{filter}”.</>
                    : <>No name is currently <span className="text-foreground">{QUICK_FILTER_LABEL[quickFilter].toLowerCase()}</span>.</>}
              </p>
              <div className="flex gap-2">
                {filter && (
                  <button
                    type="button"
                    onClick={() => setFilter("")}
                    className="rounded-lg border border-border px-3 py-1.5 text-xs transition-colors hover:bg-surface-2"
                  >
                    Clear filter
                  </button>
                )}
                {quickFilter !== "all" && (
                  <button
                    type="button"
                    onClick={() => setQuickFilter("all")}
                    className="rounded-lg border border-border px-3 py-1.5 text-xs transition-colors hover:bg-surface-2"
                  >
                    Show all names
                  </button>
                )}
              </div>
            </div>
          }
          actions={(r) => (
            <>
              <DataTableAction onClick={() => setBuyingItem(r.item)}>Buy…</DataTableAction>
              <DataTableAction onClick={() => setEditingTarget(r.item)}>
                {r.item.targetPrice != null ? "Edit target…" : "Set target…"}
              </DataTableAction>
              <DataTableAction onClick={() => setEditingNotes(r.item)}>
                {r.item.notes ? "Edit thesis…" : "Write thesis…"}
              </DataTableAction>
              {/* The stage was already stored on every row and edited by the
                  Pipeline board; the Watchlist is where the decision is made. */}
              {IDEA_STAGES.filter((s) => s !== r.item.stage && s !== "owned").map((s) => (
                <DataTableAction key={s} onClick={() => void setStage(r.item, s)}>
                  Mark {STAGE_LABEL[s].toLowerCase()}
                </DataTableAction>
              ))}
              {/* Cross-list membership. A symbol's research state is shared, so
                  "copy" genuinely costs nothing and "move" never loses a target. */}
              {groups
                .filter((g) => g.id !== activeGroupId)
                .map((g) => (
                  <DataTableAction
                    key={`copy-${g.id}`}
                    onClick={() => void changeMembership(r.item.symbol, g.id, null)}
                  >
                    Add to “{g.name}”
                  </DataTableAction>
                ))}
              {activeGroupId != null &&
                groups
                  .filter((g) => g.id !== activeGroupId)
                  .map((g) => (
                    <DataTableAction
                      key={`move-${g.id}`}
                      onClick={() => void changeMembership(r.item.symbol, g.id, activeGroupId)}
                    >
                      Move to “{g.name}”
                    </DataTableAction>
                  ))}
              <DataTableAction href={`/research?symbol=${r.item.symbol}`}>Research</DataTableAction>
              <DataTableAction href={`/valuation?symbol=${r.item.symbol}`}>Valuation</DataTableAction>
              <DataTableAction href={`/ic-report?symbol=${r.item.symbol}`}>IC Report</DataTableAction>
              <DataTableAction href={`/compare?symbols=${r.item.symbol}`}>Compare</DataTableAction>
              <DataTableAction tone="danger" onClick={() => setConfirmDelete(r.item)}>
                {groups.length > 1 ? "Remove from this list" : "Remove"}
              </DataTableAction>
            </>
          )}
          renderDetail={(r) => (
            <WatchlistRowDetail
              item={r.item}
              quote={r.quote}
              fit={r.fit}
              alerts={r.alerts}
              direction={r.direction}
              consensus={r.consensus}
              revisionCount={r.item.targetRevisionCount ?? 0}
              onEditTarget={() => setEditingTarget(r.item)}
              onEditNotes={() => setEditingNotes(r.item)}
            />
          )}
        />
      )}

      {/* Fit is one of this page's headline columns; say so when it cannot score. */}
      {!loading && items.length > 0 && ios?.profileReady && !hasPortfolio && (
        <p className="text-xs text-muted">
          Portfolio fit reads “no basis” for every name because there is no portfolio to score
          against.{" "}
          <Link href="/portfolio" className="text-brand hover:underline">
            Add your holdings
          </Link>{" "}
          and this column becomes personalized.
        </p>
      )}

      {editingTarget && (
        <TargetModal
          item={editingTarget}
          consensus={rows.find((r) => r.item.symbol === editingTarget.symbol)?.consensus}
          onSave={async (patch: TargetPatch) => {
            await patchItem(editingTarget.symbol, patch);
            setEditingTarget(null);
            toast(patch.targetPrice != null ? "Target saved" : "Target cleared");
          }}
          onCancel={() => setEditingTarget(null)}
        />
      )}

      {editingNotes && (
        <NotesModal
          item={editingNotes}
          onSave={async (notes) => {
            await patchItem(editingNotes.symbol, { notes });
            setEditingNotes(null);
            toast(notes ? "Thesis saved" : "Thesis cleared");
          }}
          onCancel={() => setEditingNotes(null)}
        />
      )}

      {buyingItem && (
        <AddToPortfolioModal
          item={buyingItem}
          fit={fitScores.get(buyingItem.symbol)}
          onClose={() => setBuyingItem(null)}
          onSuccess={(result) => {
            setOwnedSymbols((prev) => new Set(prev).add(result.symbol));
            toast(`Bought ${result.symbol} — added to Portfolio`, "success");
            void loadOwned();
          }}
        />
      )}

      <ConfirmDialog
        open={confirmDelete != null}
        onClose={() => setConfirmDelete(null)}
        onConfirm={() => { if (confirmDelete) void remove(confirmDelete.symbol); }}
        title={groups.length > 1 ? "Remove from this list" : "Remove from watchlist"}
        /* The consequence genuinely differs: with several lists the symbol may
           survive elsewhere with its research intact, and promising deletion
           either way would be a lie in one direction or the other. */
        message={
          groups.length > 1
            ? `Remove ${confirmDelete?.symbol} from “${activeGroup?.name ?? "this list"}”? Its target, alerts and thesis are kept if it is still in another list, and deleted if this was the last one.`
            : `Remove ${confirmDelete?.symbol} from your watchlist? This also deletes its target, alerts and thesis.`
        }
        confirmLabel="Remove"
        danger
      />
    </PageShell>
  );
}
