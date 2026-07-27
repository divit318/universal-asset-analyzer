/**
 * Sparkline — a pure-SVG micro chart of a close series.
 *
 * Tone follows the series direction (last vs first close), not a passed colour,
 * so a card can't accidentally paint a falling line green. A degenerate series
 * (fewer than two points) renders nothing rather than a flat line implying data.
 */

interface SparklineProps {
  data: number[];
  /** Overrides the auto direction tone. */
  tone?: "positive" | "negative" | "neutral";
  width?: number;
  height?: number;
  className?: string;
  /** Fill the area under the line. */
  area?: boolean;
}

const TONE_VAR: Record<string, string> = {
  positive: "var(--positive)",
  negative: "var(--negative)",
  neutral: "var(--muted)",
};

export function Sparkline({ data, tone, width = 96, height = 28, className, area = true }: SparklineProps) {
  if (!data || data.length < 2) return <div style={{ width, height }} className={className} aria-hidden />;

  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const stepX = width / (data.length - 1);
  const pad = 2;
  const usableH = height - pad * 2;

  const pts = data.map((v, i) => {
    const x = i * stepX;
    const y = pad + usableH - ((v - min) / span) * usableH;
    return [x, y] as const;
  });

  const line = pts.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const dir = data[data.length - 1] >= data[0] ? "positive" : "negative";
  const color = TONE_VAR[tone ?? dir];
  const areaPath = `${line} L${width} ${height} L0 ${height} Z`;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      className={className}
      preserveAspectRatio="none"
      aria-hidden
    >
      {area ? <path d={areaPath} fill={color} fillOpacity={0.12} /> : null}
      <path d={line} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
