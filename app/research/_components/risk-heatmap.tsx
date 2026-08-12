import type { RiskItem, RiskLevel } from "@/lib/types";

const LEVEL_STYLE: Record<RiskLevel, string> = {
  low: "border-positive/40 bg-positive/10 text-positive",
  medium: "border-warning/40 bg-warning/10 text-warning",
  high: "border-negative/40 bg-negative/10 text-negative",
};

export function RiskHeatmap({ risks }: { risks: RiskItem[] }) {
  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-sm font-medium">Risk heat map</h3>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {risks.map((r) => (
          <div
            key={r.category}
            className={`flex flex-col gap-1 rounded-xl border p-3 ${LEVEL_STYLE[r.level]}`}
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-foreground">{r.category}</span>
              <span className="text-xs font-semibold uppercase">{r.level}</span>
            </div>
            <p className="text-xs text-muted">{r.reason}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
