"use client";

/**
 * IC Report — shared UI primitives.
 *
 * Severity, confidence and direction always carry a TEXT label alongside
 * colour (Phase 8.2): meaning is never encoded by colour alone. Chip layout
 * survives multi-line rows (Phase 5.14): chips are inline-flex with
 * shrink-0 and never collapse into clipped circles.
 */

import type { ReactNode } from "react";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-border bg-surface p-5 ${className}`}>
      {children}
    </div>
  );
}

export function SectionHeading({ children, id }: { children: ReactNode; id?: string }) {
  return (
    <h2 id={id} className="mb-4 border-b border-border pb-2 text-lg font-semibold tracking-tight">
      {children}
    </h2>
  );
}

const SEV_CHIP: Record<string, string> = {
  high: "border-negative/40 bg-negative/10 text-negative",
  medium: "border-warning/40 bg-warning/10 text-warning",
  low: "border-positive/40 bg-positive/10 text-positive",
};

export function SeverityChip({ severity }: { severity: "high" | "medium" | "low" }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center self-start whitespace-nowrap rounded-full border px-2 py-0.5 text-label font-semibold uppercase tracking-wide ${SEV_CHIP[severity]}`}
    >
      {severity} severity
    </span>
  );
}

const CONF_CHIP: Record<string, string> = {
  high: "border-positive/40 bg-positive/10 text-positive",
  medium: "border-warning/40 bg-warning/10 text-warning",
  low: "border-negative/40 bg-negative/10 text-negative",
};

export function ConfidenceChip({ confidence }: { confidence: "high" | "medium" | "low" }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center self-start whitespace-nowrap rounded-full border px-2 py-0.5 text-label font-semibold uppercase tracking-wide ${CONF_CHIP[confidence]}`}
    >
      {confidence} confidence
    </span>
  );
}

/** Direction keyed to MEANING (upside/downside), not to arithmetic sign of a string. */
export function DirectionValue({
  value,
  format,
  adverseWhenNegative = true,
  className = "",
}: {
  value: number | null | undefined;
  format: (v: number) => string;
  adverseWhenNegative?: boolean;
  className?: string;
}) {
  if (value == null || !Number.isFinite(value)) {
    return <span className={`text-muted ${className}`}>not available</span>;
  }
  const adverse = adverseWhenNegative ? value < 0 : value > 0;
  const tone = value === 0 ? "text-muted" : adverse ? "text-negative" : "text-positive";
  return <span className={`${tone} ${className}`}>{format(value)}</span>;
}

export function EmptyState({ title, detail }: { title: string; detail?: string }) {
  return (
    <Card className="py-10 text-center">
      <p className="text-sm font-medium">{title}</p>
      {detail && <p className="mt-1 text-xs text-muted">{detail}</p>}
    </Card>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-surface-2 ${className}`} aria-hidden="true" />;
}

export function SkeletonCard({ lines = 3 }: { lines?: number }) {
  return (
    <Card>
      <Skeleton className="mb-3 h-4 w-1/3" />
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} className={`mb-2 h-3 ${i === lines - 1 ? "w-2/3" : "w-full"}`} />
      ))}
    </Card>
  );
}
