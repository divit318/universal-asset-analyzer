"use client";

import type { ScreenerInShareholding } from "@/lib/screener-in";

const COLORS: Record<string, string> = {
  promoter: "bg-accent",
  fii: "bg-blue-400",
  dii: "bg-violet-400",
  retail: "bg-yellow-400",
  public: "bg-orange-400",
};

function getColor(name: string): string {
  const lower = name.toLowerCase();
  for (const [key, cls] of Object.entries(COLORS)) {
    if (lower.includes(key)) return cls;
  }
  return "bg-muted";
}

export function ShareholdingChart({ rows }: { rows: ScreenerInShareholding[] }) {
  if (!rows.length) return null;

  // Show only the latest quarter's values.
  const data = rows
    .map((r) => ({
      name: r.name,
      value: parseFloat(r.values.at(-1) ?? "0"),
    }))
    .filter((d) => d.value > 0);

  return (
    <div className="flex flex-col gap-3">
      {data.map((d) => (
        <div key={d.name} className="flex items-center gap-3">
          <span className="w-36 shrink-0 text-xs text-muted">{d.name}</span>
          <div className="flex-1">
            <div className="h-2 overflow-hidden rounded-full bg-surface-2">
              <div
                className={`h-full rounded-full ${getColor(d.name)}`}
                style={{ width: `${Math.min(100, d.value)}%` }}
              />
            </div>
          </div>
          <span className="w-12 text-right font-mono text-xs">{d.value.toFixed(1)}%</span>
        </div>
      ))}
    </div>
  );
}
