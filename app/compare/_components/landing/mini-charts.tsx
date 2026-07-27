import { CHART_SERIES } from "@/app/_components/chart-theme";

/**
 * Hand-rolled SVG chart primitives for the Compare landing page only.
 * Deliberately NOT Recharts: this content renders continuously (feature-card
 * backs, the always-mounted empty-state preview) whereas the real comparison
 * charts are dynamically imported and only mount once ≥2 symbols are added
 * (see app/compare/page.tsx). Pulling Recharts in here would undo that split.
 *
 * All data below is illustrative — fixed, fake fractions/points used purely
 * to preview what the real engine renders, never fetched or computed.
 */

const [SERIES_A, SERIES_B, SERIES_C] = CHART_SERIES;

/* -------------------------------------------------------------------------- */
/* Mini radar                                                                  */
/* -------------------------------------------------------------------------- */

function polygonPoints(fractions: number[], cx: number, cy: number, r: number): string {
  const n = fractions.length;
  return fractions
    .map((f, i) => {
      const angle = -Math.PI / 2 + (i * 2 * Math.PI) / n;
      const x = cx + Math.cos(angle) * r * f;
      const y = cy + Math.sin(angle) * r * f;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

const RADAR_AXES = 5;
const RADAR_A = [0.86, 0.58, 0.92, 0.5, 0.72];
const RADAR_B = [0.52, 0.88, 0.6, 0.82, 0.46];

export function MiniRadar({ size = 120 }: { size?: number }) {
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 8;
  const rings = [0.33, 0.66, 1];

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="presentation" aria-hidden>
      {rings.map((ring) => (
        <polygon
          key={ring}
          points={polygonPoints(Array(RADAR_AXES).fill(ring), cx, cy, r)}
          fill="none"
          stroke="currentColor"
          strokeOpacity={0.12}
          strokeWidth={1}
          className="text-muted"
        />
      ))}
      {Array.from({ length: RADAR_AXES }).map((_, i) => {
        const angle = -Math.PI / 2 + (i * 2 * Math.PI) / RADAR_AXES;
        return (
          <line
            key={i}
            x1={cx}
            y1={cy}
            x2={cx + Math.cos(angle) * r}
            y2={cy + Math.sin(angle) * r}
            stroke="currentColor"
            strokeOpacity={0.1}
            strokeWidth={1}
            className="text-muted"
          />
        );
      })}
      <polygon
        points={polygonPoints(RADAR_B, cx, cy, r)}
        fill={SERIES_B}
        fillOpacity={0.14}
        stroke={SERIES_B}
        strokeWidth={1.5}
        className="animate-radar-breathe"
        style={{ animationDelay: "-1.1s" }}
      />
      <polygon
        points={polygonPoints(RADAR_A, cx, cy, r)}
        fill={SERIES_A}
        fillOpacity={0.16}
        stroke={SERIES_A}
        strokeWidth={1.5}
        className="animate-radar-breathe"
      />
    </svg>
  );
}

/* -------------------------------------------------------------------------- */
/* Mini performance line chart                                                 */
/* -------------------------------------------------------------------------- */

const PATH_A = [4, 34, 10, 24, 24, 16, 34, 12, 44, 15, 54, 8, 64, 2, 74, 6];
const PATH_B = [4, 20, 10, 26, 24, 30, 34, 24, 44, 32, 54, 28, 64, 36, 74, 22];

function toPolyline(pts: number[]): string {
  const out: string[] = [];
  for (let i = 0; i < pts.length; i += 2) out.push(`${pts[i]},${pts[i + 1]}`);
  return out.join(" ");
}

function polylineLength(pts: number[]): number {
  let total = 0;
  for (let i = 2; i < pts.length; i += 2) {
    const dx = pts[i] - pts[i - 2];
    const dy = pts[i + 1] - pts[i - 1];
    total += Math.hypot(dx, dy);
  }
  return total;
}

export function MiniPerformanceChart({ width = 78, height = 40 }: { width?: number; height?: number }) {
  const lenA = polylineLength(PATH_A);
  const lenB = polylineLength(PATH_B);

  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 78 40"
      role="presentation"
      aria-hidden
      preserveAspectRatio="none"
    >
      <polyline
        points={toPolyline(PATH_B)}
        fill="none"
        stroke={SERIES_C}
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="animate-line-draw"
        style={{ ["--line-length" as string]: lenB }}
      />
      <polyline
        points={toPolyline(PATH_A)}
        fill="none"
        stroke={SERIES_A}
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="animate-line-draw"
        style={{ ["--line-length" as string]: lenA, animationDelay: "0.15s" }}
      />
    </svg>
  );
}

/* -------------------------------------------------------------------------- */
/* Mini ranked verdict                                                         */
/* -------------------------------------------------------------------------- */

export interface MiniRankRow {
  rank: number;
  label: string;
  color: string;
  note: string;
  sign: "+" | "−";
}

const RANK_ROWS: MiniRankRow[] = [
  { rank: 1, label: "A", color: SERIES_A, note: "Margin expansion", sign: "+" },
  { rank: 2, label: "B", color: SERIES_B, note: "Diversified base", sign: "+" },
  { rank: 3, label: "C", color: SERIES_C, note: "Valuation stretched", sign: "−" },
];

export function MiniRankedVerdict({ confidence = 82 }: { confidence?: number }) {
  return (
    <div className="flex w-full flex-col gap-1.5">
      {RANK_ROWS.map((row) => (
        <div key={row.rank} className="flex items-center gap-2">
          <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-border text-[9px] font-semibold text-muted">
            {row.rank}
          </span>
          <span className="font-mono text-xs font-semibold" style={{ color: row.color }}>
            {row.label}
          </span>
          <span className={`truncate text-[10px] leading-none ${row.sign === "+" ? "text-positive" : "text-negative"}`}>
            {row.sign} {row.note}
          </span>
        </div>
      ))}
      <div className="mt-1 flex items-center gap-1.5">
        <div className="h-1 flex-1 overflow-hidden rounded-full bg-surface-3">
          <div className="h-full rounded-full bg-brand" style={{ width: `${confidence}%` }} />
        </div>
        <span className="text-[9px] font-medium text-muted">{confidence}% confidence</span>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Mini metric table                                                          */
/* -------------------------------------------------------------------------- */

const TABLE_ROWS: { label: string; values: [string, string, string]; bestIdx: number }[] = [
  { label: "Fwd P/E", values: ["18.2x", "24.6x", "31.4x"], bestIdx: 0 },
  { label: "Revenue Gr.", values: ["+22%", "+14%", "+9%"], bestIdx: 0 },
  { label: "ROE", values: ["31%", "19%", "42%"], bestIdx: 2 },
  { label: "Net Debt/EBITDA", values: ["0.4x", "1.8x", "1.1x"], bestIdx: 0 },
];

export function MiniMetricTable() {
  const colors = [SERIES_A, SERIES_B, SERIES_C];
  return (
    <table className="w-full border-collapse text-left">
      <thead>
        <tr>
          <th className="w-1/3" />
          {["A", "B", "C"].map((l, i) => (
            <th key={l} className="pb-1 text-right font-mono text-[10px] font-bold" style={{ color: colors[i] }}>
              {l}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {TABLE_ROWS.map((row) => (
          <tr key={row.label} className="border-t border-border/60">
            <td className="py-1 text-[10px] text-muted">{row.label}</td>
            {row.values.map((v, i) => (
              <td
                key={i}
                className={`py-1 text-right font-mono text-[10px] ${i === row.bestIdx ? "text-positive" : "text-foreground/80"}`}
              >
                {v}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
