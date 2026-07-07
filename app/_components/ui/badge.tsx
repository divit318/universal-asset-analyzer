type BadgeVariant = "brand" | "positive" | "negative" | "warning" | "neutral";

interface BadgeProps {
  children: React.ReactNode;
  variant?: BadgeVariant;
  className?: string;
}

const VARIANT: Record<BadgeVariant, string> = {
  brand: "border-brand/30 bg-brand/10 text-brand",
  positive: "border-positive/30 bg-positive/10 text-positive",
  negative: "border-negative/30 bg-negative/10 text-negative",
  warning: "border-warning/30 bg-warning/10 text-warning",
  neutral: "border-border bg-surface-3 text-muted",
};

/** Small pill label — module tags, status chips. Uses the 10px "label" tier. */
export function Badge({ children, variant = "neutral", className = "" }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-label font-medium uppercase tracking-wide ${VARIANT[variant]} ${className}`}
    >
      {children}
    </span>
  );
}
