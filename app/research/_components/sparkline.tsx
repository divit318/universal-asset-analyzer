import type { HistoryPoint } from "@/lib/types";

/** Lightweight inline SVG price chart — no charting dependency. */
export function Sparkline({
  data,
  width = 640,
  height = 160,
}: {
  data: HistoryPoint[];
  width?: number;
  height?: number;
}) {
  if (data.length < 2) {
    return (
      <div className="flex h-40 items-center justify-center rounded-lg border border-border bg-surface text-sm text-muted">
        No price history available
      </div>
    );
  }

  const closes = data.map((d) => d.close);
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const range = max - min || 1;
  const pad = 6;

  const points = data.map((d, i) => {
    const x = (i / (data.length - 1)) * (width - pad * 2) + pad;
    const y = height - pad - ((d.close - min) / range) * (height - pad * 2);
    return [x, y] as const;
  });

  const path = points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const areaPath = `${path} L${points[points.length - 1][0].toFixed(1)},${height} L${points[0][0].toFixed(1)},${height} Z`;
  const up = closes[closes.length - 1] >= closes[0];
  const stroke = up ? "var(--color-positive)" : "var(--color-negative)";

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="h-40 w-full rounded-lg border border-border bg-surface"
      preserveAspectRatio="none"
      role="img"
      aria-label="Price history chart"
    >
      <path d={areaPath} fill={stroke} fillOpacity={0.08} />
      <path d={path} fill="none" stroke={stroke} strokeWidth={1.5} />
    </svg>
  );
}
