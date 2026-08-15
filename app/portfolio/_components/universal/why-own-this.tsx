"use client";

import { useState } from "react";
import type { HoldingExplanation } from "@/lib/portfolio/holding-explain";
import { SkeletonText } from "@/app/_components/ui";

/**
 * "Why do I own this?" — click-to-reveal, on-demand per holding.
 *
 * Mirrors the established MovementExplainerCard pattern (app/_components/
 * movement-explainer-card.tsx): a button that fetches once and caches locally,
 * never auto-loaded. A holdings table can have dozens of rows — firing an AI
 * call for every one on page load would be pure spend against the AI's per-request
 * serialization for the length of the whole table.
 */
export function WhyOwnThis({ holdingId }: { holdingId: string }) {
  const [explanation, setExplanation] = useState<HoldingExplanation | null>(null);
  const [loading, setLoading] = useState(false);
  const [opened, setOpened] = useState(false);
  const [failed, setFailed] = useState(false);

  async function load() {
    setOpened(true);
    if (explanation) return;
    setLoading(true);
    setFailed(false);
    try {
      const res = await fetch(`/api/portfolio/holding-explain?holdingId=${encodeURIComponent(holdingId)}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to explain holding");
      setExplanation(json as HoldingExplanation);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }

  if (!opened) {
    return (
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); void load(); }}
        className="self-start rounded-full border border-border bg-surface px-3 py-1 text-[11px] font-medium text-muted transition-colors hover:border-accent/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
      >
        Why do I own this?
      </button>
    );
  }

  if (loading) {
    return (
      <div className="flex flex-col gap-1.5">
        <SkeletonText lines={2} />
      </div>
    );
  }

  if (failed || !explanation) {
    return (
      <p className="text-[11px] text-muted">
        Unable to explain this holding right now.{" "}
        <button type="button" onClick={(e) => { e.stopPropagation(); setExplanation(null); void load(); }} className="rounded-sm text-brand hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40">
          Retry
        </button>
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-1 rounded-lg border border-border/60 bg-surface/40 px-3 py-2">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted/70">
        Why do I own this? <span className="font-normal normal-case text-muted/50">· {explanation.confidence}% confidence</span>
      </span>
      <p className="text-[11px] leading-relaxed text-muted">{explanation.explanation}</p>
    </div>
  );
}
