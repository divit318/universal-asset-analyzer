/**
 * Section — the progressive-rendering primitive.
 *
 * Every page is a collection of independent rendering regions. A Section owns
 * one region's loading / success / error / empty / refreshing lifecycle, so one
 * section completing (or failing) can never block, blank, or re-render another.
 *
 * The rules it enforces so that "progressive" doesn't degrade into "janky":
 *
 *   - **Reserved height.** The skeleton occupies the same box as the loaded
 *     content (`minHeight`). Without this, every section popping in shoves the
 *     page down under the user's cursor, and charts mounting into a
 *     mid-layout container re-trigger the documented ResponsiveContainer 0×0
 *     first-paint bug.
 *   - **Empty ≠ loading.** "No insider transactions on file" and "still
 *     fetching insider transactions" are different facts and must never be
 *     shown with the same spinner. `isEmpty` makes the distinction explicit and
 *     required rather than optional.
 *   - **Refresh ≠ load.** A background refresh keeps the current content on
 *     screen with a quiet indicator; it does not blank the section back to a
 *     skeleton. Data you were reading does not disappear because a poll fired.
 *   - **A failed section fails alone.** It renders its own error and its own
 *     retry, and its siblings are untouched.
 */

"use client";

import type { ReactNode } from "react";
import { Card } from "./card";
import { Skeleton, SkeletonText } from "./skeleton";

/**
 * Rendering tiers, in the order the user perceives them. The tier does not gate
 * *when* data is requested — everything is requested at once — it describes what
 * a section's placeholder should look like while its data is in flight.
 */
export type SectionTier = 1 | 2 | 3 | 4;

export interface SectionState<T> {
  status: "idle" | "loading" | "success" | "error";
  data: T | null;
  error: string | null;
  revalidating: boolean;
}

interface SectionProps<T> {
  title?: string;
  /** The store entry driving this region — from `useDataset` or the bundle store. */
  state: SectionState<T>;
  /** Renders on success. Receives non-null data. */
  children: (data: T) => ReactNode;
  /**
   * "No data exists" vs "still loading" — the caller decides, because only it
   * knows whether an empty array means "no filings" or "not fetched yet".
   */
  isEmpty?: (data: T) => boolean;
  /** Shown when `isEmpty` returns true. An honest statement of absence, not a spinner. */
  emptyMessage?: string;
  /** Reserve the loaded content's height so nothing jumps when it arrives. */
  minHeight?: number;
  /** Custom skeleton. Defaults to a shape-matched shimmer for the tier. */
  skeleton?: ReactNode;
  tier?: SectionTier;
  /** Wire this to the store's `refresh` to offer a retry on failure. */
  onRetry?: () => void;
  className?: string;
  /** Render without the Card chrome (for regions that supply their own). */
  bare?: boolean;
}

export function Section<T>({
  title,
  state,
  children,
  isEmpty,
  emptyMessage = "No data available",
  minHeight = 120,
  skeleton,
  tier = 3,
  onRetry,
  className = "",
  bare = false,
}: SectionProps<T>) {
  const body = renderBody();

  // `minHeight` is applied on the *wrapper*, not only the skeleton, so the box
  // is stable across every state transition — skeleton → content → error all
  // occupy at least the same space, and none of them shifts the page.
  const content = (
    <div style={{ minHeight }} className="relative">
      {state.revalidating && state.data != null ? <RefreshingDot /> : null}
      {body}
    </div>
  );

  if (bare) return <div className={className}>{content}</div>;

  return (
    <Card className={className}>
      {title ? (
        <h2 className="mb-3 text-sm font-semibold text-foreground">{title}</h2>
      ) : null}
      {content}
    </Card>
  );

  function renderBody(): ReactNode {
    // Stale data stays on screen through a refresh (see RefreshingDot above);
    // only a section with nothing to show gets a skeleton.
    if (state.status === "loading" || state.status === "idle") {
      if (state.data != null) return children(state.data);
      return skeleton ?? <SectionSkeleton tier={tier} />;
    }

    if (state.status === "error" && state.data == null) {
      return <SectionError message={state.error ?? "This section failed to load"} onRetry={onRetry} />;
    }

    if (state.data == null) return <SectionEmpty message={emptyMessage} />;
    if (isEmpty?.(state.data)) return <SectionEmpty message={emptyMessage} />;

    return (
      <>
        {/* A refresh that failed while data is still displayed: keep the data,
            say so quietly. Throwing away a usable answer because the retry
            failed is strictly worse than showing it with a caveat. */}
        {state.status === "success" && state.error ? (
          <p className="mb-2 text-xs text-warning">
            Couldn&apos;t refresh — showing the last known value.
          </p>
        ) : null}
        {children(state.data)}
      </>
    );
  }
}

/* -------------------------------------------------------------------------- */
/* States                                                                      */
/* -------------------------------------------------------------------------- */

/** Shape-matched shimmer. Tier 4 (AI) gets prose lines; the rest get blocks. */
export function SectionSkeleton({ tier = 3 }: { tier?: SectionTier }) {
  if (tier === 4) {
    return (
      <div className="space-y-2" aria-hidden>
        <Skeleton height="h-3" width="w-1/3" />
        <SkeletonText lines={3} />
      </div>
    );
  }

  return (
    <div className="space-y-2" aria-hidden>
      <Skeleton height="h-3" width="w-1/4" />
      <Skeleton height="h-20" radius="rounded-lg" />
    </div>
  );
}

function SectionError({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex h-full flex-col items-start justify-center gap-2 py-4" role="status">
      <p className="text-sm text-negative">{message}</p>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="rounded-control border border-border px-2.5 py-1 text-xs font-medium text-muted outline-none transition-colors hover:border-border-strong hover:text-foreground focus-visible:ring-2 focus-visible:ring-brand/40"
        >
          Retry
        </button>
      ) : null}
    </div>
  );
}

function SectionEmpty({ message }: { message: string }) {
  // Deliberately not a spinner and not an error: this is a *fact* about the
  // asset ("this company has no insider transactions on file"), and conflating
  // it with "still loading" is one of the ways a research tool loses trust.
  return (
    <div className="flex h-full items-center justify-center py-6">
      <p className="text-sm text-faint">{message}</p>
    </div>
  );
}

/** Unobtrusive "refreshing behind the scenes" affordance — no layout impact. */
function RefreshingDot() {
  return (
    <span
      className="absolute right-0 top-0 flex h-1.5 w-1.5"
      title="Refreshing"
      aria-label="Refreshing"
    >
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand opacity-60" />
      <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-brand" />
    </span>
  );
}
