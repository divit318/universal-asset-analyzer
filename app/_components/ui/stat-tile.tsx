type StatTone = "default" | "positive" | "negative" | "warning";

interface StatTileProps {
  label: string;
  value: React.ReactNode;
  sublabel?: React.ReactNode;
  tone?: StatTone;
  className?: string;
}

const TONE_BORDER: Record<StatTone, string> = {
  default: "border-border bg-surface",
  positive: "border-positive/30 bg-positive/5",
  negative: "border-negative/30 bg-negative/5",
  warning: "border-warning/30 bg-warning/5",
};

const TONE_TEXT: Record<StatTone, string> = {
  default: "text-foreground",
  positive: "text-positive",
  negative: "text-negative",
  warning: "text-warning",
};

const TONE_ACCENT: Record<StatTone, string> = {
  default: "bg-border-strong",
  positive: "bg-positive",
  negative: "bg-negative",
  warning: "bg-warning",
};

/** Value + label tile — hero stat rows (portfolio value, P&L, health score, etc).
    A hairline left accent encodes tone; value uses tabular-nums so figures align. */
export function StatTile({ label, value, sublabel, tone = "default", className = "" }: StatTileProps) {
  return (
    <div className={`relative overflow-hidden rounded-card border p-5 shadow-card ${TONE_BORDER[tone]} ${className}`}>
      <span aria-hidden className={`absolute inset-y-3 left-0 w-0.5 rounded-full ${TONE_ACCENT[tone]}`} />
      <span className="text-label font-semibold uppercase tracking-widest text-muted/70">{label}</span>
      <p className={`mt-1 font-mono text-xl font-bold tabular-nums ${TONE_TEXT[tone]}`}>{value}</p>
      {sublabel && <p className="truncate text-xs text-muted">{sublabel}</p>}
    </div>
  );
}
