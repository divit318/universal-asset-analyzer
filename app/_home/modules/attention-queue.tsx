"use client";

/**
 * The Attention Queue — the Desk's centerpiece (§4.2).
 *
 * One ranked, finishable stream that merges what used to be six sibling lists
 * (recommended-actions, threat-center, intelligence-feed, timeline,
 * upcoming-events, and the alert half of watchlist-intelligence) into a single
 * card of rows. Ranking is the product: `lib/home/attention.ts` scores every
 * item on one contract, so importance is comparable across kinds. Dismissal is
 * state — it persists (§13), so unseen items are meaningful and *zero is
 * reachable*. The clear state is the reward loop.
 *
 * Not a ModuleShell: like the hero, this is a bespoke surface. Rows live inside
 * ONE `.uaa-card` (§16 — panel-per-item would rebuild the clutter this removes).
 * It selects its slice via `useHomeSlice`, so it fetches nothing and paints from
 * the deterministic digest with no AI in its path (§18, §19.8).
 *
 * The number on every rail is the PRIORITY score (the §4.2 geometric ranking:
 * impact^0.5 × urgency^0.3 × confidence^0.2, 0–100). It is deliberately a
 * different scale from the Radar's fit score beside it — priority ranks how
 * urgently an item needs a decision; fit ranks how good an idea is for this
 * book. Both panels label their scale so the same ticker carrying two numbers
 * reads as two measurements, not one metric disagreeing with itself.
 */

import { createElement, useCallback, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  BarChart3,
  Bell,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronRight,
  CircleDollarSign,
  Crosshair,
  Percent,
  PieChart,
  ShieldAlert,
  SlidersHorizontal,
  TrendingDown,
  TrendingUp,
  X,
  type LucideIcon,
} from "lucide-react";
import { useToast } from "@/app/_components/toast";
import type { AttentionItem, AttentionKind, RecommendedAction, SymbolContext } from "@/lib/home/contracts";
import { explainAttentionScore, explainDecision } from "@/lib/home/explain";
import { priorityBucket } from "@/lib/home/attention";
import { STAGE_LABEL } from "@/lib/idea-stage";
import { SymbolTag } from "../_atmosphere/symbol-link";
import { ExplainableValue } from "../_atmosphere/explain-popover";
import { CategoryPill, IconWell, NumericText, StatusChip, type PillTone } from "../_atmosphere/stream-primitives";
import { useHome, useHomeSlice } from "../home-provider";
import { Skeleton } from "@/app/_components/ui";

const MAX_VISIBLE = 8;
const UNDO_MS = 10_000;
const EXIT_MS = 150;

const KINDS: AttentionKind[] = ["action", "threat", "alert", "event", "signal"];
const FILTERS: (AttentionKind | "all")[] = ["all", ...KINDS];
const KIND_LABEL: Record<AttentionKind, string> = {
  action: "Action",
  threat: "Threat",
  alert: "Alert",
  event: "Event",
  signal: "Signal",
};

/** Kind chip tone — the semantic palette shared with the Radar (§16). Text
 *  label always present so kind is never conveyed by colour alone (§17). */
function kindTone(kind: AttentionKind, score: number): PillTone {
  switch (kind) {
    case "threat":
      return score >= 80 ? "negative" : "warning";
    case "signal":
      return "positive";
    case "event":
      return "neutral";
    case "alert":
      return "alert"; // violet — a tripwire the user set has fired
    default:
      return "blue"; // action — the engine proposes a move
  }
}

/** The icon well's 10%-tint background + full-saturation glyph, by tone. */
const ICON_TONE: Record<PillTone, string> = {
  positive: "bg-positive/10 text-positive",
  warning: "bg-warning/10 text-warning",
  negative: "bg-negative/10 text-negative",
  blue: "bg-chart-2/10 text-chart-2",
  alert: "bg-alert/10 text-alert",
  neutral: "bg-muted/10 text-muted",
  brand: "bg-brand/10 text-brand",
};

/** Fallback category glyph per kind; threats refine by their engine category
 *  (parsed from the seed id — `threat:<category>-…`), since the digest carries
 *  no sector for queue items. */
const KIND_GLYPH: Record<AttentionKind, LucideIcon> = {
  signal: TrendingUp,
  threat: ShieldAlert,
  action: BarChart3,
  alert: Bell,
  event: CalendarDays,
};

const THREAT_GLYPH: [RegExp, LucideIcon][] = [
  [/currency/, CircleDollarSign],
  [/conc(entration)?|correlation/, PieChart],
  [/rates|inflation/, Percent],
  [/drawdown/, TrendingDown],
];

function glyphFor(item: AttentionItem): LucideIcon {
  if (item.kind === "threat") {
    // Seed ids carry the engine's threat id, e.g. `threat:threat-currency` or
    // `threat:threat-conc-currency-0` (lib/home/threats.ts) — the only category
    // signal the digest ships for a queue row.
    for (const [re, icon] of THREAT_GLYPH) if (re.test(item.id)) return icon;
  }
  return KIND_GLYPH[item.kind];
}

/** Renders the row's category glyph. All candidates are static module-level
 *  lucide components; `createElement` keeps that legible to the linter. */
function CategoryGlyph({ item }: { item: AttentionItem }) {
  return createElement(glyphFor(item), { className: "h-4.5 w-4.5", strokeWidth: 2 });
}

/** Ticker-first titles, always: when the headline already leads with the
 *  symbol, the symbol becomes the linkable tag and the remainder follows;
 *  otherwise the tag is prepended. Symbol-less items lead with their subject. */
function RowTitle({ item, className }: { item: AttentionItem; className: string }) {
  const symbol = item.symbol;
  if (!symbol) {
    return (
      <span className={className}>
        <NumericText text={item.headline} />
      </span>
    );
  }
  const leads = item.headline.toUpperCase().startsWith(symbol.toUpperCase());
  const rest = leads ? item.headline.slice(symbol.length).trimStart() : item.headline;
  return (
    <span className={`min-w-0 ${className}`}>
      <SymbolTag symbol={symbol} className="font-mono">
        {symbol}
      </SymbolTag>{" "}
      <NumericText text={rest} />
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Context chips — what the platform already knows about this symbol   */
/* ------------------------------------------------------------------ */

function daysAgo(iso: string): string {
  const days = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return `${days}d ago`;
}

/**
 * The unified-intelligence join, rendered: held weight, pipeline stage, and
 * research recency for the row's symbol. Absence renders nothing — an item
 * the platform has no history with simply has no chips. Sentence case
 * throughout.
 */
function contextChips(ctx: SymbolContext | undefined): string[] {
  if (!ctx) return [];
  const chips: string[] = [];
  if (ctx.heldWeightPct != null) chips.push(`${ctx.heldWeightPct.toFixed(1)}% of book`);
  if (ctx.watchlistStage && ctx.heldWeightPct == null) chips.push(STAGE_LABEL[ctx.watchlistStage] ?? ctx.watchlistStage);
  if (ctx.lastResearchedAt) chips.push(`Researched ${daysAgo(ctx.lastResearchedAt)}`);
  return chips;
}

function ContextChips({ ctx }: { ctx: SymbolContext | undefined }) {
  const chips = contextChips(ctx);
  if (chips.length === 0) return null;
  return (
    <span className="flex shrink-0 flex-wrap items-center gap-1">
      {chips.map((c) => (
        <StatusChip key={c}>
          <NumericText text={c} />
        </StatusChip>
      ))}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Spotlight — the queue's #1 item, promoted to "next best step"       */
/* ------------------------------------------------------------------ */

/**
 * The decision dashboard's answer to "if I do one thing, what is it?". The
 * top-ranked item renders large: full rationale, explainable score, and — when
 * the item is a decision the engine actually simulated — the measured
 * before → after portfolio state and the full WHY memo. Everything shown is
 * data the digest already carried; promotion is presentation, not re-ranking.
 */
function SpotlightCard({
  item,
  decision,
  active,
  exiting,
  onFocus,
  onDismiss,
  registerRef,
}: RowProps & { decision: RecommendedAction | null }) {
  const [showWhy, setShowWhy] = useState(false);
  const impact = decision?.impact ?? null;
  // Each number explains ITSELF: the ranking score decomposes into the
  // attention formula; the simulated deltas decompose into the decision memo.
  const decisionExplanation = decision ? explainDecision(decision) : null;

  return (
    <li
      ref={registerRef}
      tabIndex={active ? 0 : -1}
      onFocus={onFocus}
      className={`group relative mx-5 mt-5 flex flex-col gap-3 overflow-hidden rounded-xl border border-brand/35 bg-gradient-to-br from-brand/[0.06] to-transparent p-5 outline-none transition-colors focus-visible:border-brand/50 focus-visible:ring-2 focus-visible:ring-brand/30 ${
        exiting ? "uaa-queue-exit" : ""
      }`}
    >
      {/* Row 1 — section label · kind pill · priority score · dismiss */}
      <div className="flex items-center gap-2">
        <span className="text-caption font-semibold uppercase tracking-[0.08em] text-muted">Next best step</span>
        <CategoryPill tone={kindTone(item.kind, item.score)} ariaLabel={`Category: ${KIND_LABEL[item.kind]}`}>
          {KIND_LABEL[item.kind]}
        </CategoryPill>
        <span className="min-w-0 flex-1" />
        <span className="text-label uppercase tracking-[0.08em] text-muted">Priority</span>
        {/* The BAND, not the raw score (audit DU-01/DU-02): single-point
            differences carry no information; the number lives in the
            decomposition popover. */}
        <ExplainableValue explanation={explainAttentionScore(item)} align="end" underline={false}>
          <span
            className="text-[15px] font-semibold leading-none text-foreground"
            aria-label={`Priority: ${priorityBucket(item.score).label}`}
          >
            {priorityBucket(item.score).label}
          </span>
        </ExplainableValue>
        <button
          type="button"
          onClick={onDismiss}
          aria-label={`Dismiss ${item.headline}`}
          className="shrink-0 rounded-control p-1 text-foreground/40 outline-none transition-colors hover:bg-surface-3 hover:text-foreground/70 focus-visible:ring-2 focus-visible:ring-brand/40"
        >
          <X className="h-4 w-4" strokeWidth={2} />
        </button>
      </div>

      {/* Row 2 — the headline, ticker-first */}
      <RowTitle item={item} className="text-[22px] font-semibold leading-snug text-foreground" />

      {/* Row 3 — the reason line */}
      <p className="text-sm leading-normal text-muted">
        <NumericText text={item.rationale} />
      </p>

      {/* Measured before → after, when the engine simulated this decision */}
      {impact ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-control border border-border/70 bg-surface/70 px-3 py-2">
          <span className="text-label font-semibold uppercase tracking-wide text-faint">If executed</span>
          <ExplainableValue explanation={decisionExplanation}>
            <span className="inline-flex items-center gap-1.5 font-mono text-xs tabular-nums">
              <span className="text-muted">Health {impact.healthBefore}</span>
              <ArrowRight className="h-3 w-3 text-faint" strokeWidth={2} />
              <span className={impact.healthDelta >= 0 ? "font-semibold text-positive" : "font-semibold text-negative"}>
                {impact.healthAfter}
              </span>
              <span className="text-faint">({impact.healthDelta >= 0 ? "+" : ""}{impact.healthDelta.toFixed(1)})</span>
            </span>
          </ExplainableValue>
          {impact.riskDeltaPp != null ? (
            <span className="font-mono text-xs tabular-nums text-muted">
              vol {impact.riskDeltaPp > 0 ? "+" : "−"}{Math.abs(impact.riskDeltaPp).toFixed(1)}pp
            </span>
          ) : null}
          {Math.abs(impact.incomeDeltaAnnual) >= 1 ? (
            <span className="font-mono text-xs tabular-nums text-muted">
              income {impact.incomeDeltaAnnual >= 0 ? "+" : "−"}${Math.abs(Math.round(impact.incomeDeltaAnnual)).toLocaleString()}/yr
            </span>
          ) : null}
          {decision?.alternativesEvaluated ? (
            <span className="text-label text-faint">{decision.alternativesEvaluated} alternatives simulated</span>
          ) : null}
        </div>
      ) : null}

      {/* The WHY memo, verbatim from the engine */}
      {decision?.why ? (
        <div className="flex flex-col gap-1.5">
          <button
            type="button"
            onClick={() => setShowWhy((s) => !s)}
            aria-expanded={showWhy}
            className="inline-flex w-fit items-center gap-1 rounded-control text-caption font-semibold text-foreground/75 outline-none transition-colors hover:text-brand focus-visible:ring-2 focus-visible:ring-brand/40"
          >
            <ChevronRight className={`h-3.5 w-3.5 transition-transform ${showWhy ? "rotate-90" : ""}`} strokeWidth={2} />
            Why this, why now
          </button>
          {showWhy ? (
            <dl className="flex flex-col gap-1.5 border-l-2 border-brand/20 pl-3 text-caption leading-relaxed text-muted">
              <div><dt className="inline font-semibold text-foreground/80">Why now: </dt><dd className="inline">{decision.why.whyNow}</dd></div>
              <div><dt className="inline font-semibold text-foreground/80">Sizing: </dt><dd className="inline">{decision.why.whyThisAmount}</dd></div>
              <div><dt className="inline font-semibold text-foreground/80">Vs. alternatives: </dt><dd className="inline">{decision.why.whyNotAlternative}</dd></div>
              <div><dt className="inline font-semibold text-foreground/80">Vs. doing nothing: </dt><dd className="inline">{decision.why.whyNotNothing}</dd></div>
            </dl>
          ) : null}
        </div>
      ) : null}

      {/* Row 4 — the primary action */}
      <div className="flex items-center gap-3">
        <Link
          href={item.primaryAction.href}
          className="inline-flex items-center gap-1.5 rounded-control bg-brand px-5 py-3 text-sm font-semibold leading-none text-background shadow-sm outline-none transition-colors hover:bg-brand-strong focus-visible:ring-2 focus-visible:ring-brand/40"
        >
          {item.primaryAction.label} <ArrowRight className="h-3.5 w-3.5" strokeWidth={2.5} />
        </Link>
        {item.mergedHrefs?.map((m) => (
          <Link key={m.href} href={m.href} className="text-caption font-medium text-muted outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-brand/40">
            {m.label} →
          </Link>
        ))}
      </div>
    </li>
  );
}

/* ------------------------------------------------------------------ */
/* Row                                                                 */
/* ------------------------------------------------------------------ */

interface RowProps {
  item: AttentionItem;
  index: number;
  active: boolean;
  exiting: boolean;
  onFocus: () => void;
  onDismiss: () => void;
  registerRef: (el: HTMLLIElement | null) => void;
}

function QueueRow({
  item,
  index,
  active,
  exiting,
  onFocus,
  onDismiss,
  registerRef,
  ctx,
}: RowProps & { ctx: SymbolContext | undefined }) {
  const tone = kindTone(item.kind, item.score);
  const chips = contextChips(ctx);

  return (
    <li
      ref={registerRef}
      tabIndex={active ? 0 : -1}
      onFocus={onFocus}
      className={`uaa-linkable group px-6 outline-none transition-colors hover:bg-foreground/[0.03] focus-visible:bg-foreground/[0.03] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand/30 ${
        exiting ? "uaa-queue-exit" : ""
      }`}
    >
      <div
        className={`grid grid-cols-[40px_minmax(0,1fr)] items-start gap-4 py-4.5 sm:grid-cols-[40px_minmax(0,1fr)_auto_auto] ${
          index > 1 ? "border-t border-hairline" : ""
        }`}
      >
        {/* Col 1 — category icon */}
        <IconWell toneClass={ICON_TONE[tone]}>
          <CategoryGlyph item={item} />
        </IconWell>

        {/* Col 2 — pill · title, then the reason */}
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <CategoryPill tone={tone} ariaLabel={`Category: ${KIND_LABEL[item.kind]}`}>
              {KIND_LABEL[item.kind]}
            </CategoryPill>
            <RowTitle item={item} className="text-base font-semibold leading-snug text-foreground" />
          </div>
          <p className="line-clamp-2 text-sm leading-normal text-muted">
            <NumericText text={item.rationale} />
          </p>
        </div>

        {/* Col 3 — status chips. Omitted entirely when there are none. */}
        {chips.length > 0 ? (
          <div className="col-start-2 flex flex-wrap items-center gap-1 sm:col-start-3">
            <ContextChips ctx={ctx} />
          </div>
        ) : null}

        {/* Col 4 — the fixed rail: priority score + dismiss, then the action */}
        <div className="col-start-2 flex flex-col items-start gap-1 sm:col-start-4 sm:w-[120px] sm:items-end">
          <span className="flex items-center gap-1.5">
            <ExplainableValue explanation={explainAttentionScore(item)} align="end" underline={false}>
              <span
                className="text-[13px] font-semibold leading-none text-foreground/85"
                aria-label={`Priority: ${priorityBucket(item.score).label}`}
              >
                {priorityBucket(item.score).label}
              </span>
            </ExplainableValue>
            <button
              type="button"
              onClick={onDismiss}
              aria-label={`Dismiss ${item.headline}`}
              className="shrink-0 rounded-control p-0.5 text-foreground/35 outline-none transition-colors hover:bg-surface-3 hover:text-foreground/70 focus-visible:ring-2 focus-visible:ring-brand/40"
            >
              <X className="h-3.5 w-3.5" strokeWidth={2} />
            </button>
          </span>
          <Link
            href={item.primaryAction.href}
            className="group/link inline-flex items-center gap-1 rounded-control text-sm font-medium text-foreground/75 outline-none transition-colors hover:text-brand focus-visible:ring-2 focus-visible:ring-brand/40"
          >
            {item.primaryAction.label}
            <ArrowRight className="h-3.5 w-3.5 text-foreground/45 transition-colors group-hover/link:text-brand" strokeWidth={2} />
          </Link>
        </div>
      </div>
    </li>
  );
}

/* ------------------------------------------------------------------ */
/* Queue                                                               */
/* ------------------------------------------------------------------ */

export function AttentionQueueModule() {
  const state = useHomeSlice("attention");
  const pulse = useHomeSlice("portfolioPulse");
  const recommended = useHomeSlice("recommendedActions");
  const symbolContext = useHomeSlice("symbolContext");
  const { refreshDigest } = useHome();
  const toast = useToast();
  const router = useRouter();

  const [pending, setPending] = useState<Set<string>>(new Set()); // optimistically dismissed
  const [exiting, setExiting] = useState<Set<string>>(new Set()); // mid-animation
  const [filter, setFilter] = useState<AttentionKind | "all">("all");
  const [showFilters, setShowFilters] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  const rowRefs = useRef<(HTMLLIElement | null)[]>([]);
  const clearRef = useRef<HTMLDivElement | null>(null);

  const data = state.data;
  const loading = state.status === "loading" && !data;
  const noPortfolio = pulse.data?.status === "empty";

  // Live items: server list minus optimistic dismissals, minus filter.
  const liveItems = useMemo(
    () => (data?.items ?? []).filter((i) => !pending.has(i.dedupeKey)),
    [data, pending],
  );
  const filtered = useMemo(
    () => (filter === "all" ? liveItems : liveItems.filter((i) => i.kind === filter)),
    [liveItems, filter],
  );
  const visible = expanded ? filtered : filtered.slice(0, MAX_VISIBLE);
  const openCount = liveItems.length;
  const degraded = data?.degradedFeeders ?? [];

  // Join back to the decision engine's full memo: the actions feeder ids its
  // seeds `action:<recommendation.id>`, so the spotlight can recover the WHY
  // and the simulated before → after without the queue re-carrying them per row.
  const decisionById = useMemo(() => {
    const map = new Map<string, RecommendedAction>();
    for (const a of recommended.data?.actions ?? []) {
      if (a.source === "decision") map.set(`action:${a.id}`, a);
    }
    return map;
  }, [recommended.data]);

  const ctxFor = useCallback(
    (symbol: string | null): SymbolContext | undefined =>
      symbol ? symbolContext.data?.[symbol.toUpperCase()] : undefined,
    [symbolContext.data],
  );

  // The roving-tabindex cursor, clamped in range at render (never via an effect)
  // so a shrinking list can't leave it pointing past the end.
  const safeActive = visible.length === 0 ? 0 : Math.min(activeIndex, visible.length - 1);

  /* -------------------- dismiss / undo -------------------- */

  const dismiss = useCallback(
    (item: AttentionItem) => {
      const idx = visible.findIndex((i) => i.dedupeKey === item.dedupeKey);
      // Set when the persist fails BEFORE the exit animation finishes, so the
      // deferred hide below doesn't re-hide a row the rollback just restored.
      let failed = false;

      // 1. Animate out, then hide.
      setExiting((prev) => new Set(prev).add(item.dedupeKey));
      window.setTimeout(() => {
        setExiting((prev) => {
          const n = new Set(prev);
          n.delete(item.dedupeKey);
          return n;
        });
        if (failed) return;
        setPending((prev) => new Set(prev).add(item.dedupeKey));
        // Focus the row that slides into this slot, or the clear heading.
        window.requestAnimationFrame(() => {
          const next = rowRefs.current[idx] ?? rowRefs.current[Math.max(0, idx - 1)];
          if (next) next.focus();
          else clearRef.current?.focus();
        });
      }, EXIT_MS);

      // 2. Persist (optimistic). Roll back on failure.
      fetch("/api/home/attention/dismiss", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dedupeKey: item.dedupeKey, kind: item.kind, occursAt: item.occursAt, storyKey: item.storyKey ?? null }),
      })
        .then((res) => {
          if (!res.ok) throw new Error();
        })
        .catch(() => {
          failed = true;
          setPending((prev) => {
            const n = new Set(prev);
            n.delete(item.dedupeKey);
            return n;
          });
          toast("Couldn't dismiss — it's back in your queue", "error");
        });

      // 3. Undo toast (10s window).
      toast(`Dismissed "${item.headline}"`, "info", {
        durationMs: UNDO_MS,
        action: {
          label: "Undo",
          onClick: () => {
            fetch("/api/home/attention/dismiss", {
              method: "DELETE",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ dedupeKey: item.dedupeKey, storyKey: item.storyKey ?? null }),
            }).catch(() => {});
            setPending((prev) => {
              const n = new Set(prev);
              n.delete(item.dedupeKey);
              return n;
            });
          },
        },
      });
    },
    [visible, toast],
  );

  /* -------------------- keyboard (listbox) -------------------- */

  const focusRow = useCallback((i: number) => {
    const el = rowRefs.current[i];
    if (el) {
      el.focus();
      setActiveIndex(i);
    }
  }, []);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLUListElement>) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        focusRow(Math.min(safeActive + 1, visible.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        focusRow(Math.max(safeActive - 1, 0));
      } else if (e.key === "Enter") {
        const item = visible[safeActive];
        if (item) {
          e.preventDefault();
          router.push(item.primaryAction.href);
        }
      } else if (e.key === "Delete" || e.key === "Backspace") {
        const item = visible[safeActive];
        if (item) {
          e.preventDefault();
          dismiss(item);
        }
      } else if (e.key.toLowerCase() === "f" && openCount > 5) {
        e.preventDefault();
        setShowFilters(true);
        const cur = FILTERS.indexOf(filter);
        setFilter(FILTERS[(cur + 1) % FILTERS.length]);
      }
    },
    [safeActive, visible, focusRow, dismiss, router, filter, openCount],
  );

  /* -------------------- render -------------------- */

  const moreCount = filtered.length - MAX_VISIBLE;

  return (
    <div id="action-center" className="uaa-card scroll-mt-20 flex h-full flex-col">
      {/* Header — full-bleed bottom divider */}
      <div className="flex flex-col gap-1 border-b border-hairline p-6">
        <div className="flex items-center gap-2.5">
          <Crosshair className="h-4.5 w-4.5 shrink-0 text-brand" strokeWidth={2} aria-hidden />
          <h2 className="text-xl font-semibold leading-none text-foreground">Attention</h2>
          {data ? (
            <span className="font-mono text-sm tabular-nums text-muted" aria-live="polite">
              {openCount} open
            </span>
          ) : null}
          <span className="min-w-0 flex-1" />
          <button
            type="button"
            onClick={() => setShowFilters((s) => !s)}
            aria-expanded={showFilters}
            aria-label="Filter by kind"
            className="rounded-control p-1.5 text-foreground/40 outline-none transition-colors hover:text-foreground/70 focus-visible:ring-2 focus-visible:ring-brand/40"
          >
            <SlidersHorizontal className="h-4 w-4" strokeWidth={2} />
          </button>
        </div>
        <p className="text-sm text-muted">One ranked stream. Clear it, and you&apos;re done.</p>
      </div>

      {/* Filter chips */}
      {showFilters ? (
        <div className="flex flex-wrap gap-1.5 px-6 pt-4">
          {FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              aria-pressed={filter === f}
              onClick={() => setFilter(f)}
              className={`rounded-full px-2 py-0.5 text-caption font-medium capitalize outline-none transition-colors focus-visible:ring-2 focus-visible:ring-brand/40 ${
                filter === f ? "bg-brand/15 text-brand" : "bg-surface-2 text-muted hover:text-foreground"
              }`}
            >
              {f === "all" ? "All" : `${KIND_LABEL[f]}s`}
            </button>
          ))}
        </div>
      ) : null}

      {/* Body */}
      {loading ? (
        <div className="flex flex-col pb-4" aria-hidden>
          <div className="mx-5 mt-5 flex h-36 flex-col justify-between rounded-xl border border-hairline p-5">
            <Skeleton height="h-3" width="w-1/4" />
            <Skeleton height="h-6" width="w-1/2" />
            <Skeleton height="h-4" width="w-2/3" />
          </div>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="px-6">
              <div className={`grid grid-cols-[40px_minmax(0,1fr)_auto] items-start gap-4 py-4.5 ${i > 0 ? "border-t border-hairline" : ""}`}>
                <Skeleton height="h-9" width="w-9" radius="rounded-[10px]" />
                <div className="flex flex-col gap-1.5">
                  <Skeleton height="h-4" width="w-1/2" />
                  <Skeleton height="h-3.5" width="w-3/4" />
                </div>
                <div className="flex w-[120px] flex-col items-end gap-1.5">
                  <Skeleton height="h-4" width="w-8" />
                  <Skeleton height="h-3.5" width="w-20" />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : visible.length > 0 ? (
        <>
          {/* The rail column's persistent scale label (§ scoring): PRIORITY,
              distinct from the Radar's FIT. Each score decomposes on click. */}
          <div className="flex justify-end px-6 pt-3">
            <span
              className="pr-6 text-label font-semibold uppercase tracking-[0.08em] text-muted"
              title="Priority band: how urgently this item needs a decision. Ranked by a geometric blend of impact, urgency, and confidence. Click any band for its decomposition."
            >
              Priority
            </span>
          </div>
          <ul role="list" aria-label="Attention queue" onKeyDown={onKeyDown} className="flex flex-col">
            {visible.map((item, i) =>
              i === 0 ? (
                <SpotlightCard
                  key={item.dedupeKey}
                  item={item}
                  index={i}
                  decision={decisionById.get(item.id) ?? null}
                  active={i === safeActive}
                  exiting={exiting.has(item.dedupeKey)}
                  onFocus={() => setActiveIndex(i)}
                  onDismiss={() => dismiss(item)}
                  registerRef={(el) => {
                    rowRefs.current[i] = el;
                  }}
                />
              ) : (
                <QueueRow
                  key={item.dedupeKey}
                  item={item}
                  index={i}
                  ctx={ctxFor(item.symbol)}
                  active={i === safeActive}
                  exiting={exiting.has(item.dedupeKey)}
                  onFocus={() => setActiveIndex(i)}
                  onDismiss={() => dismiss(item)}
                  registerRef={(el) => {
                    rowRefs.current[i] = el;
                  }}
                />
              ),
            )}
          </ul>

          {moreCount > 0 || expanded ? (
            <div className="mx-6 mt-auto border-t border-hairline">
              <button
                type="button"
                onClick={() => setExpanded((e) => !e)}
                className="flex w-full items-center justify-center gap-1.5 rounded-control py-4.5 text-sm font-medium text-muted outline-none transition-colors hover:text-foreground/90 focus-visible:ring-2 focus-visible:ring-brand/40"
              >
                <ChevronDown className={`h-4 w-4 transition-transform ${expanded ? "rotate-180" : ""}`} strokeWidth={2} />
                {expanded ? "Show less" : (
                  <span>
                    <span className="font-mono tabular-nums">{moreCount}</span> more items
                  </span>
                )}
              </button>
            </div>
          ) : null}

          {degraded.length > 0 ? (
            <p className="mx-6 border-t border-hairline py-3 text-caption text-muted">
              Some data unavailable ({degraded.join(", ")}) —{" "}
              <button type="button" onClick={refreshDigest} className="font-medium text-foreground/75 hover:text-brand hover:underline">
                retry
              </button>
            </p>
          ) : null}
        </>
      ) : state.status === "error" && !data ? (
        // A failed digest is an ERROR, never an all-clear (audit ST-01): the
        // old fall-through rendered the checkmark and "Nothing needs your
        // attention" over a dead page.
        <div className="flex flex-1 flex-col items-start justify-center gap-2 px-6 py-8">
          <p className="text-sm text-muted">Couldn&apos;t load your queue. Its state is unknown, not clear.</p>
          <button type="button" onClick={refreshDigest} className="text-xs font-medium text-foreground/75 hover:text-brand hover:underline">
            Retry
          </button>
        </div>
      ) : noPortfolio && openCount === 0 && degraded.length === 0 ? (
        // First-run / empty-portfolio: onboarding copy, not a fake clear state (§11).
        <div className="flex flex-1 flex-col items-start justify-center gap-2 px-6 py-8">
          <p className="text-sm text-muted">Add holdings and a watchlist to start your queue.</p>
          <div className="flex gap-2">
            <Link href="/portfolio" className="rounded-control border border-border bg-surface-2 px-3 py-1.5 text-xs font-medium text-foreground hover:border-brand/40 hover:text-brand">
              Add holdings →
            </Link>
            <Link href="/watchlist" className="rounded-control border border-border bg-surface-2 px-3 py-1.5 text-xs font-medium text-foreground hover:border-brand/40 hover:text-brand">
              Build a watchlist →
            </Link>
          </div>
        </div>
      ) : degraded.length > 0 ? (
        <div className="flex flex-1 flex-col items-start justify-center gap-2 px-6 py-8">
          <p className="text-sm text-muted">Attention data is unavailable right now.</p>
          <button type="button" onClick={refreshDigest} className="text-xs font-medium text-foreground/75 hover:text-brand hover:underline">
            Retry
          </button>
        </div>
      ) : (
        // The earned clear state (§11, §16) — quiet, monochrome, no confetti.
        <div ref={clearRef} tabIndex={-1} className="uaa-reveal flex flex-1 flex-col items-center justify-center gap-2 py-10 text-center outline-none">
          <span className="flex h-9 w-9 items-center justify-center rounded-full border border-border text-muted">
            <Check className="h-4 w-4" strokeWidth={2} />
          </span>
          <p className="text-sm text-foreground/50">Nothing needs your attention.</p>
        </div>
      )}
    </div>
  );
}
