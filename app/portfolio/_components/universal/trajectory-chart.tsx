"use client";

/**
 * The trend chart behind both Trajectory tiles.
 *
 * One component, two scales. Health and concentration sit side by side in the
 * same card and must read as the same kind of object — same fill treatment, same
 * hover behaviour — but they are not the same kind of number, and the previous
 * shared sparkline hid that by handing both a 0-100 domain. A 9.7pp concentration
 * drift then occupied 10% of a 28px box and rendered as a flat line.
 *
 *   scale="absolute"  Health. Fixed 0-100 with gridlines at every quartile.
 *                     NOT autoscaled: a 74->78 wobble stretched to fill the box
 *                     reads as a collapse, and that is the chart that provokes a
 *                     trade which should not happen.
 *
 *   scale="relative"  Concentration. There is no meaningful ceiling on "how much
 *                     of the book is in one class", so the window follows the
 *                     data — but padded by max(range * 35%, 3pp), never by pure
 *                     min/max. Pure autoscaling would blow a 0.2pp wobble up to
 *                     full height, which is the same lie in the other direction.
 *                     The floor caps how dramatic a small move can look, and the
 *                     labelled axis means the reader can see which window they
 *                     are being shown.
 *
 * The x axis is TIME-proportional, not index-proportional. Snapshots are written
 * per execution, so the real ledger holds a pre/post pair 11 seconds apart and
 * elsewhere a gap of eight days. Spacing by index draws those as equal distances
 * while the header claims "over 18 days" — a chart asserting it is a time series
 * when it is not.
 */

import { useId } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useChartTheme, type ChartTheme } from "@/app/_components/chart-theme";

export type TrajectoryTone = "positive" | "negative" | "neutral";

export interface TrajectorySeriesPoint {
  /** Epoch ms. */
  t: number;
  v: number;
}

const ABSOLUTE_TICKS = [0, 25, 50, 75, 100];
/** Quartiles are drawn as gridlines; only the anchors are worth the label space. */
const ABSOLUTE_LABELLED = new Set([0, 50, 100]);
/** Minimum half-window for a relative scale, in the metric's own units. */
const MIN_PAD = 3;

function toneColor(tone: TrajectoryTone, ct: ChartTheme): string {
  if (tone === "positive") return ct.positive;
  if (tone === "negative") return ct.negative;
  return ct.axis;
}

/** Round a raw tick interval up to something a reader recognises. */
function niceStep(raw: number): number {
  const pow = 10 ** Math.floor(Math.log10(raw));
  const n = raw / pow;
  return (n <= 1.2 ? 1 : n <= 2.5 ? 2 : n <= 6 ? 5 : 10) * pow;
}

/**
 * A padded window plus round ticks inside it.
 *
 * The ticks are chosen independently of the domain rather than by rounding the
 * domain outwards: expanding [24.6, 65.4] to a "nice" [20, 80] to get round
 * numbers would widen the window by half and squash the drift the chart exists
 * to show. Left to itself Recharts labels the raw endpoints, which is where the
 * axis reading "61%" came from.
 */
export function relativeScale(values: number[]): { domain: [number, number]; ticks: number[] } {
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const pad = Math.max((hi - lo) * 0.35, MIN_PAD);
  const domain: [number, number] = [Math.max(0, lo - pad), Math.min(100, hi + pad)];

  const step = niceStep((domain[1] - domain[0]) / 4);
  const ticks: number[] = [];
  for (let v = Math.ceil(domain[0] / step) * step; v <= domain[1]; v += step) {
    ticks.push(Math.round(v * 100) / 100);
  }
  return { domain, ticks };
}

function TrajectoryTooltip({
  active,
  payload,
  style,
  format,
}: {
  active?: boolean;
  payload?: { payload: TrajectorySeriesPoint }[];
  style: React.CSSProperties;
  format: (v: number) => string;
}) {
  const point = payload?.[0]?.payload;
  if (!active || !point) return null;

  return (
    <div style={style}>
      <p className="text-[10px] text-muted">
        {new Date(point.t).toLocaleString(undefined, {
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        })}
      </p>
      <p className="font-mono text-xs font-semibold tabular-nums">{format(point.v)}</p>
    </div>
  );
}

export function TrajectoryChart({
  points,
  tone,
  scale,
  format,
  height = 96,
}: {
  /** Ascending by time. */
  points: TrajectorySeriesPoint[];
  tone: TrajectoryTone;
  scale: "absolute" | "relative";
  format: (v: number) => string;
  height?: number;
}) {
  const ct = useChartTheme();
  // useId() emits characters that are awkward inside a url(#...) reference.
  const gradientId = `traj-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;

  if (points.length < 2) return null;

  const color = toneColor(tone, ct);
  const values = points.map((p) => p.v);
  const first = points[0];
  const last = points[points.length - 1];
  const absolute = scale === "absolute";
  const relative = relativeScale(values);

  /**
   * Which side of the baseline the label goes, so it never lands on the series.
   *
   * Recharts measures a ReferenceLine label against the line's own bounding box,
   * which for a horizontal line has zero height — so "insideTop" resolves BELOW
   * the line and "insideBottom" ABOVE it. Inverted from the reading of the name,
   * and the reason the first pass put both labels on the data.
   */
  const baselineLabelPosition = last.v >= first.v ? "insideTopLeft" : "insideBottomLeft";

  return (
    <ResponsiveContainer width="100%" height={height}>
      {/* The right margin is reserved for the current-value label, which is
          centred on a dot sitting at the very end of the series. */}
      <AreaChart data={points} margin={{ top: 14, right: 34, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.28} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>

        <CartesianGrid vertical={false} stroke={ct.grid} strokeDasharray="2 4" />

        <XAxis
          dataKey="t"
          type="number"
          scale="time"
          domain={["dataMin", "dataMax"]}
          ticks={[first.t, last.t]}
          tickFormatter={(v: number) =>
            new Date(v).toLocaleDateString(undefined, { month: "short", day: "numeric" })
          }
          tick={{ fontSize: 9, fill: ct.axis }}
          tickLine={false}
          axisLine={false}
          height={14}
        />

        <YAxis
          type="number"
          domain={absolute ? [0, 100] : relative.domain}
          ticks={absolute ? ABSOLUTE_TICKS : relative.ticks}
          tickFormatter={(v: number) =>
            absolute ? (ABSOLUTE_LABELLED.has(v) ? String(v) : "") : `${v.toFixed(0)}%`
          }
          tick={{ fontSize: 9, fill: ct.axis }}
          tickLine={false}
          axisLine={false}
          // Wide enough for the longest label each scale can produce ("100",
          // "100%"); at 20 the absolute axis rendered "100" clipped to "00".
          width={absolute ? 26 : 30}
        />

        <Tooltip
          content={<TrajectoryTooltip style={ct.tooltip} format={format} />}
          cursor={{ stroke: ct.axis, strokeWidth: 1, strokeOpacity: 0.35 }}
        />

        {/* Where the window started. Without it the reader has to hold the
            opening value in their head to see whether the line gained or lost. */}
        <ReferenceLine
          y={first.v}
          stroke={ct.axis}
          strokeDasharray="3 3"
          strokeOpacity={0.45}
          label={{
            value: format(first.v),
            position: baselineLabelPosition,
            fontSize: 9,
            fill: ct.axis,
          }}
        />

        <Area
          type="monotone"
          dataKey="v"
          stroke={color}
          strokeWidth={2}
          fill={`url(#${gradientId})`}
          dot={false}
          activeDot={{ r: 3.5, fill: color, stroke: ct.surface, strokeWidth: 1.5 }}
        />

        {/* Current reading, on the chart rather than only above it. */}
        <ReferenceDot
          x={last.t}
          y={last.v}
          r={3}
          fill={color}
          stroke={ct.surface}
          strokeWidth={1.5}
          label={{
            value: format(last.v),
            position: "top",
            // Clears the stroke where the series climbs into its own end point.
            offset: 8,
            fontSize: 10,
            fontWeight: 600,
            fill: color,
          }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
