"use client";

import { useEffect, useRef, useState } from "react";
import { ScatterChart, Scatter, XAxis, YAxis, ReferenceLine, Tooltip } from "recharts";
import type { OpportunityMapNode } from "@/lib/opportunity-map";
import { CATEGORY_COLOR } from "./category-colors";

const RISK_X: Record<OpportunityMapNode["expectedVolatility"], number> = { Low: 20, Medium: 50, High: 82 };
const CONVICTION_RADIUS: Record<OpportunityMapNode["conviction"], number> = { High: 11, Medium: 8, Low: 5.5 };

interface QuadrantPoint extends OpportunityMapNode {
  x: number;
  y: number;
}

/** Custom Scatter shape — draws each opportunity as a colored circle sized by conviction. Bypasses Recharts' ZAxis size-scaling, which produced zero-radius symbols in this setup. */
function makeShape(selectedId: string | null, onSelect: (id: string) => void) {
  return function OpportunityDot(props: { cx?: number; cy?: number; payload?: QuadrantPoint }) {
    const { cx, cy, payload } = props;
    if (cx == null || cy == null || !payload) return null;
    const r = CONVICTION_RADIUS[payload.conviction];
    const color = CATEGORY_COLOR[payload.category];
    const isSelected = payload.id === selectedId;
    return (
      <circle
        cx={cx}
        cy={cy}
        r={r}
        fill={color}
        fillOpacity={0.55}
        stroke={isSelected ? "var(--foreground)" : color}
        strokeWidth={isSelected ? 2.5 : 1}
        onClick={() => onSelect(payload.id)}
        style={{ cursor: "pointer" }}
      />
    );
  };
}

/** Deterministic pseudo-jitter from the node id, so points render identically across re-renders (no Math.random() during render). */
function jitterFor(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return ((hash % 1000) / 1000 - 0.5) * 8;
}

export function QuadrantView({
  nodes,
  selectedId,
  onSelect,
}: {
  nodes: OpportunityMapNode[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const data: QuadrantPoint[] = nodes.map((n) => ({
    ...n,
    x: RISK_X[n.expectedVolatility] + jitterFor(n.id), // deterministic jitter so same-tier points don't fully overlap
    y: n.opportunityScore,
  }));

  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    // Recharts' own ResponsiveContainer can measure 0x0 on first paint inside a
    // CSS grid column (a known Recharts sizing gotcha) — measure explicitly instead.
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={containerRef} className="relative h-[560px] w-full rounded-xl border border-border bg-surface p-4">
      <div className="pointer-events-none absolute inset-4 grid grid-cols-2 grid-rows-2 text-[10px] uppercase tracking-widest text-muted/40">
        <span className="p-2">Low Risk · High Score</span>
        <span className="p-2 text-right">High Risk · High Score</span>
        <span className="self-end p-2">Low Risk · Low Score</span>
        <span className="self-end p-2 text-right">High Risk · Low Score</span>
      </div>
      {size.width > 0 && size.height > 0 && (
        <ScatterChart width={size.width} height={size.height} margin={{ top: 20, right: 20, bottom: 20, left: 10 }}>
          <XAxis
            type="number"
            dataKey="x"
            domain={[0, 100]}
            tick={{ fontSize: 10, fill: "var(--muted)" }}
            label={{ value: "Expected Risk →", position: "insideBottom", offset: -5, fontSize: 10, fill: "var(--muted)" }}
          />
          <YAxis
            type="number"
            dataKey="y"
            domain={[0, 100]}
            tick={{ fontSize: 10, fill: "var(--muted)" }}
            label={{ value: "Opportunity Score →", angle: -90, position: "insideLeft", fontSize: 10, fill: "var(--muted)" }}
          />
          <ReferenceLine x={50} stroke="var(--border)" strokeDasharray="3 3" />
          <ReferenceLine y={50} stroke="var(--border)" strokeDasharray="3 3" />
          <Tooltip
            cursor={{ strokeDasharray: "3 3" }}
            contentStyle={{ background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 11 }}
            formatter={(_value, _name, item) => {
              const p = item.payload as OpportunityMapNode;
              return [`${p.opportunityScore}/100 score · ${p.expectedVolatility} risk · ${p.conviction} conviction`, p.symbol];
            }}
          />
          <Scatter data={data} shape={makeShape(selectedId, onSelect)} isAnimationActive={false} />
        </ScatterChart>
      )}
    </div>
  );
}
