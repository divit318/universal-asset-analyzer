import type { RiskItem, RiskLevel } from "@/lib/types";
import { isMaterial } from "@/lib/materiality";

const LEVEL_STYLE: Record<RiskLevel, string> = {
  low: "border-positive/40 bg-positive/10 text-positive",
  medium: "border-warning/40 bg-warning/10 text-warning",
  high: "border-negative/40 bg-negative/10 text-negative",
};

export function RiskHeatmap({ risks, lensActive = false }: { risks: RiskItem[]; lensActive?: boolean }) {
  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-sm font-medium">Risk heat map</h3>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {risks.map((r) => {
          // Same judgment the page's flag count uses — routed through
          // lib/materiality.ts so a tile can never disagree with the header.
          const verdict = isMaterial(
            { kind: "risk", category: r.category, level: r.level, detail: r.reason },
            { now: 0 },
          );
          const fade = lensActive && !verdict.material;
          return (
            <div
              key={r.category}
              title={lensActive ? verdict.reason : undefined}
              className={`flex flex-col gap-1 rounded-xl border p-3 transition-opacity duration-200 ${LEVEL_STYLE[r.level]} ${fade ? "opacity-30" : ""}`}
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-foreground">{r.category}</span>
                <span className="text-xs font-semibold uppercase">{r.level}</span>
              </div>
              <p className="text-xs text-muted">{r.reason}</p>
            </div>
          );
        })}
      </div>
    </section>
  );
}
