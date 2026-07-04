"use client";

import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";
import type { ThesisEvolution } from "@/lib/types";
import { formatDate } from "@/lib/format";

const STANCE_STYLE = {
  strengthened: { label: "Strengthening", cls: "text-positive" },
  weakened: { label: "Weakening", cls: "text-negative" },
  unchanged: { label: "Unchanged", cls: "text-muted" },
};

export function ThesisEvolutionPanel({ evolution }: { evolution: ThesisEvolution }) {
  const stance = STANCE_STYLE[evolution.currentStance];
  const chartData = evolution.points.map((p) => ({
    date: p.timestamp.slice(0, 10),
    confidence: p.thesisConfidence,
    title: p.title,
  }));

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-widest text-accent">Thesis Evolution</h3>
          <p className="text-[11px] text-muted">How the investment case has evolved across every important event.</p>
        </div>
        <div className="text-right">
          <div className={`text-sm font-semibold ${stance.cls}`}>{stance.label}</div>
          <div className="text-xs text-muted">Confidence: {evolution.currentConfidence}/100</div>
        </div>
      </div>

      {chartData.length > 1 && (
        <div className="h-32 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: -24 }}>
              <XAxis dataKey="date" hide />
              <YAxis domain={[0, 100]} width={28} tick={{ fontSize: 9, fill: "var(--muted)" }} />
              <ReferenceLine y={50} stroke="var(--border)" strokeDasharray="3 3" />
              <Tooltip
                contentStyle={{ background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 11 }}
                labelFormatter={(v) => formatDate(v as string)}
                formatter={(value) => [`${value}/100`, "Thesis confidence"]}
              />
              <Line type="monotone" dataKey="confidence" stroke="var(--accent)" strokeWidth={2} dot={{ r: 2 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {evolution.points.length === 0 ? (
        <p className="text-xs text-muted">No high-importance events yet — thesis evolution needs at least one important event.</p>
      ) : (
        <ul className="flex flex-col gap-1.5 border-t border-border pt-3">
          {[...evolution.points].reverse().slice(0, 8).map((p) => {
            const dir = STANCE_STYLE[p.direction];
            return (
              <li key={p.eventId} className="flex items-baseline gap-2 text-xs">
                <span className="w-20 shrink-0 font-mono text-[10px] text-muted/60">{formatDate(p.timestamp)}</span>
                <span className={`shrink-0 text-[10px] font-semibold ${dir.cls}`}>{dir.label}</span>
                <span className="truncate text-muted">{p.title}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
