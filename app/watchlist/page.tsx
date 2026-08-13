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
import type { Conviction, IdeaStage, Quote, TargetDirection, WatchlistGroup, WatchlistItem } from "@/lib/types";
import type { WatchlistDigest } from "@/lib/ai-watchlist";
import { AI_RECOVERY_HINT } from "@/lib/ai/availability";
import type { PortfolioFitAnalysis } from "@/lib/ios/types";
import type { FitEnrichment } from "@/lib/watchlist-fit";
import { formatCurrency, formatDate, formatPercent, toneClass } from "@/lib/format";
import {
  distanceToTargetPercent,
  isTargetReached,
  isUsablePrice,
  percentFrom52WeekHigh,
  resolveTargetDirection,
  upsidePercent,
} from "@/lib/watchlist-metrics";
import {
  computeAttention,
  computeWatchlistHealth,
  daysUntil,
  isStaleReview,
  summarizeSinceVisit,
  TARGET_NEAR_PCT,
  STALE_REVIEW_DAYS,
  type AttentionResult,
  type SymbolPulse,
  type WatchlistPulse,
} from "@/lib/watchlist-pulse";
import {
  DEFAULT_WATCHLIST_SETTINGS,
  FILTER_EMPTY,
  FILTER_LABEL,
  sanitizeWatchlistSettings,
  type WatchlistFilter,
  type WatchlistViewSettings,
} from "@/lib/watchlist-settings";
import { formatAsOf } from "@/lib/live-quotes";
import { detectMarket, type MarketRegion } from "@/lib/market";
import { IDEA_STAGES, STAGE_LABEL, effectiveStage } from "@/lib/idea-stage";
import { ConfirmDialog } from "@/app/_components/dialog";
import { useToast } from "@/app/_components/toast";
import { useIOSSafe } from "@/lib/ios-context";
import { WatchlistAlerts } from "./_components/watchlist-alerts";
import { ResultsRadar } from "./_components/results-radar";
import { WatchlistDigestPanel } from "./_components/digest-panel";
import { TargetModal, type TargetPatch } from "@/app/_components/target-modal";
import { ThesisModal, type ThesisPatch } from "./_components/thesis-modal";
import { PulseBrief, type PulseBriefRow } from "./_components/pulse-brief";
import { WatchlistSettings } from "./_components/watchlist-settings";
import { WatchlistRowDetail, type FiringAlert } from "./_components/row-detail";
import { StageBadge } from "./_components/stage-badge";
import { ListSwitcher } from "./_components/list-switcher";
import { useLiveQuotes } from "./_components/use-live-quotes";
import { usePersistedState } from "./_components/use-view-state";
import { AddToPortfolioModal } from "@/app/_components/portfolio/add-to-portfolio-modal";
import { ArrivalHighlight, useArrivalTarget } from "@/app/_components/arrival-highlight";
import {
  PageShell,
  DataTable,
  DataTableAction,
  ScoreChip,
  type DataTableColumn,
  type Density,
  type SortDir,
} from "@/app/_components/ui";
import { Reveal } from "@/app/_components/reveal";

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
  /** Server-side pulse context (developments, fired alerts, earnings, drift). */
  pulse: SymbolPulse | null;
  /** The attention verdict — live price signals fused with the pulse. */
  attention: AttentionResult;
  /** Days to the next earnings date, when the calendar knows one. */
  earningsIn: number | null;
  /** Non-negative % still to travel to the target; 0 once reached; null without one. */
  targetDistance: number | null;
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

/* Filter vocabulary (labels, descriptions, empty phrases, defaults) lives in
   lib/watchlist-settings.ts, shared with the Customize popover. */

const CONVICTION_WORD: Record<Conviction, string> = { low: "Low", medium: "Medium", high: "High" };
const CONVICTION_DOT: Record<Conviction, string> = {
  low: "bg-muted/50",
  medium: "bg-warning/70",
  high: "bg-positive/80",
};

const SORT_KEYS = [
  "attention",
  "symbol",
  "price",
  "change",
  "vsBenchmark",
  "target",
  "upside",
  "consensus",
  "fromHigh",
  "fit",
  "stage",
  "sector",
  "nextEvent",
  "notes",
] as const;

const isSortKey = (v: unknown): v is string => typeof v === "string" && (SORT_KEYS as readonly string[]).includes(v);
const isSortDir = (v: unknown): v is SortDir => v === "asc" || v === "desc";
const isDensity = (v: unknown): v is Density => v === "compact" || v === "comfortable";
/* Deliberately loose: sanitizeWatchlistSettings normalizes shape and values, so
   the storage guard only has to reject non-objects. */
const isSettingsLike = (v: unknown): v is WatchlistViewSettings => typeof v === "object" && v !== null;

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
  const [editingThesis, setEditingThesis] = useState<WatchlistItem | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<WatchlistItem | null>(null);
  const [buyingItem, setBuyingItem] = useState<WatchlistItem | null>(null);
  const [ownedSymbols, setOwnedSymbols] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState("");
  const [digest, setDigest] = useState<WatchlistDigest | null>(null);
  const [digestLoading, setDigestLoading] = useState(false);
  const [digestError, setDigestError] = useState<string | null>(null);
  const digestInFlight = useRef(false);
  /* The pulse: server-side change context ("since your last visit"). */
  const [pulse, setPulse] = useState<WatchlistPulse | null>(null);
  const [pulseLoading, setPulseLoading] = useState(true);
  const [pulseError, setPulseError] = useState<string | null>(null);
  /* Table expansion, controlled — the attention queue opens rows from outside. */
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
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

  /* View preferences — chips, default filter, columns, default sort, attention
     thresholds. Persisted as-is; sanitized on every read so a stale or
     hand-edited entry can never put the page into a state it has no UI for. */
  const [storedSettings, setStoredSettings] = usePersistedState<WatchlistViewSettings>(
    "uaa.watchlist.settings",
    DEFAULT_WATCHLIST_SETTINGS,
    isSettingsLike,
  );
  const settings = useMemo(() => sanitizeWatchlistSettings(storedSettings), [storedSettings]);

  /* The active quick filter is SESSION state: the page opens on the configured
     default ("Open on" in Customize) rather than wherever the last visit
     happened to end, which makes every arrival predictable. */
  const [chosenFilter, setChosenFilter] = useState<WatchlistFilter | null>(null);
  const quickFilter = chosenFilter ?? settings.defaultFilter;
  const setQuickFilter = setChosenFilter;

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
      setError(err instanceof Error ? err.message : "The watchlist failed to load — reload to retry.");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadOwned, activeGroupId]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  /**
   * The pulse: one request for everything the triage layer knows that a live
   * quote does not. Scoped to the active list; refires on a list switch (the
   * visit clock tolerates that — reads inside one session share a baseline).
   * When the server reports background news checks in flight, ONE follow-up
   * read picks up their results; the guard stops that from becoming a loop.
   */
  const pulseRefetched = useRef(false);
  const loadPulse = useCallback(async () => {
    try {
      const scope = activeGroupId != null ? `?group=${activeGroupId}` : "";
      const res = await fetch(`/api/watchlist/pulse${scope}`);
      const json = (await res.json().catch(() => ({}))) as WatchlistPulse & { error?: string };
      if (!res.ok || json.error) throw new Error(json.error ?? `The server returned ${res.status}.`);
      setPulse(json);
      setPulseError(null);
    } catch (err) {
      setPulseError(err instanceof Error ? err.message : "unreachable");
    } finally {
      setPulseLoading(false);
    }
  }, [activeGroupId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- same convention as the `load` effect above: fetch-then-set, never synchronous
    if (!loading && activeGroupId != null) void loadPulse();
  }, [loadPulse, loading, activeGroupId]);

  /* One follow-up read picks up the results of the server's background news
     checks; the ref stops that from becoming a polling loop, and the cleanup
     cancels it when the page unmounts mid-wait. */
  useEffect(() => {
    if (!pulse || pulse.checking.length === 0 || pulseRefetched.current) return;
    pulseRefetched.current = true;
    const t = setTimeout(() => { void loadPulse(); }, 30_000);
    return () => clearTimeout(t);
  }, [pulse, loadPulse]);

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
      patch: Partial<
        Pick<
          WatchlistItem,
          | "targetPrice"
          | "targetDirection"
          | "alertPctDrop"
          | "notes"
          | "buyTrigger"
          | "sellTrigger"
          | "conviction"
          | "horizon"
        >
      > & {
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
      // The server stamps a review whenever a thesis field is written; mirror
      // that locally so the "Reviewed just now" line is honest without a reload.
      const touchedThesis =
        "notes" in patch || "buyTrigger" in patch || "sellTrigger" in patch ||
        "conviction" in patch || "horizon" in patch;
      setItems((prev) =>
        prev.map((i) =>
          i.symbol === symbol
            ? {
                ...i,
                ...itemPatch,
                lastReviewedAt: touchedThesis ? Date.now() : i.lastReviewedAt,
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

  /** "I re-read this and it stands" — records a review without editing anything. */
  const markReviewed = useCallback(
    async (symbol: string) => {
      try {
        const res = await fetch("/api/watchlist", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ symbol, reviewed: true }),
        });
        if (!res.ok) throw new Error();
        setItems((prev) => prev.map((i) => (i.symbol === symbol ? { ...i, lastReviewedAt: Date.now() } : i)));
        toast(`${symbol} marked reviewed`);
      } catch {
        toast(`Could not mark ${symbol} reviewed`, "error");
      }
    },
    [toast],
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
        const symbolPulse = pulse?.symbols[item.symbol.toUpperCase()] ?? null;
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
          pulse: symbolPulse,
          /* Live price signals fused with the server pulse, per render — the
             same pure function the tests pin, so a crossed target registers on
             the next quote tick without waiting for a server round-trip. */
          attention: computeAttention({
            price,
            changePercent,
            targetPrice: item.targetPrice,
            direction,
            pulse: symbolPulse,
            thresholds: {
              bigMovePct: settings.bigMovePct,
              earningsSoonDays: settings.earningsHorizonDays,
            },
          }),
          earningsIn: daysUntil(symbolPulse?.earningsDate ?? null),
          targetDistance: distanceToTargetPercent(price, item.targetPrice, direction),
        };
      }),
    [items, quotes, fitScores, fitData, ownedSymbols, benchmarkChange, benchmarkSymbol, moved, pulse, settings],
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
        case "attention": if (r.attention.level === "quiet") return false; break;
        case "alerts": if (r.alerts.length === 0) return false; break;
        case "owned": if (!r.owned) return false; break;
        case "not-owned": if (r.owned) return false; break;
        case "near-target":
          if (r.targetDistance == null || r.targetDistance > TARGET_NEAR_PCT) return false;
          break;
        case "earnings":
          if (r.earningsIn == null || r.earningsIn < 0 || r.earningsIn > settings.earningsHorizonDays) return false;
          break;
        case "high-conviction": if (r.item.conviction !== "high") return false; break;
        case "no-thesis": if (r.item.notes || r.item.buyTrigger || r.item.sellTrigger) return false; break;
        case "no-target": if (r.item.targetPrice != null) return false; break;
        case "stale":
          // The same judgment computeWatchlistHealth counts, per row.
          if (
            !isStaleReview({
              notes: r.item.notes || r.item.buyTrigger || r.item.sellTrigger || null,
              targetPrice: r.item.targetPrice,
              lastReviewedAt: r.item.lastReviewedAt,
              addedAt: r.item.addedAt,
            })
          )
            return false;
          break;
        default: break;
      }
      if (tokens.length === 0) return true;
      const haystack = `${r.item.symbol} ${r.item.name}`.toLowerCase();
      return tokens.some((t) => haystack.includes(t));
    });
  }, [rows, filter, quickFilter, settings.earningsHorizonDays]);

  const alertCount = useMemo(() => rows.reduce((n, r) => n + r.alerts.length, 0), [rows]);

  /* ---------------------------------------------------------------------- */
  /* Triage: attention queue, since-visit summary, list health               */
  /* ---------------------------------------------------------------------- */

  const attentionRows = useMemo<PulseBriefRow[]>(
    () =>
      rows
        .filter((r) => r.attention.level !== "quiet")
        .sort((a, b) => b.attention.score - a.attention.score)
        .slice(0, 7)
        .map((r) => ({ symbol: r.item.symbol, name: r.item.name, attention: r.attention })),
    [rows],
  );

  const sinceVisit = useMemo(() => summarizeSinceVisit(rows.map((r) => r.attention)), [rows]);

  const health = useMemo(
    () =>
      computeWatchlistHealth(
        items.map((i) => ({
          // Triggers count as a thesis for health purposes — mirrored in the filters.
          notes: i.notes || i.buyTrigger || i.sellTrigger || null,
          targetPrice: i.targetPrice,
          lastReviewedAt: i.lastReviewedAt,
          addedAt: i.addedAt,
        })),
      ),
    [items],
  );

  /** Open one name's decision file from the attention queue. */
  const openRow = useCallback(
    (symbol: string) => {
      // The row must actually be on screen to expand: a maintenance filter or a
      // text search that hides it would leave the click doing nothing.
      setFilter("");
      if (quickFilter !== "all" && quickFilter !== "attention") setQuickFilter("all");
      setExpandedRow(symbol);
      // The row may not be mounted yet (filter reset re-renders; long lists
      // window their rows), so retry across a few frames rather than assuming
      // one commit is enough. Give up silently — the row is expanded either way.
      let attempts = 12;
      const tryScroll = () => {
        const el = document.querySelector(`tr[data-row-id="${CSS.escape(symbol)}"]`);
        if (el) el.scrollIntoView({ block: "center", behavior: "smooth" });
        else if (--attempts > 0) requestAnimationFrame(tryScroll);
      };
      requestAnimationFrame(tryScroll);
    },
    [quickFilter, setQuickFilter],
  );
  const stats = useMemo(() => {
    let gainers = 0;
    let losers = 0;
    let priced = 0;
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
      if (r.upside != null && r.direction === "above") {
        exitUpsideSum += r.upside;
        exitUpsideCount += 1;
      }
    }
    return {
      gainers,
      losers,
      priced,
      exitUpside: exitUpsideCount > 0 ? exitUpsideSum / exitUpsideCount : null,
      exitUpsideCount,
    };
  }, [filteredRows]);

  const hasPortfolio = Boolean(ios?.profileReady && ios.profile.hasPortfolio);

  /**
   * The active sort, fully controlled. Resolution order:
   *
   * 1. An explicit header click (persisted, so `sortKey` is non-empty).
   * 2. The configured default from Customize.
   * 3. Attention — the page's whole thesis is "what deserves a look reads
   *    first", and the triage panel above explains WHY each top row ranks
   *    where it does. Quiet rows tie at null and keep list order.
   *
   * A default that points at a hidden column would silently sort nothing, so
   * those fall through to the next rung.
   */
  const hidden = settings.hiddenColumns;
  const effectiveSortKey =
    sortKey ||
    (settings.defaultSortKey && !hidden.includes(settings.defaultSortKey) ? settings.defaultSortKey : "") ||
    (!hidden.includes("attention") ? "attention" : hasPortfolio && !hidden.includes("fit") ? "fit" : "symbol");
  /* The persisted direction belongs to the user's own header click. A default
     sort uses its column's natural first direction instead — "Next event"
     defaulting to farthest-first because the last click happened to be
     descending would be nonsense. */
  const effectiveSortDir: SortDir = sortKey
    ? sortDir
    : effectiveSortKey === "symbol" || effectiveSortKey === "nextEvent"
      ? "asc"
      : "desc";

  /**
   * The columns.
   *
   * Memoized on the derived rows, which is what makes the table's internal sort
   * memo work at all: it depends on `columns` identity, and a literal array in
   * the render body invalidated it on every keystroke and every state change.
   */
  const columns = useMemo<DataTableColumn<Row>[]>(
    () => [
      /* The attention verdict as its own narrow, sortable column: the dot's
         tooltip carries the reasons, sorting it ranks the whole table by "who
         needs me", and this is also the smart default sort. Kept out of the
         symbol cell so the ticker column says exactly one thing. */
      {
        key: "attention",
        label: "",
        help: "Attention — why this name needs a look right now. Hover a dot for the reasons; sort to rank the whole list by urgency. Quiet rows show nothing, which is the good outcome.",
        sortValue: (r) => (r.attention.score > 0 ? r.attention.score : null),
        render: (r) =>
          r.attention.level === "quiet" ? null : (
            <span
              title={r.attention.signals.map((s) => s.label).join(" · ")}
              aria-label={`Needs attention: ${r.attention.signals.map((s) => s.label).join(", ")}`}
              className={`inline-block h-1.5 w-1.5 rounded-full ${
                r.attention.level === "act" ? "bg-alert" : "bg-warning"
              }`}
            />
          ),
      },
      {
        key: "symbol",
        label: "Symbol",
        firstSortDir: "asc",
        sortValue: (r) => r.item.symbol,
        /* Just the ticker and the name. Ownership lives in the Stage column
           (an owned name's stage IS "Owned"), alert state in the attention
           column, row tone and target cell, thesis in its own column — the
           badge cluster that used to live here said everything twice. */
        render: (r) => (
          <span className="flex flex-col gap-0.5">
            <Link
              href={`/research?symbol=${r.item.symbol}`}
              onClick={(e) => e.stopPropagation()}
              className="self-start rounded-control font-mono text-sm font-semibold text-brand hover:underline"
            >
              {r.item.symbol}
            </Link>
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
        help: "Your own price target for this name, and the level its alert fires at — never the analyst consensus. Click a value to edit it. \"Reached\" and \"near\" show where the price stands against it.",
        sortValue: (r) => r.item.targetPrice,
        /* The whole cell is the edit affordance — a target is the row's most
           edited field, and reaching it through the overflow menu was three
           clicks for a one-number change. The cell also SAYS where the price
           stands: reached / near / the level with its trigger direction. */
        render: (r) => {
          if (r.item.targetPrice == null) {
            // An unset user-editable field deserves an affordance, not a dash.
            return (
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
            );
          }
          const reached = r.targetDistance === 0;
          const near = !reached && r.targetDistance != null && r.targetDistance <= TARGET_NEAR_PCT;
          return (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setEditingTarget(r.item);
              }}
              title={`Alert fires when the price ${r.direction === "above" ? "rises to or above" : "falls to or below"} this level.${
                near ? ` ${r.targetDistance!.toFixed(1)}% away.` : ""
              } Click to edit.`}
              className="group inline-flex items-baseline gap-1 rounded-control font-mono tabular-nums transition-colors hover:text-brand"
            >
              {formatCurrency(r.item.targetPrice, r.currency)}
              {reached ? (
                <span
                  className={`font-sans text-[9px] font-bold uppercase tracking-wide ${
                    r.direction === "below" ? "text-positive" : "text-warning"
                  }`}
                >
                  reached
                </span>
              ) : near ? (
                <span className="font-sans text-[9px] font-bold uppercase tracking-wide text-warning">near</span>
              ) : (
                <span aria-hidden="true" className="font-sans text-[9px] text-muted/50">
                  {r.direction === "above" ? "▲" : "▼"}
                </span>
              )}
            </button>
          );
        },
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
         mistaken for one another. ONE column, not two: the level and its upside
         are one fact about the street's view, and it sorts by the upside because
         that is the only leg comparable across names. */
      {
        key: "consensus",
        label: "Consensus",
        numeric: true,
        help: "Mean analyst target and the return it implies from today's price — the street's view, never yours. Sorts by the implied return. Hover for the analyst count and range. Blank when no analyst covers the name.",
        sortValue: (r) => r.consensusUpside ?? r.consensus.mean,
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
              className="inline-flex items-baseline gap-1.5 text-muted"
            >
              {formatCurrency(r.consensus.mean, r.currency)}
              {r.consensusUpside != null && (
                <span className={`text-[11px] ${toneClass(r.consensusUpside)}`}>
                  {formatPercent(r.consensusUpside)}
                </span>
              )}
            </span>
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
        help: "Where this idea is in your process: Surfaced → Researching → Thesis → Owned, or Passed / Exited. Owned means held in your portfolio right now — this column is the ownership indicator. The same field the Portfolio pipeline board edits.",
        // Sorted by funnel position rather than alphabetically, so the order on
        // screen is the order of the process. Rendered through effectiveStage so
        // a name the ledger currently holds ALWAYS reads Owned, even if the
        // stored stage lags a trade — this column is where ownership lives.
        sortValue: (r) => IDEA_STAGES.indexOf(effectiveStage(r.item.stage, r.owned)),
        firstSortDir: "asc",
        render: (r) => <StageBadge stage={effectiveStage(r.item.stage, r.owned)} />,
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
      /* Replaced "Added": how long a name has sat on the list is drawer
         material, but WHEN the next scheduled information arrives — earnings —
         is a monitoring decision input, so it earns the column. */
      {
        key: "nextEvent",
        label: "Next event",
        numeric: true,
        help: "The next scheduled earnings date from the calendar, when one is known. Sorted soonest first; click through for the full event calendar.",
        firstSortDir: "asc",
        sortValue: (r) => (r.earningsIn != null && r.earningsIn >= 0 ? r.earningsIn : null),
        render: (r) =>
          r.pulse?.earningsDate && r.earningsIn != null && r.earningsIn >= 0 ? (
            <Link
              href="/calendar"
              onClick={(e) => e.stopPropagation()}
              title={`Earnings ${formatDate(r.pulse.earningsDate)} — open the event calendar`}
              className={`rounded-control underline-offset-2 hover:underline ${
                r.earningsIn <= settings.earningsHorizonDays ? "font-medium text-warning" : "text-muted"
              }`}
            >
              {r.earningsIn === 0 ? "Earnings today" : r.earningsIn === 1 ? "Earnings tmrw" : `Earnings ${r.earningsIn}d`}
            </Link>
          ) : (
            <span className="text-muted/40">—</span>
          ),
        hideBelow: "lg",
      },
      {
        key: "notes",
        label: "Thesis",
        // Sorted by conviction, then by whether a thesis exists at all —
        // "which names have I never written up" and "where am I most sure"
        // are the useful questions; ranking notes A→Z answers nothing.
        help: "Your written reason for watching this, with your recorded conviction. Sorts highest-conviction first, never-written-up last.",
        sortValue: (r) => {
          const conviction = r.item.conviction === "high" ? 3 : r.item.conviction === "medium" ? 2 : r.item.conviction === "low" ? 1 : 0;
          const hasThesis = r.item.notes || r.item.buyTrigger || r.item.sellTrigger ? 1 : 0;
          return conviction * 10 + hasThesis;
        },
        // No `block` on the clamped span: it would override line-clamp's
        // `display: -webkit-box` and let a long thesis wrap the row hundreds
        // of pixels tall (2026-08-10 visual audit).
        render: (r) => {
          const text = r.item.notes ?? r.item.buyTrigger;
          if (!text && !r.item.conviction) return <span className="text-muted/40">—</span>;
          return (
            <span className="flex items-center gap-1.5">
              {r.item.conviction && (
                <span
                  title={`${CONVICTION_WORD[r.item.conviction]} conviction`}
                  aria-label={`${CONVICTION_WORD[r.item.conviction]} conviction`}
                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${CONVICTION_DOT[r.item.conviction]}`}
                />
              )}
              {text ? (
                <span className="line-clamp-1 max-w-44 text-[11px] italic text-muted/80" title={text}>
                  {text}
                </span>
              ) : (
                <span className="text-muted/40">—</span>
              )}
            </span>
          );
        },
        hideBelow: "xl",
      },
    ],
    [hasPortfolio, benchmarkSymbol, settings.earningsHorizonDays],
  );

  /* Column visibility is a view preference; the definitions above stay complete
     so hiding and re-showing never loses configuration. */
  const visibleColumns = useMemo(
    () =>
      settings.hiddenColumns.length === 0
        ? columns
        : columns.filter((c) => !settings.hiddenColumns.includes(c.key)),
    [columns, settings.hiddenColumns],
  );

  const stickyHeight = filteredRows.length > STICKY_AFTER_ROWS ? "min(72vh, 900px)" : undefined;

  /* Onboarding copy earns its space only until the user has data. */
  const showHint = items.length > 0 && items.length <= 3;

  // Scoped to current `items`, not all of `quotes` — removing a symbol doesn't
  // prune its stale quote from state, so counting every cached quote would
  // keep a removed stock's gain/loss in the summary strip until next reload.
  const trackedQuotes = items.map((i) => quotes[i.symbol]).filter((q): q is Quote => q != null);
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
          <button
            onClick={() => { void load(); void loadPulse(); refreshNow(); }}
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

      {/* Results season for Indian watchlist names (renders nothing otherwise) */}
      {!loading && items.length > 0 && <ResultsRadar />}

      {/* The triage layer: what changed since the last visit, and which names
          need attention now. Reads before the table because it IS the reading
          order — the table is for everything else. */}
      {!loading && items.length > 0 && (
        <Reveal index={1}>
          <PulseBrief
            rows={attentionRows}
            summary={sinceVisit}
            baselineAt={pulse?.baselineAt ?? null}
            firstVisit={pulse?.firstVisit ?? false}
            loading={pulseLoading}
            error={pulseError}
            checkingCount={pulse?.checking.length ?? 0}
            onOpenRow={openRow}
            onShowAll={() => setQuickFilter("attention")}
          />
        </Reveal>
      )}

      {/* Summary strip */}
      {!loading && items.length > 0 && hasQuotes && (
        <Reveal index={2} className="flex flex-wrap items-center gap-4 rounded-xl border border-border bg-surface px-5 py-3">
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
          {/* "Targets set" and "Alerts firing" used to sit here too. Both said
              something another element already says better: the health line
              counts missing targets (and filters to them), and the header chip
              counts firing alerts (and filters to them). A strip stat that
              cannot be acted on is decoration. */}
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
        </Reveal>
      )}

      {/* AI Watchlist Intelligence — OPT-IN. Generation is user-triggered (the
          panel's idle state carries the button) rather than auto-firing on load:
          this is local inference on every tracked name, and opening a page is not
          a request to spend it. The same control regenerates afterwards, which is
          also the only way the digest can reflect symbols added since it ran. */}
      {!loading && items.length > 0 && (
        <Reveal index={3}>
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
        <Reveal index={4}>
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
            {/* The configured chips (Customize decides which and in what
                order); any other filter — reached from the health line or a
                stale config — appears as a chip only while active, with an
                explicit way back. */}
            {[...settings.quickFilters, ...(settings.quickFilters.includes(quickFilter) ? [] : [quickFilter])].map(
              (qf) => (
                <button
                  key={qf}
                  type="button"
                  onClick={() => setQuickFilter(quickFilter === qf && qf !== "all" ? "all" : qf)}
                  aria-pressed={quickFilter === qf}
                  className={`rounded-lg border px-2.5 py-1.5 text-xs transition-colors ${
                    quickFilter === qf
                      ? "border-brand/40 bg-brand/10 text-brand"
                      : "border-border text-muted hover:bg-surface-2 hover:text-foreground"
                  }`}
                >
                  {FILTER_LABEL[qf]}
                  {quickFilter === qf && qf !== "all" && <span className="ml-1 opacity-70">×</span>}
                </button>
              ),
            )}
          </div>
          <WatchlistSettings settings={settings} onChange={setStoredSettings} />
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
          columns={visibleColumns}
          sortKey={effectiveSortKey}
          sortDir={effectiveSortDir}
          onSortChange={(key, dir) => { setSortKey(key); setSortDir(dir); }}
          density={density}
          onDensityChange={setDensity}
          maxBodyHeight={stickyHeight}
          expandedKey={expandedRow}
          onExpandedChange={setExpandedRow}
          rowTone={(r) =>
            r.alerts.length > 0 || r.attention.level === "act"
              ? "alert"
              : r.attention.level === "watch"
                ? "watch"
                : "default"
          }
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
                  ? <>Nothing matches “{filter}” within <span className="text-foreground">{FILTER_LABEL[quickFilter]}</span>.</>
                  : filter
                    ? <>Nothing matches “{filter}”.</>
                    : <>No name currently <span className="text-foreground">{FILTER_EMPTY[quickFilter]}</span>.</>}
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
              <DataTableAction onClick={() => setEditingThesis(r.item)}>
                {r.item.notes || r.item.buyTrigger || r.item.sellTrigger ? "Edit thesis…" : "Write thesis…"}
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
              pulse={r.pulse}
              checking={pulse?.checking.includes(r.item.symbol.toUpperCase()) ?? false}
              revisionCount={r.item.targetRevisionCount ?? 0}
              onEditTarget={() => setEditingTarget(r.item)}
              onEditThesis={() => setEditingThesis(r.item)}
              onMarkReviewed={() => void markReviewed(r.item.symbol)}
            />
          )}
        />
      )}

      {/* List health: the maintenance debt this list is carrying, said once and
          made actionable. Each count is a filter, so noticing IS fixing. */}
      {!loading && items.length > 3 && (health.noThesis > 0 || health.noTarget > 0 || health.staleReview > 0) && (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
          <span className="text-label font-semibold uppercase tracking-widest text-muted/60">List health</span>
          {(
            [
              { key: "no-thesis" as const, count: health.noThesis, label: "without a thesis" },
              { key: "no-target" as const, count: health.noTarget, label: "without a target" },
              { key: "stale" as const, count: health.staleReview, label: `not reviewed in ${STALE_REVIEW_DAYS}d` },
            ] as const
          )
            .filter((h) => h.count > 0)
            .map((h, i) => (
              <span key={h.key} className="flex items-center gap-2">
                {i > 0 && <span aria-hidden="true" className="text-muted/40">·</span>}
                <button
                  type="button"
                  onClick={() => setQuickFilter(quickFilter === h.key ? "all" : h.key)}
                  aria-pressed={quickFilter === h.key}
                  className={`rounded-control underline-offset-2 transition-colors hover:text-brand hover:underline ${
                    quickFilter === h.key ? "text-brand" : ""
                  }`}
                >
                  {h.count} {h.label}
                </button>
              </span>
            ))}
        </p>
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

      {editingThesis && (
        <ThesisModal
          item={editingThesis}
          onSave={async (patch: ThesisPatch) => {
            await patchItem(editingThesis.symbol, patch);
            setEditingThesis(null);
            toast(patch.notes || patch.buyTrigger || patch.sellTrigger ? "Thesis saved" : "Thesis cleared");
          }}
          onCancel={() => setEditingThesis(null)}
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
