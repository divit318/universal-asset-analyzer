"use client";

/**
 * II · THE VERDICT — the brief's thesis, set in the judgment serif.
 *
 * The AI headline streams in when the model gets to it; until then (and
 * forever, if AI is unavailable) the digest's deterministic briefing renders
 * — assembled from the same engine outputs, always true. First sentence is
 * the lede (final clause in brass), the rest supports. Never blocks paint.
 *
 * Beside the thesis runs THE THREAD — a quiet spine that previews the three
 * surfaced signals and fills with brass as the reader scrolls toward them:
 * the verdict is an argument, and the thread is where it leads. Pure
 * transform on scroll (one rAF-gated listener), fully lit under reduced
 * motion, hidden below lg where the thesis takes the full measure.
 */

import { useEffect, useRef } from "react";
import { prefersReducedMotion } from "@/app/_components/motion";
import { Skeleton, SkeletonText } from "@/app/_components/ui";
import type { AttentionItem } from "@/lib/home/contracts";
import { useHome, useHomeSlice } from "../home-provider";
import { KindChip } from "./primitives";
import { OPEN_SIGNAL_EVENT, SURFACED } from "./signals";

/** First sentence → lede, remainder → body. Sentence-safe enough for prose. */
function splitLede(text: string): { lede: string; body: string } {
  const m = text.match(/^(.+?[.!?])(\s+[\s\S]*)?$/);
  if (!m) return { lede: text, body: "" };
  return { lede: m[1].trim(), body: (m[2] ?? "").trim() };
}

/** Two-tone the lede: everything after the last comma arrives in brass. */
function TwoTone({ text }: { text: string }) {
  const i = text.lastIndexOf(", ");
  if (i < 8 || i > text.length - 6) return <>{text}</>;
  return (
    <>
      {text.slice(0, i + 2)}
      <em className="not-italic text-brand">{text.slice(i + 2)}</em>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* The thread                                                          */
/* ------------------------------------------------------------------ */

function SignalThread({ items }: { items: AttentionItem[] }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const fillRef = useRef<HTMLSpanElement | null>(null);
  const nodeRefs = useRef<(HTMLSpanElement | null)[]>([]);

  // Scroll-linked fill: 0 when the thread enters reading position, 1 when
  // the signals section arrives. Transform-only, one passive listener.
  useEffect(() => {
    const host = hostRef.current;
    const fill = fillRef.current;
    if (!host || !fill) return;

    const lit = (i: number, on: boolean) => {
      const n = nodeRefs.current[i];
      if (!n) return;
      n.style.backgroundColor = on ? "var(--brand)" : "var(--surface-3)";
      n.style.boxShadow = on ? "0 0 8px color-mix(in srgb, var(--brand) 40%, transparent)" : "none";
    };

    if (prefersReducedMotion()) {
      fill.style.transform = "scaleY(1)";
      items.forEach((_, i) => lit(i, true));
      return;
    }

    let queued = false;
    const measureAndPaint = () => {
      const target = document.getElementById("tdy-signals");
      if (!target) return;
      const hostTop = host.getBoundingClientRect().top + window.scrollY;
      const targetTop = target.getBoundingClientRect().top + window.scrollY;
      const anchor = window.scrollY + window.innerHeight * 0.6;
      const span = Math.max(1, targetTop - hostTop);
      const p = Math.min(1, Math.max(0, (anchor - hostTop) / span));
      fill.style.transform = `scaleY(${p})`;
      items.forEach((_, i) => lit(i, p >= (i + 0.6) / items.length));
    };
    const onScroll = () => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        measureAndPaint();
        queued = false;
      });
    };
    measureAndPaint();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [items]);

  const jump = (item: AttentionItem, rank: number) => {
    window.dispatchEvent(new CustomEvent(OPEN_SIGNAL_EVENT, { detail: item.dedupeKey }));
    document.getElementById(`tdy-sig-btn-${rank}`)?.scrollIntoView({ block: "center" });
  };

  return (
    <div ref={hostRef} className="relative pl-5" aria-label="The signals this verdict leads to">
      <p className="mb-5 font-mono text-[9.5px] uppercase tracking-[0.2em] text-muted">
        Where it leads
      </p>
      {/* The spine: hairline track, brass fill driven by scroll. */}
      <span aria-hidden="true" className="absolute bottom-1 left-[3px] top-8 w-px bg-surface-3" />
      <span
        ref={fillRef}
        aria-hidden="true"
        className="absolute bottom-1 left-[3px] top-8 w-px origin-top bg-brand"
        style={{ transform: "scaleY(0)" }}
      />
      <ol className="flex flex-col gap-6">
        {items.map((item, i) => (
          <li key={item.id} className="relative">
            <span
              ref={(el) => {
                nodeRefs.current[i] = el;
              }}
              aria-hidden="true"
              className="absolute -left-[22.5px] top-[7px] h-[7px] w-[7px] rotate-45 bg-surface-3 transition-[background-color,box-shadow] duration-(--duration-base)"
            />
            <button
              type="button"
              onClick={() => jump(item, i + 1)}
              className="group block w-full text-left"
            >
              <span className="flex items-center gap-2.5">
                <span className="font-mono text-[11px] text-muted tabular-nums">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <KindChip kind={item.kind} />
                <span className="ml-auto font-mono text-[10px] text-muted tabular-nums">
                  {Math.round(item.score)}
                </span>
              </span>
              <span className="mt-1.5 line-clamp-2 font-serif text-[15px] leading-snug text-muted transition-colors duration-(--duration-base) group-hover:text-foreground">
                {item.headline}
              </span>
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Section                                                             */
/* ------------------------------------------------------------------ */

export function Verdict() {
  const { brief, refreshBrief, digest } = useHome();
  const fallback = useHomeSlice("fallbackBriefing");
  const attention = useHomeSlice("attention");
  const threadItems = (attention.data?.items ?? []).slice(0, SURFACED);

  const headline = brief.data?.headline || fallback.data || "";
  const loading = !headline && (brief.status === "loading" || fallback.status === "loading");
  const { lede, body } = splitLede(headline);

  const aiGenerated = Boolean(brief.data?.aiGenerated && brief.data.headline);
  const generatedAt = brief.data?.generatedAt ?? digest.data?.generatedAt ?? null;
  const time = generatedAt
    ? new Date(generatedAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false })
    : null;

  return (
    <section id="tdy-verdict" aria-labelledby="tdy-verdict-h" className="border-b border-hairline py-14 max-md:py-10">
      <div className="tdy-shell">
        <div
          className={`grid gap-x-20 gap-y-10 ${
            threadItems.length > 0 ? "lg:grid-cols-[minmax(0,1fr)_290px]" : ""
          }`}
        >
          <div>
            <p className="mb-6 flex items-center gap-2.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-brand">
              The verdict
              <span className="tdy-eyebrow-diamond" aria-hidden="true" />
              <span className="tdy-eyebrow-line" aria-hidden="true" />
            </p>

            {loading ? (
              <>
                <h1 id="tdy-verdict-h" className="sr-only">
                  Today
                </h1>
                <div className="max-w-2xl" aria-hidden>
                  <SkeletonText lines={3} />
                </div>
              </>
            ) : (
              <>
                <h1
                  id="tdy-verdict-h"
                  className={`font-serif font-semibold tracking-[-0.015em] ${
                    // The display size answers the sentence: a short thesis
                    // gets the full editorial scale, a long one settles into
                    // a measure that stays a headline instead of a wall.
                    lede.length <= 90
                      ? "max-w-[21ch] text-[clamp(30px,4vw,46px)] leading-[1.12]"
                      : "max-w-[38ch] text-[clamp(21px,2.4vw,29px)] leading-[1.32]"
                  }`}
                >
                  {lede ? <TwoTone text={lede} /> : "Today"}
                </h1>
                {body ? (
                  <p className="mt-5 max-w-[62ch] font-serif text-[16.5px] leading-[1.65] text-muted">{body}</p>
                ) : null}
                <p className="mt-5 font-mono text-[10px] uppercase tracking-[0.12em] text-muted">
                  {aiGenerated ? "AI brief" : "Deterministic briefing"}
                  {time ? ` · ${time}` : ""}
                  {brief.status === "error" && !aiGenerated ? " · AI unavailable" : ""}
                  {" · "}
                  <button
                    type="button"
                    onClick={refreshBrief}
                    className="uppercase tracking-[0.12em] text-muted underline-offset-2 transition-colors duration-(--duration-base) hover:text-brand hover:underline"
                  >
                    {brief.status === "loading" && fallback.data ? "Writing…" : "Regenerate"}
                  </button>
                </p>
              </>
            )}
          </div>

          {threadItems.length > 0 ? (
            <div className="max-lg:hidden">
              <SignalThread items={threadItems} />
            </div>
          ) : attention.status === "loading" ? (
            <div className="max-lg:hidden" aria-hidden>
              <Skeleton height="h-3" width="w-24" />
              <div className="mt-6 flex flex-col gap-5 pl-5">
                <Skeleton height="h-10" width="w-full" />
                <Skeleton height="h-10" width="w-full" />
                <Skeleton height="h-10" width="w-full" />
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
