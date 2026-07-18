/**
 * HealthRadar — a pure-SVG radar of the portfolio's health dimensions.
 *
 * No charting library: a radar is a dozen lines of trigonometry, and pulling
 * Recharts in for it would ship a polar-chart bundle to render six points. The
 * polygon is the health engine's real dimension scores; faded spokes are the
 * dimensions that abstained (coverage 0), drawn at their fallback so the shape
 * stays closed rather than collapsing to the centre and reading as "zero".
 */

import type { HealthRadarAxis } from "@/lib/home/contracts";

const CX = 110;
const CY = 104;
const MAX_R = 74;
const RINGS = [0.25, 0.5, 0.75, 1];

function pointAt(angleDeg: number, radius: number): [number, number] {
  const rad = (angleDeg * Math.PI) / 180;
  return [CX + radius * Math.cos(rad), CY + radius * Math.sin(rad)];
}

function polygon(axes: HealthRadarAxis[], scale: (a: HealthRadarAxis) => number): string {
  return axes
    .map((a, i) => {
      const angle = -90 + (i * 360) / axes.length;
      const [x, y] = pointAt(angle, MAX_R * scale(a));
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

export function HealthRadar({ axes, className }: { axes: HealthRadarAxis[]; className?: string }) {
  if (axes.length < 3) return null;

  const dataPoints = polygon(axes, (a) => Math.max(0, Math.min(1, a.score / 100)));

  return (
    <svg
      viewBox="0 0 220 208"
      className={className}
      role="img"
      aria-label="Portfolio health radar across risk dimensions"
    >
      {/* concentric reference rings */}
      {RINGS.map((r) => (
        <polygon
          key={r}
          points={polygon(axes, () => r)}
          fill="none"
          stroke="var(--grid-line, var(--border))"
          strokeWidth={r === 1 ? 1 : 0.75}
          opacity={r === 1 ? 0.7 : 0.4}
        />
      ))}

      {/* spokes + labels */}
      {axes.map((a, i) => {
        const angle = -90 + (i * 360) / axes.length;
        const [sx, sy] = pointAt(angle, MAX_R);
        const [lx, ly] = pointAt(angle, MAX_R + 16);
        const anchor = Math.abs(Math.cos((angle * Math.PI) / 180)) < 0.3 ? "middle" : lx > CX ? "start" : "end";
        return (
          <g key={a.axis}>
            <line x1={CX} y1={CY} x2={sx} y2={sy} stroke="var(--border)" strokeWidth={0.6} opacity={0.5} />
            <text
              x={lx}
              y={ly}
              textAnchor={anchor}
              dominantBaseline="middle"
              className="fill-muted"
              style={{ fontSize: 9, fontWeight: 600 }}
              opacity={a.covered ? 1 : 0.45}
            >
              {a.shortLabel}
            </text>
            <text
              x={lx}
              y={ly + 9}
              textAnchor={anchor}
              dominantBaseline="middle"
              className="fill-foreground"
              style={{ fontSize: 8.5, fontVariantNumeric: "tabular-nums" }}
              opacity={a.covered ? 0.75 : 0.35}
            >
              {Math.round(a.score)}
            </text>
          </g>
        );
      })}

      {/* the data polygon */}
      <polygon
        points={dataPoints}
        fill="var(--brand)"
        fillOpacity={0.16}
        stroke="var(--brand)"
        strokeWidth={1.75}
        strokeLinejoin="round"
      />
      {axes.map((a, i) => {
        const angle = -90 + (i * 360) / axes.length;
        const [x, y] = pointAt(angle, MAX_R * Math.max(0, Math.min(1, a.score / 100)));
        return <circle key={a.axis} cx={x} cy={y} r={2.4} fill="var(--brand)" opacity={a.covered ? 1 : 0.4} />;
      })}
    </svg>
  );
}
