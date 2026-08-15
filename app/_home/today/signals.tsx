"use client";

/**
 * III · SIGNALS — the focus model over the real Attention Queue.
 *
 * "N observed · 3 surfaced": the top three ranked items become numbered
 * signals with an intelligence-reveal panel (why → recommended → score
 * audit — the engine's own impact/urgency/confidence inputs, shown, not
 * invented); everything else waits inside the sealed ledger below.
 *
 * Suppression speaks the SAME wire protocol as the previous queue UI
 * (optimistic hide → POST /api/home/attention/dismiss → undo toast →
 * rollback on failure), so dismissals persist, TTL by kind, and a
 * materially-worse version of a story still resurfaces past them.
 */

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useToast } from "@/app/_components/toast";
import { Skeleton } from "@/app/_components/ui";
import { dismissalTtlLabel, withFromToday } from "@/lib/home/attention";
import type { AttentionItem } from "@/lib/home/contracts";
import { countdown, relativeTime } from "../_viz/format";
import { useHome, useHomeSlice } from "../home-provider";
import { useTelemetry } from "../use-telemetry";
import { AuditMeter, Eyebrow, KindChip, setExpanded } from "./primitives";

export const SURFACED = 3;
/** Dispatched (detail: dedupeKey) by the verdict's thread to open a signal. */
export const OPEN_SIGNAL_EVENT = "tdy:open-signal";
const EXIT_MS = 280;
const UNDO_MS = 10_000;

function nextMondayAtOpen(): number {
  const d = new Date();
  d.setHours(9, 30, 0, 0);
  const add = (8 - d.getDay()) % 7 || 7;
  d.setDate(d.getDate() + add);
  return d.getTime();
}

function fmtWhen(iso: string): string {
  return new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric" }).format(
    new Date(iso),
  );
}

/* ------------------------------------------------------------------ */
/* Suppression pipeline (persist + undo, optimistic)                   */
/* ------------------------------------------------------------------ */

function useSuppress() {
  const toast = useToast();
  const track = useTelemetry();
  const [gone, setGone] = useState<Set<string>>(new Set());
  const [exiting, setExiting] = useState<Set<string>>(new Set());

  const suppress = useCallback(
    (item: AttentionItem, extras: { snoozeUntil?: number } | null, message: string) => {
      const mode = extras?.snoozeUntil != null ? "snooze" : "dismiss";
      track("queue_item_suppressed", { dedupeKey: item.dedupeKey, kind: item.kind, score: item.score, mode });
      let failed = false;

      setExiting((prev) => new Set(prev).add(item.dedupeKey));
      window.setTimeout(() => {
        setExiting((prev) => {
          const n = new Set(prev);
          n.delete(item.dedupeKey);
          return n;
        });
        if (!failed) setGone((prev) => new Set(prev).add(item.dedupeKey));
      }, EXIT_MS);

      fetch("/api/home/attention/dismiss", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dedupeKey: item.dedupeKey,
          kind: item.kind,
          occursAt: item.occursAt,
          storyKey: item.storyKey ?? null,
          // A decision-backed story's dismissal is SEMANTIC: the thesis +
          // revival context land in the shared decision memory, so the
          // Decisions tab, digest and spotlight stop repeating the idea too
          // (engines/decision-memory.ts). A snooze stays presentation-only —
          // a chosen deadline is not a considered "no".
          thesis: mode === "snooze" ? null : item.thesis ?? null,
          ...(extras ?? {}),
        }),
      })
        .then((res) => {
          if (!res.ok) throw new Error();
        })
        .catch(() => {
          failed = true;
          setGone((prev) => {
            const n = new Set(prev);
            n.delete(item.dedupeKey);
            return n;
          });
          toast("Couldn’t save that. It’s back in your queue.", "error");
        });

      toast(message, "info", {
        durationMs: UNDO_MS,
        action: {
          label: "Undo",
          onClick: () => {
            track("queue_undo", { dedupeKey: item.dedupeKey, kind: item.kind, score: item.score, mode });
            fetch("/api/home/attention/dismiss", {
              method: "DELETE",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                dedupeKey: item.dedupeKey,
                storyKey: item.storyKey ?? null,
                // Undo reverses BOTH records — the story hide and the
                // decision-memory row the dismissal wrote.
                thesisKey: mode === "snooze" ? null : item.thesis?.key ?? null,
              }),
            }).catch(() => {});
            setGone((prev) => {
              const n = new Set(prev);
              n.delete(item.dedupeKey);
              return n;
            });
          },
        },
      });
    },
    [toast, track],
  );

  return { gone, exiting, suppress };
}

/* ------------------------------------------------------------------ */
/* One surfaced signal                                                 */
/* ------------------------------------------------------------------ */

function SignalRow({
  item,
  rank,
  open,
  exiting,
  onToggle,
  onDismiss,
  onSnooze,
}: {
  item: AttentionItem;
  rank: number;
  open: boolean;
  exiting: boolean;
  onToggle: () => void;
  onDismiss: () => void;
  onSnooze: () => void;
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const firstRender = useRef(true);
  const panelId = `tdy-sig-panel-${rank}`;
  const btnId = `tdy-sig-btn-${rank}`;

  // Expansion follows the `open` prop, so a row opened from the verdict's
  // thread (or closed because a sibling opened) animates identically to a
  // click. The initial closed state must not animate.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      if (!open) return;
    }
    setExpanded(panelRef.current, open);
  }, [open]);

  return (
    <li
      className={`tdy-signal border-t border-hairline last:border-b ${open ? "is-open" : ""} ${exiting ? "tdy-exit" : ""}`}
    >
      <button
        type="button"
        id={btnId}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={onToggle}
        className="tdy-signal-row grid w-full grid-cols-[72px_1fr_auto] items-baseline gap-6 rounded px-2 py-6 text-left transition-colors duration-(--duration-base) hover:bg-surface/55 max-md:grid-cols-[44px_1fr] max-md:gap-3.5 max-md:py-5"
      >
        <span
          className={`font-mono text-3xl leading-none tabular-nums transition-colors duration-(--duration-base) max-md:text-xl ${
            rank === 1 || open ? "text-brand" : "text-faint"
          }`}
        >
          {String(rank).padStart(2, "0")}
        </span>
        <span className="flex min-w-0 flex-col gap-2">
          <span className="flex items-center gap-3.5">
            <KindChip kind={item.kind} />
            <span className="font-mono text-[10px] tracking-[0.14em] text-muted tabular-nums">
              SCORE <b className="font-medium text-muted">{Math.round(item.score)}</b> / 100
            </span>
            {item.symbol ? (
              <span className="font-mono text-[10px] tracking-[0.14em] text-muted">{item.symbol}</span>
            ) : null}
          </span>
          <span className="font-serif text-[clamp(20px,2.2vw,26px)] font-semibold leading-tight tracking-[-0.01em]">
            {item.headline}
          </span>
          <span className="max-w-[68ch] text-sm text-muted">{item.rationale}</span>
        </span>
        <span className="flex items-center gap-3.5 self-center max-md:hidden" aria-hidden="true">
          <span className="tdy-why-hint font-mono text-[10px] tracking-[0.18em] text-brand">WHY</span>
          <span className="tdy-caret grid h-7 w-7 place-items-center rounded-full border border-border-strong text-sm text-faint">
            ＋
          </span>
        </span>
      </button>

      {/* The intelligence reveal — simple first, deep when requested. */}
      <div ref={panelRef} id={panelId} role="region" aria-labelledby={btnId} className="tdy-expand" hidden>
        <div className="px-2 pb-8 pl-24 pt-1 max-md:pl-2">
          <div className="grid grid-cols-[1.1fr_1fr_1.1fr] gap-11 max-md:grid-cols-1 max-md:gap-7">
            <div>
              <PanelLabel>Why it matters</PanelLabel>
              <p className="text-[13.5px] leading-relaxed text-foreground/90">{item.rationale}</p>
              <ul className="mt-4 flex flex-col">
                {item.symbol ? (
                  <Evidence label="Symbol">
                    <Link
                      href={withFromToday(`/research?symbol=${encodeURIComponent(item.symbol)}`)}
                      className="text-brand hover:underline"
                    >
                      {item.symbol}
                    </Link>
                  </Evidence>
                ) : null}
                {item.occursAt ? (
                  <Evidence label="Dated">
                    {fmtWhen(item.occursAt)} · {countdown(item.occursAt)}
                  </Evidence>
                ) : null}
                {item.observedAt ? <Evidence label="Observed">{relativeTime(item.observedAt)}</Evidence> : null}
                <Evidence label="Engine">{item.source}</Evidence>
              </ul>
            </div>

            <div>
              <PanelLabel>Recommended</PanelLabel>
              <p className="font-serif text-[17px] leading-normal">{item.primaryAction.label}</p>
              {item.occursAt ? (
                <p className="mt-3 text-xs leading-relaxed text-muted">
                  Decide before {fmtWhen(item.occursAt)} — not during it.
                </p>
              ) : null}
              <Link
                href={withFromToday(item.primaryAction.href)}
                className="group mt-5 inline-flex items-center gap-1.5 rounded-md border border-brand/35 px-3.5 py-2 text-xs font-semibold tracking-[0.04em] text-brand transition-colors duration-(--duration-base) hover:border-brand hover:bg-brand/10 hover:text-brand-strong"
              >
                Open
                <span aria-hidden="true" className="transition-transform duration-(--duration-base) group-hover:translate-x-[3px]">
                  →
                </span>
              </Link>
              {item.mergedHrefs?.length ? (
                <ul className="mt-3 flex flex-col gap-1">
                  {item.mergedHrefs.map((m) => (
                    <li key={m.href}>
                      <Link
                        href={withFromToday(m.href)}
                        className="text-xs text-muted underline-offset-2 hover:text-brand hover:underline"
                      >
                        {m.label} →
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>

            <div>
              <PanelLabel>Score audit</PanelLabel>
              <div className="flex flex-col gap-3">
                <AuditMeter label="IMPACT" value={item.impact} />
                <AuditMeter label="URGENCY" value={item.urgency} />
                <AuditMeter label="CONFIDENCE" value={item.confidence} />
              </div>
              <p className="mt-4 text-xs leading-relaxed text-muted">
                One score ranks every kind of story — these are the engine’s own inputs, not a narrative.
              </p>
            </div>
          </div>

          <div className="mt-7 flex flex-wrap items-center gap-x-7 gap-y-3 border-t border-hairline pt-4">
            <p className="mr-auto font-mono text-[10px] uppercase tracking-[0.08em] text-muted">
              {item.kind} · {item.source}
            </p>
            <div className="flex gap-2.5">
              <button
                type="button"
                onClick={onDismiss}
                className="min-h-8 rounded-md border border-transparent px-3 py-1.5 text-xs text-faint transition-colors duration-(--duration-base) hover:border-border-strong hover:text-muted"
              >
                Dismiss
              </button>
              <button
                type="button"
                onClick={onSnooze}
                className="min-h-8 rounded-md border border-transparent px-3 py-1.5 text-xs text-faint transition-colors duration-(--duration-base) hover:border-border-strong hover:text-muted"
              >
                Snooze to Monday
              </button>
            </div>
          </div>
        </div>
      </div>
    </li>
  );
}

function PanelLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-4 flex items-center gap-2 font-mono text-[9.5px] uppercase tracking-[0.2em] text-faint after:h-px after:flex-1 after:bg-hairline after:content-['']">
      {children}
    </p>
  );
}

function Evidence({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <li className="grid grid-cols-[1fr_auto] gap-x-3 border-b border-hairline py-2 first:pt-0 last:border-0">
      <span className="text-xs text-muted">{label}</span>
      <span className="text-right font-mono text-[12.5px] tabular-nums">{children}</span>
    </li>
  );
}

/* ------------------------------------------------------------------ */
/* The section                                                         */
/* ------------------------------------------------------------------ */

export function Signals() {
  const state = useHomeSlice("attention");
  const { refreshDigest } = useHome();
  const { gone, exiting, suppress } = useSuppress();
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [ledgerOpen, setLedgerOpen] = useState(false);
  const ledgerRef = useRef<HTMLDivElement | null>(null);

  const items = useMemo(
    () => (state.data?.items ?? []).filter((i) => !gone.has(i.dedupeKey)),
    [state.data, gone],
  );

  // The verdict's thread can open a specific signal from above.
  useEffect(() => {
    const onOpen = (e: Event) => {
      const key = (e as CustomEvent<string>).detail;
      if (items.some((i) => i.dedupeKey === key)) setOpenKey(key);
    };
    window.addEventListener(OPEN_SIGNAL_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_SIGNAL_EVENT, onOpen);
  }, [items]);
  const surfaced = items.slice(0, SURFACED);
  const rest = items.slice(SURFACED);
  const openCount = Math.max(0, (state.data?.openCount ?? items.length) - gone.size);

  const reviewedAt = state.data?.reviewedAt
    ? new Date(state.data.reviewedAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false })
    : null;

  const dismiss = useCallback(
    (item: AttentionItem) =>
      suppress(
        item,
        null,
        // A thesis-backed dismissal has decision-memory semantics (no TTL —
        // material change or restore); only presentation-level stories carry
        // the per-kind TTL. The toast must say what the X actually did.
        item.thesis
          ? "Dismissed — returns only if your policy changes or this materially worsens."
          : `Dismissed for ${dismissalTtlLabel(item.kind)} — returns sooner if the story worsens.`,
      ),
    [suppress],
  );
  const snooze = useCallback(
    (item: AttentionItem) => suppress(item, { snoozeUntil: nextMondayAtOpen() }, "Snoozed to Monday 9:30."),
    [suppress],
  );

  return (
    <section id="tdy-signals" aria-labelledby="tdy-signals-h" className="border-b border-hairline py-14 max-md:py-10">
      <div className="tdy-shell">
        <Eyebrow
          id="tdy-signals-h"
          note={
            state.data ? (
              <>
                {openCount} OBSERVED · {Math.min(SURFACED, surfaced.length)} SURFACED
              </>
            ) : null
          }
        >
          Signals — what needs you
        </Eyebrow>

        {state.status === "loading" ? (
          <div className="mt-8 flex flex-col gap-6" aria-hidden>
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex flex-col gap-2 border-t border-hairline pt-6">
                <Skeleton height="h-3" width="w-40" />
                <Skeleton height="h-6" width="w-96" />
                <Skeleton height="h-3" width="w-72" />
              </div>
            ))}
          </div>
        ) : state.status === "error" && !state.data ? (
          <p className="mt-6 text-sm text-muted">
            The queue couldn’t be assembled — that is an error, not an all-clear.{" "}
            <button type="button" onClick={refreshDigest} className="font-medium text-brand hover:underline">
              Retry
            </button>
          </p>
        ) : surfaced.length === 0 ? (
          <p className="mt-6 flex items-center gap-3 font-serif text-lg text-muted">
            <span className="tdy-eyebrow-diamond" aria-hidden="true" />
            Queue clear — everything processed{reviewedAt ? `, reviewed ${reviewedAt}` : ""}. Nothing needs you.
          </p>
        ) : (
          <>
            <p className="mb-7 mt-4 font-serif text-base text-muted">
              Everything was processed.{" "}
              {surfaced.length === 1
                ? "This one carries the weight."
                : `These ${surfaced.length === 2 ? "two" : "three"} carry the weight.`}
            </p>
            <ol className="list-none">
              {surfaced.map((item, i) => (
                <SignalRow
                  key={item.id}
                  item={item}
                  rank={i + 1}
                  open={openKey === item.dedupeKey}
                  exiting={exiting.has(item.dedupeKey)}
                  onToggle={() => setOpenKey((k) => (k === item.dedupeKey ? null : item.dedupeKey))}
                  onDismiss={() => dismiss(item)}
                  onSnooze={() => snooze(item)}
                />
              ))}
            </ol>

            {rest.length > 0 ? (
              <div className="mt-10">
                <button
                  type="button"
                  aria-expanded={ledgerOpen}
                  aria-controls="tdy-ledger"
                  onClick={() => {
                    setExpanded(ledgerRef.current, !ledgerOpen);
                    setLedgerOpen((v) => !v);
                  }}
                  className="flex min-h-11 w-full items-center gap-3.5 border-y border-hairline px-2 py-3.5 text-left transition-colors duration-(--duration-base) hover:bg-surface/55"
                >
                  <span
                    className={`h-[5px] w-[5px] rotate-45 border border-brand ${ledgerOpen ? "bg-brand" : ""}`}
                    aria-hidden="true"
                  />
                  <span className="text-sm font-medium">
                    The other {rest.length === 1 ? "one" : rest.length}
                  </span>
                  <span className="mr-auto text-xs text-muted">processed — ranked below the fold</span>
                  <span
                    className={`font-mono text-faint transition-transform duration-(--duration-panel) ${ledgerOpen ? "rotate-45 text-brand" : ""}`}
                    aria-hidden="true"
                  >
                    ＋
                  </span>
                </button>
                <div ref={ledgerRef} id="tdy-ledger" className="tdy-expand" hidden>
                  <ul className="py-1.5">
                    {rest.map((item) => (
                      <li
                        key={item.id}
                        className={`group grid grid-cols-[64px_52px_1fr_auto_auto] items-center gap-4 border-b border-hairline px-2 py-2.5 text-[13px] transition-colors duration-(--duration-base) last:border-0 hover:bg-surface/55 max-md:grid-cols-[64px_1fr_auto] ${
                          exiting.has(item.dedupeKey) ? "tdy-exit" : ""
                        }`}
                      >
                        <KindChip kind={item.kind} />
                        <span className="font-mono text-xs max-md:hidden">{item.symbol ?? ""}</span>
                        <Link
                          href={withFromToday(item.primaryAction.href)}
                          className="truncate text-muted underline-offset-2 hover:text-foreground hover:underline"
                          title={item.rationale}
                        >
                          {item.headline}
                        </Link>
                        <span className="font-mono text-[10.5px] tracking-[0.08em] text-muted tabular-nums">
                          {item.occursAt ? fmtWhen(item.occursAt).toUpperCase() : Math.round(item.score)}
                        </span>
                        <button
                          type="button"
                          aria-label={`Dismiss: ${item.headline}`}
                          onClick={() => dismiss(item)}
                          className="grid h-8 w-8 place-items-center rounded-md font-mono text-[11px] text-faint opacity-0 transition-[opacity,color,background-color] duration-(--duration-base) hover:bg-surface-2 hover:text-negative focus-visible:opacity-100 group-hover:opacity-100 max-md:hidden"
                        >
                          ✕
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            ) : null}

            {state.data && state.data.degradedFeeders.length > 0 ? (
              <p className="mt-4 text-caption text-muted">
                Some data unavailable ({state.data.degradedFeeders.join(", ")}) —{" "}
                <button type="button" onClick={refreshDigest} className="font-medium text-foreground/75 hover:text-brand hover:underline">
                  retry
                </button>
              </p>
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}
