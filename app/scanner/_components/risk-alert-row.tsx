"use client";

import type { RiskAlert } from "@/lib/types";

const SEVERITY_STYLE = {
  high:   { dot: "bg-negative", badge: "bg-negative/15 text-negative border-negative/30", label: "High" },
  medium: { dot: "bg-warning", badge: "bg-warning/15 text-warning border-warning/30", label: "Medium" },
  low:    { dot: "bg-muted", badge: "bg-muted/15 text-muted border-muted/30", label: "Low" },
};

export function RiskAlertRow({ alert }: { alert: RiskAlert }) {
  const style = SEVERITY_STYLE[alert.severity];
  return (
    <div className="flex items-start gap-3 px-4 py-3 border-b border-border last:border-b-0">
      <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${style.dot}`} />
      <div className="flex flex-col gap-1 flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-semibold text-foreground">{alert.headline}</span>
          <span className={`rounded-full border px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${style.badge}`}>
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
    </div>
  );
}
