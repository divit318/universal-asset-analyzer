"use client";

import type { CSSProperties } from "react";
import type { RiskAlert } from "@/lib/types";

const SEVERITY_STYLE = {
  high:   { dot: "bg-negative", badge: "bg-negative/15 text-negative border-negative/30", label: "High" },
  medium: { dot: "bg-warning", badge: "bg-warning/15 text-warning border-warning/30", label: "Medium" },
  low:    { dot: "bg-muted", badge: "bg-muted/15 text-muted border-muted/30", label: "Low" },
};

export function RiskAlertRow({
  alert,
  style: rowStyle,
  onShowEvidence,
  highlighted = false,
}: {
  alert: RiskAlert;
  style?: CSSProperties;
  onShowEvidence?: () => void;
  highlighted?: boolean;
}) {
  const style = SEVERITY_STYLE[alert.severity];
  const highSeverity = alert.severity === "high";
  return (
    <div
      className={`flex items-start gap-3 border-b border-border px-4 py-3 last:border-b-0 animate-fade-rise ${highSeverity ? "animate-border-shimmer" : ""} ${
        highlighted ? "bg-accent/5 ring-1 ring-inset ring-accent/40" : ""
      }`}
      style={rowStyle}
    >
      {/* High-severity alerts get a gentle pulse — same ping+dot primitive as
          the header's Live indicator, so "urgent" reads consistently across
          the page rather than reusing the generic loading-skeleton pulse. */}
      {highSeverity ? (
        <span className="relative mt-1.5 flex h-2 w-2 shrink-0">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-negative opacity-75" />
          <span className={`relative inline-flex h-2 w-2 rounded-full ${style.dot}`} />
        </span>
      ) : (
        <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${style.dot}`} />
      )}
      <div className="flex flex-col gap-1 flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-semibold text-foreground">{alert.headline}</span>
          <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${style.badge}`}>
            {style.label}
          </span>
        </div>
        <p className="text-[11px] leading-4 text-muted">{alert.rationale}</p>
        {alert.affectedSectors.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-0.5">
            {alert.affectedSectors.map((s) => (
              <span key={s} className="text-[10px] text-muted/60 border border-border rounded px-1.5 py-0.5">
                {s}
              </span>
            ))}
          </div>
        )}
      </div>
      {onShowEvidence && (
        <button
          type="button"
          onClick={onShowEvidence}
          className="shrink-0 self-center rounded-full border border-border bg-surface-2 px-2 py-0.5 text-[10px] font-medium text-muted transition-colors hover:border-accent/40 hover:text-accent"
          title="Open related coverage (matched by sector/ticker)"
        >
          Evidence
        </button>
      )}
    </div>
  );
}
