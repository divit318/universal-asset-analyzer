"use client";

/**
 * Inline 12-quarter ownership visualization for India screener rows.
 *
 * A 64×18 sparkline of the disclosed promoter / FII / DII series (each
 * normalized to its own range — the SHAPE is the signal at this size) plus
 * the shared trend chips ("FII ↓3Q"). Missing quarters break the line into
 * separate segments — a gap is never drawn through.
 *
 * Pure render over data already in the row's attributes: zero requests.
 */

const W = 64;
const H = 18;
const PAD = 1.5;

/** Polyline segments for one series, gapping nulls; normalized to [min,max]. */
function segments(vals: (number | null)[], min: number, max: number): string[] {
  const n = vals.length;
  const range = max - min || 1;
  const x = (i: number) => PAD + (i * (W - 2 * PAD)) / Math.max(1, n - 1);
  const y = (v: number) => H - PAD - ((v - min) / range) * (H - 2 * PAD);

  const out: string[] = [];
  let current: string[] = [];
  vals.forEach((v, i) => {
    if (v == null) {
      if (current.length >= 2) out.push(current.join(" "));
      current = [];
    } else {
      current.push(`${x(i).toFixed(1)},${y(v).toFixed(1)}`);
    }
  });
  if (current.length >= 2) out.push(current.join(" "));
  return out;
}

function parseSeries(csv: string): (number | null)[] {
  return csv.split(",").map((c) => (c === "" ? null : Number(c)));
}

const SERIES: { key: number; label: string; className: string }[] = [
  { key: 0, label: "Promoter", className: "text-chart-2" },
  { key: 1, label: "FII", className: "text-brand" },
  { key: 2, label: "DII", className: "text-warning" },
];

export function OwnershipCell({ hist, trend, asOf }: { hist: string | null; trend: string | null; asOf: string | null }) {
  if (!hist) return <span className="text-xs text-muted">—</span>;

  const parts = hist.split("|");
  if (parts.length < 4) return <span className="text-xs text-muted">—</span>;
  const series = parts.slice(0, 3).map(parseSeries);
  const window = parts[3];

  return (
    <span
      className="inline-flex items-center gap-2"
      title={`Disclosed shareholding, ${window} (SEBI pattern via screener.in)${asOf ? ` · latest ${asOf}` : ""}. Lines: promoter, FII, DII — each scaled to its own range.`}
    >
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden className="shrink-0">
        {SERIES.map(({ key, className }) => {
          const vals = series[key];
          const present = vals.filter((v): v is number => v != null);
          if (present.length < 2) return null;
          const min = Math.min(...present);
          const max = Math.max(...present);
          return segments(vals, min, max).map((points, i) => (
            <polyline
              key={`${key}-${i}`}
              points={points}
              fill="none"
              stroke="currentColor"
              strokeWidth={1.1}
              className={className}
              opacity={0.9}
            />
          ));
        })}
      </svg>
      {trend && <span className="whitespace-nowrap font-mono text-[10px] text-muted">{trend}</span>}
    </span>
  );
}
