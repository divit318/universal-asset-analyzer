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
 */

import { useCallback, useMemo, useRef, useState, type CSSProperties } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { X, Check, ChevronDown, ChevronRight, SlidersHorizontal, ArrowRight } from "lucide-react";
import { useToast } from "@/app/_components/toast";
import type { AttentionItem, AttentionKind, RecommendedAction, SymbolContext } from "@/lib/home/contracts";
import { explainAttentionScore, explainDecision } from "@/lib/home/explain";
import { STAGE_LABEL } from "@/lib/idea-stage";
import { SymbolTag } from "../_atmosphere/symbol-link";
import { ExplainableValue } from "../_atmosphere/explain-popover";
import { useHome, useHomeSlice } from "../home-provider";
import { Skeleton } from "@/app/_components/ui";

const MAX_VISIBLE = 8;
const UNDO_MS = 10_000;
const EXIT_MS = 180;

const KINDS: AttentionKind[] = ["action", "threat", "alert", "event", "signal"];
const FILTERS: (AttentionKind | "all")[] = ["all", ...KINDS];
const KIND_LABEL: Record<AttentionKind, string> = {
  action: "Action",
  threat: "Threat",
  alert: "Alert",
  event: "Event",
  signal: "Signal",
};

/** Kind chip colour — the only chromatic element on a row (§16). Text label
 *  always present so kind is never conveyed by colour alone (§17). */
function chipClass(kind: AttentionKind, score: number): string {
  switch (kind) {
    case "threat":
      return score >= 80 ? "text-negative bg-negative/10" : "text-warning bg-warning/10";
    case "signal":
      return "text-positive bg-positive/10";
    case "event":
      return "text-muted bg-surface-2";
    default:
      return "text-brand bg-brand/10"; // action, alert — interaction blue
  }
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
 * the platform has no history with simply has no chips.
 */
function ContextChips({ ctx }: { ctx: SymbolContext | undefined }) {
  if (!ctx) return null;
  const chips: string[] = [];
  if (ctx.heldWeightPct != null) chips.push(`${ctx.heldWeightPct.toFixed(1)}% of book`);
  if (ctx.watchlistStage && ctx.heldWeightPct == null) chips.push(STAGE_LABEL[ctx.watchlistStage] ?? ctx.watchlistStage);
  if (ctx.lastResearchedAt) chips.push(`researched ${daysAgo(ctx.lastResearchedAt)}`);
  if (chips.length === 0) return null;
  return (
    <span className="flex shrink-0 items-center gap-1">
      {chips.map((c) => (
        <span key={c} className="rounded-full bg-surface-2 px-1.5 py-0.5 text-[10px] font-medium text-muted">
          {c}
        </span>
      ))}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Spotlight — the queue's #1 item, promoted to "next best step"       */
/* ------------------------------------------------------------------ */

/**
 * The decision dashboard's answer to "if I do one thing, what is it?". The
 * top-ranked item renders large: full rationale, explainable score, the
 * symbol's context, and — when the item is a decision the engine actually
 * simulated — the measured before → after portfolio state and the full WHY
 * memo. Everything shown is data the digest already carried; promotion is
 * presentation, not re-ranking.
 */
function SpotlightCard({
  item,
  decision,
  ctx,
  active,
  exiting,
  onFocus,
  onDismiss,
  registerRef,
}: RowProps & { decision: RecommendedAction | null; ctx: SymbolContext | undefined }) {
  const [showWhy, setShowWhy] = useState(false);
  const impact = decision?.impact ?? null;
  // Each number explains ITSELF: the ranking score decomposes into the
  // attention formula; the simulated deltas decompose into the decision memo.
  // Wiring the decision explanation onto the attention number showed a popover
  // whose headline value disagreed with the trigger — worse than no popover.
  const decisionExplanation = decision ? explainDecision(decision) : null;

  return (
    <li
      ref={registerRef}
      role="listitem"
      tabIndex={active ? 0 : -1}
      onFocus={onFocus}
      className={`group relative flex flex-col gap-2.5 overflow-hidden rounded-card border border-brand/25 bg-gradient-to-br from-brand/[0.07] to-transparent px-4 py-3.5 outline-none transition-colors focus-visible:border-brand/50 focus-visible:ring-2 focus-visible:ring-brand/30 ${
        exiting ? "uaa-queue-exit" : ""
      }`}
    >
      {/* Eyebrow row */}
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-brand">Next best step</span>
        <span className={`rounded-[5px] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${chipClass(item.kind, item.score)}`}>
          {KIND_LABEL[item.kind]}
        </span>
        <span className="min-w-0 flex-1" />
        <ExplainableValue explanation={explainAttentionScore(item)} align="end">
          <span className="font-mono text-sm font-bold tabular-nums text-foreground" aria-label={`score ${Math.round(item.score)} of 100`}>
            {Math.round(item.score)}
          </span>
        </ExplainableValue>
        <button
          type="button"
          onClick={onDismiss}
          aria-label={`Dismiss: ${item.headline}`}
          tabIndex={-1}
          className="shrink-0 rounded-control p-1 text-muted outline-none transition-colors hover:bg-surface-3 hover:text-foreground focus-visible:ring-2 focus-visible:ring-brand/40"
        >
          <X className="h-3.5 w-3.5" strokeWidth={2} />
        </button>
      </div>

      {/* Headline + full rationale */}
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          {item.symbol ? (
            <SymbolTag symbol={item.symbol} className="font-mono text-base font-bold text-foreground">
              {item.symbol}
            </SymbolTag>
          ) : null}
          <span className="text-[15px] font-semibold leading-snug text-foreground">{item.headline}</span>
          <ContextChips ctx={ctx} />
        </div>
        <p className="text-xs leading-relaxed text-muted">{item.rationale}</p>
      </div>

      {/* Measured before → after, when the engine simulated this decision */}
      {impact ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-control border border-border/70 bg-surface/70 px-3 py-2">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-faint">If executed</span>
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
            <span className="text-[10px] text-faint">{decision.alternativesEvaluated} alternatives simulated</span>
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
            tabIndex={-1}
            className="inline-flex w-fit items-center gap-1 rounded-control text-[11px] font-semibold text-brand outline-none transition-colors hover:underline focus-visible:ring-2 focus-visible:ring-brand/40"
          >
            <ChevronRight className={`h-3.5 w-3.5 transition-transform ${showWhy ? "rotate-90" : ""}`} strokeWidth={2} />
            Why this, why now
          </button>
          {showWhy ? (
            <dl className="flex flex-col gap-1.5 border-l-2 border-brand/20 pl-3 text-[11px] leading-relaxed text-muted">
              <div><dt className="inline font-semibold text-foreground/80">Why now: </dt><dd className="inline">{decision.why.whyNow}</dd></div>
              <div><dt className="inline font-semibold text-foreground/80">Sizing: </dt><dd className="inline">{decision.why.whyThisAmount}</dd></div>
              <div><dt className="inline font-semibold text-foreground/80">Vs. alternatives: </dt><dd className="inline">{decision.why.whyNotAlternative}</dd></div>
              <div><dt className="inline font-semibold text-foreground/80">Vs. doing nothing: </dt><dd className="inline">{decision.why.whyNotNothing}</dd></div>
            </dl>
          ) : null}
        </div>
      ) : null}

      {/* Primary action */}
      <div className="flex items-center gap-2">
        <Link
          href={item.primaryAction.href}
          tabIndex={-1}
          className="inline-flex items-center gap-1.5 rounded-control bg-brand px-3 py-1.5 text-xs font-semibold text-white shadow-sm outline-none transition-colors hover:bg-brand-strong focus-visible:ring-2 focus-visible:ring-brand/40"
        >
          {item.primaryAction.label} <ArrowRight className="h-3.5 w-3.5" strokeWidth={2.5} />
        </Link>
        {item.mergedHrefs?.map((m) => (
          <Link key={m.href} href={m.href} tabIndex={-1} className="text-[11px] font-medium text-muted outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-brand/40">
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

function QueueCard({ item, active, exiting, onFocus, onDismiss, registerRef, ctx }: RowProps & { ctx: SymbolContext | undefined }) {
  return (
    <li
      ref={registerRef}
      role="listitem"
      tabIndex={active ? 0 : -1}
      onFocus={onFocus}
      className={`uaa-linkable group flex flex-col gap-1.5 rounded-control border border-transparent px-3 py-2.5 outline-none transition-colors hover:border-border-strong focus-visible:border-brand/40 focus-visible:ring-2 focus-visible:ring-brand/30 ${
        exiting ? "uaa-queue-exit" : ""
      }`}
    >
      {/* Row 1 — kind · symbol · headline · score · dismiss */}
      <div className="flex items-center gap-2">
        <span className={`shrink-0 rounded-[5px] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${chipClass(item.kind, item.score)}`}>
          {KIND_LABEL[item.kind]}
        </span>
        {item.symbol ? (
          <SymbolTag symbol={item.symbol} className="shrink-0 font-mono text-[13px] font-semibold text-foreground">
            {item.symbol}
          </SymbolTag>
        ) : null}
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground/90">{item.headline}</span>
        <ExplainableValue explanation={explainAttentionScore(item)} align="end" className="shrink-0">
          <span
            className="font-mono text-xs tabular-nums text-muted"
            aria-label={`attention score ${Math.round(item.score)} of 100`}
          >
            {Math.round(item.score)}
          </span>
        </ExplainableValue>
        <button
          type="button"
          onClick={onDismiss}
          aria-label={`Dismiss: ${item.headline}`}
          tabIndex={-1}
          className="shrink-0 rounded-control p-1 text-muted outline-none transition-colors hover:bg-surface-3 hover:text-foreground focus-visible:ring-2 focus-visible:ring-brand/40"
        >
          <X className="h-3.5 w-3.5" strokeWidth={2} />
        </button>
      </div>

      {/* Row 2 — rationale · context · primary action */}
      <div className="flex items-center justify-between gap-3 pl-0.5">
        <span className="min-w-0 flex-1 truncate text-[11px] text-muted">{item.rationale}</span>
        <ContextChips ctx={ctx} />
        <Link
          href={item.primaryAction.href}
          tabIndex={-1}
          className="shrink-0 text-[11px] font-semibold text-brand outline-none hover:underline focus-visible:ring-2 focus-visible:ring-brand/40"
        >
          {item.primaryAction.label} →
        </Link>
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

      // 1. Animate out, then hide.
      setExiting((prev) => new Set(prev).add(item.dedupeKey));
      window.setTimeout(() => {
        setExiting((prev) => {
          const n = new Set(prev);
          n.delete(item.dedupeKey);
          return n;
        });
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
        body: JSON.stringify({ dedupeKey: item.dedupeKey, kind: item.kind, occursAt: item.occursAt }),
      })
        .then((res) => {
          if (!res.ok) throw new Error();
        })
        .catch(() => {
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
              body: JSON.stringify({ dedupeKey: item.dedupeKey }),
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

  /* -------------------- topline accent -------------------- */

  const top = visible[0];
  const accentLine = top
    ? top.kind === "threat"
      ? top.score >= 80
        ? "var(--negative)"
        : "var(--warning)"
      : "var(--brand)"
    : "color-mix(in oklab, var(--foreground) 14%, transparent)";

  /* -------------------- render -------------------- */

  return (
    <div
      id="action-center"
      className="uaa-card uaa-topline scroll-mt-20 flex h-full flex-col p-4"
      style={{ "--accent-line": accentLine } as CSSProperties}
    >
      {/* Header */}
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-foreground">Attention</h2>
            <span className="font-mono text-xs tabular-nums text-muted" aria-live="polite">
              {openCount} open
            </span>
          </div>
          <p className="truncate text-xs text-muted">One ranked stream — clear it, and you&apos;re done.</p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {openCount > 5 ? (
            <button
              type="button"
              onClick={() => setShowFilters((s) => !s)}
              aria-expanded={showFilters}
              aria-label="Filter by kind"
              className="rounded-control p-1.5 text-muted outline-none transition-colors hover:bg-surface-2 hover:text-foreground focus-visible:ring-2 focus-visible:ring-brand/40"
            >
              <SlidersHorizontal className="h-3.5 w-3.5" strokeWidth={2} />
            </button>
          ) : null}
        </div>
      </div>

      {/* Filter chips (only when the queue exceeds 5 items) */}
      {showFilters && openCount > 5 ? (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              aria-pressed={filter === f}
              onClick={() => setFilter(f)}
              className={`rounded-full px-2 py-0.5 text-[11px] font-medium capitalize outline-none transition-colors focus-visible:ring-2 focus-visible:ring-brand/40 ${
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
        <div className="flex flex-col gap-2" style={{ minHeight: 220 }} aria-hidden>
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex flex-col gap-1.5 rounded-control px-3 py-2.5">
              <Skeleton height="h-4" width="w-3/4" />
              <Skeleton height="h-3" width="w-1/2" />
            </div>
          ))}
        </div>
      ) : visible.length > 0 ? (
        <>
          <ul role="list" aria-label="Attention queue" onKeyDown={onKeyDown} className="flex flex-col gap-1.5">
            {visible.map((item, i) =>
              i === 0 ? (
                <SpotlightCard
                  key={item.dedupeKey}
                  item={item}
                  index={i}
                  decision={decisionById.get(item.id) ?? null}
                  ctx={ctxFor(item.symbol)}
                  active={i === safeActive}
                  exiting={exiting.has(item.dedupeKey)}
                  onFocus={() => setActiveIndex(i)}
                  onDismiss={() => dismiss(item)}
                  registerRef={(el) => {
                    rowRefs.current[i] = el;
                  }}
                />
              ) : (
                <QueueCard
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

          {filtered.length > MAX_VISIBLE ? (
            <button
              type="button"
              onClick={() => setExpanded((e) => !e)}
              className="mt-2 inline-flex items-center gap-1 self-start rounded-control px-2 py-1 text-xs font-medium text-brand outline-none transition-colors hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-brand/40"
            >
              <ChevronDown className={`h-3.5 w-3.5 transition-transform ${expanded ? "rotate-180" : ""}`} strokeWidth={2} />
              {expanded ? "Show less" : `${filtered.length - MAX_VISIBLE} more`}
            </button>
          ) : null}

          {degraded.length > 0 ? (
            <p className="mt-2 border-t border-hairline pt-2 text-[11px] text-muted">
              Some data unavailable ({degraded.join(", ")}) —{" "}
              <button type="button" onClick={refreshDigest} className="font-medium text-brand hover:underline">
                retry
              </button>
            </p>
          ) : null}
        </>
      ) : noPortfolio && openCount === 0 && degraded.length === 0 ? (
        // First-run / empty-portfolio: onboarding copy, not a fake clear state (§11).
        <div className="flex flex-1 flex-col items-start justify-center gap-2 py-8">
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
        <div className="flex flex-1 flex-col items-start justify-center gap-2 py-8">
          <p className="text-sm text-muted">Attention data is unavailable right now.</p>
          <button type="button" onClick={refreshDigest} className="text-xs font-medium text-brand hover:underline">
            Retry
          </button>
        </div>
      ) : (
        // The earned clear state (§11, §16) — quiet, monochrome, no confetti.
        <div ref={clearRef} tabIndex={-1} className="uaa-reveal flex flex-1 flex-col items-center justify-center gap-2 py-10 text-center outline-none">
          <span className="flex h-9 w-9 items-center justify-center rounded-full border border-border text-muted">
            <Check className="h-4 w-4" strokeWidth={2} />
          </span>
          <p className="text-sm font-medium text-foreground">You&apos;re clear</p>
          <p className="text-xs text-muted">Nothing needs a decision.</p>
          {data?.reviewedAt ? (
            <p className="text-[10px] text-faint">as of {new Date(data.reviewedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</p>
          ) : null}
        </div>
      )}
    </div>
  );
}
