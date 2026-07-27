import { getAssetClass } from "@/lib/assets/registry";
import type { AssetClassId } from "@/lib/assets/types";
import type { ClassCompareEntry } from "@/lib/compare/types";

/**
 * The deterministic risk-flag counterpart to equity's Risk Comparison
 * section — reuses each class's own `warnings` array (lib/assets/*.ts),
 * evaluated per compared symbol in app/api/compare/class/route.ts. Generic
 * across every non-equity class, not just ETF, since the underlying
 * registry field already exists for all of them.
 */
export function RiskFlagsSection({
  entries,
  colors,
  assetClass,
}: {
  entries: ClassCompareEntry[];
  colors: readonly string[];
  assetClass: AssetClassId;
}) {
  const def = getAssetClass(assetClass);

  return (
    <div className="overflow-hidden rounded-xl border border-border">
      <div className="bg-surface-2 px-4 py-3">
        <span className="text-sm font-semibold">{def.label} Risk Flags</span>
      </div>
      <div
        className="grid gap-3 border-t border-border bg-surface p-4"
        style={{ gridTemplateColumns: `repeat(${entries.length}, minmax(0, 1fr))` }}
      >
        {entries.map((e, i) => (
          <div key={e.symbol}>
            <span className="font-mono text-sm font-bold" style={{ color: colors[i % colors.length] }}>{e.symbol}</span>
            {e.riskFlags && e.riskFlags.length > 0 ? (
              <ul className="mt-1.5 flex flex-col gap-1">
                {e.riskFlags.map((f) => (
                  <li key={f.id} className="text-xs leading-5 text-negative">⚠ {f.label}</li>
                ))}
              </ul>
            ) : (
              <p className="mt-1.5 text-xs text-positive">No flags</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
