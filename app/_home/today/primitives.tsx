"use client";

/**
 * Shared primitives for the Today page ("The Morning Ledger" — the approved
 * 2026-08-15 prototype). Section grammar (brass eyebrow + hairline), the kind
 * chip, the height-animated expander, and the in-view gate that lets bars and
 * rings draw when their section arrives.
 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import { prefersReducedMotion } from "@/app/_components/motion";
import type { AttentionKind } from "@/lib/home/contracts";

/* ------------------------------------------------------------------ */
/* Section grammar                                                     */
/* ------------------------------------------------------------------ */

/** Brass uppercase section opener with diamond + fading rule (landing DNA). */
export function Eyebrow({
  children,
  note,
  as: Tag = "h2",
  id,
}: {
  children: ReactNode;
  /** Right-aligned mono annotation (e.g. "16 OBSERVED · 3 SURFACED"). */
  note?: ReactNode;
  as?: "h2" | "p";
  id?: string;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5">
      <Tag
        id={id}
        className="flex items-center gap-2.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-brand"
      >
        <span>{children}</span>
        <span className="tdy-eyebrow-diamond" aria-hidden="true" />
        <span className="tdy-eyebrow-line" aria-hidden="true" />
      </Tag>
      {note ? (
        <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted tabular-nums">{note}</p>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Attention-kind chip                                                 */
/* ------------------------------------------------------------------ */

const KIND_CHIP: Record<AttentionKind, { label: string; className: string }> = {
  action: { label: "ACTION", className: "border-brand/35 bg-brand/10 text-brand" },
  threat: { label: "THREAT", className: "border-warning/35 bg-warning/10 text-warning" },
  alert: { label: "ALERT", className: "border-alert/35 text-alert" },
  event: { label: "EVENT", className: "border-border-strong text-muted" },
  signal: { label: "SIGNAL", className: "border-positive/30 text-positive" },
};

export function KindChip({ kind }: { kind: AttentionKind }) {
  const c = KIND_CHIP[kind];
  return (
    <span
      className={`rounded-[3px] border px-1.5 py-px font-mono text-[9px] leading-relaxed tracking-[0.2em] ${c.className}`}
    >
      {c.label}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Height-animated expansion (signal panels, the ledger)               */
/* ------------------------------------------------------------------ */

/**
 * In-flight transition bookkeeping for `setExpanded`. An INTERRUPTED
 * open/close (routine in a single-open accordion: opening signal 2 closes
 * signal 1 mid-animation) used to leave its `transitionend` listener
 * attached forever; the element's NEXT height transition then fired the
 * stale close handler, which re-set `hidden` — the "action items appear but
 * clicking does nothing" bug: aria-expanded toggled, the panel opened for
 * one frame, and a zombie listener slammed it shut.
 */
const EXPAND_CLEANUP = new WeakMap<HTMLElement, () => void>();

/**
 * Animate a `.tdy-expand` element open/closed. Height transitions run at
 * `--duration-panel`; reduced motion lands the final state instantly.
 * The element keeps `hidden` while closed so it is out of the tab order.
 * Fully interruption-safe: each call cancels the previous call's pending
 * listener before installing its own, and listeners ignore bubbled
 * transitionends from child elements.
 */
export function setExpanded(el: HTMLElement | null, open: boolean) {
  if (!el) return;
  EXPAND_CLEANUP.get(el)?.();
  EXPAND_CLEANUP.delete(el);

  if (prefersReducedMotion()) {
    el.hidden = !open;
    el.style.height = open ? "auto" : "0px";
    return;
  }

  const arm = (onEnd: (e: TransitionEvent) => void) => {
    el.addEventListener("transitionend", onEnd as EventListener);
    EXPAND_CLEANUP.set(el, () => el.removeEventListener("transitionend", onEnd as EventListener));
  };

  if (open) {
    el.hidden = false;
    // When interrupting a close, continue from the current height instead of
    // snapping to 0 — the panel reverses smoothly.
    const from = el.offsetHeight;
    const target = el.scrollHeight;
    el.style.height = `${from}px`;
    requestAnimationFrame(() => {
      el.style.height = `${target}px`;
    });
    arm((e) => {
      if (e.propertyName !== "height" || e.target !== el) return;
      el.style.height = "auto";
      EXPAND_CLEANUP.get(el)?.();
      EXPAND_CLEANUP.delete(el);
    });
  } else {
    el.style.height = `${el.offsetHeight}px`;
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        el.style.height = "0px";
      }),
    );
    arm((e) => {
      if (e.propertyName !== "height" || e.target !== el) return;
      el.hidden = true;
      EXPAND_CLEANUP.get(el)?.();
      EXPAND_CLEANUP.delete(el);
    });
  }
}

/* ------------------------------------------------------------------ */
/* In-view gates                                                       */
/* ------------------------------------------------------------------ */

/**
 * Marks a container `.is-in` once it scrolls into view, letting its child
 * `.tdy-bar` / `.tdy-ring-fg` elements draw. Reduced motion marks immediately.
 */
export function useArrival<T extends HTMLElement>(threshold = 0.15) {
  const ref = useRef<T | null>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (prefersReducedMotion()) {
      const raf = requestAnimationFrame(() => setInView(true));
      return () => cancelAnimationFrame(raf);
    }
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            setInView(true);
            obs.disconnect();
          }
        }
      },
      { threshold },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [threshold]);
  return [ref, inView] as const;
}

/** Score-audit meter: label + drawing track + value (real engine inputs). */
export function AuditMeter({ label, value }: { label: string; value: number }) {
  const v = Math.max(0, Math.min(1, value));
  return (
    <span className="flex items-center gap-2">
      <span className="font-mono text-[9px] tracking-[0.16em] text-faint">{label}</span>
      <span
        className="tdy-audit-track inline-block h-0.5 w-[52px] overflow-hidden rounded-full bg-surface-3"
        style={{ "--v": v } as React.CSSProperties}
      >
        <i />
      </span>
      <span className="font-mono text-[10.5px] text-muted tabular-nums">{v.toFixed(2).slice(1)}</span>
    </span>
  );
}
