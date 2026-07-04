"use client";

import type { HealthScore, HealthDimension, HealthGrade } from "@/lib/portfolio-analytics";

const GRADE_COLOR: Record<HealthGrade, string> = {
  A: "text-positive",
  B: "text-positive",
  C: "text-amber-400",
  D: "text-orange-400",
  F: "text-negative",
};

const GRADE_BG: Record<HealthGrade, string> = {
  A: "border-positive/30 bg-positive/8",
  B: "border-positive/25 bg-positive/5",
  C: "border-amber-400/30 bg-amber-400/5",
  D: "border-orange-400/30 bg-orange-400/5",
  F: "border-negative/30 bg-negative/5",
};

const TREND_BAR: Record<string, string> = {
  strong:  "bg-positive",
  good:    "bg-positive/70",
  neutral: "bg-amber-400",
  weak:    "bg-orange-400",
  poor:    "bg-negative",
};

function ScoreRing({ score, grade }: { score: number; grade: HealthGrade }) {
  const r = 52;
  const circ = 2 * Math.PI * r;
  const dash = (score / 100) * circ;

  return (
    <div className="relative flex items-center justify-center" style={{ width: 136, height: 136 }}>
      <svg width="136" height="136" className="-rotate-90">
        <circle cx="68" cy="68" r={r} fill="none" stroke="currentColor" strokeWidth="8" className="text-border" />
        <circle
          cx="68" cy="68" r={r} fill="none" strokeWidth="8"
          strokeLinecap="round"
          stroke={score >= 70 ? "#4ade80" : score >= 50 ? "#fbbf24" : "#f87171"}
          strokeDasharray={`${dash} ${circ}`}
          style={{ transition: "stroke-dasharray 0.8s ease" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={`text-3xl font-bold font-mono ${GRADE_COLOR[grade]}`}>{score}</span>
        <span className={`text-xs font-semibold ${GRADE_COLOR[grade]}`}>Grade {grade}</span>
      </div>
    </div>
  );
}

function DimensionRow({ dim }: { dim: HealthDimension }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm text-foreground/80 truncate">{dim.name}</span>
        <span className="font-mono text-xs font-semibold shrink-0 w-8 text-right">{dim.score}</span>
      </div>
      <div className="flex items-center gap-2">
        <div className="flex-1 h-1.5 bg-surface-2 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-700 ${TREND_BAR[dim.trend]}`}
            style={{ width: `${dim.score}%` }}
          />
        </div>
        <span className="text-[10px] text-muted w-14 shrink-0 truncate">{dim.explanation.split(".")[0]}</span>
      </div>
    </div>
  );
}

export function PortfolioHealth({ health }: { health: HealthScore }) {
  return (
    <div className={`rounded-xl border p-5 ${GRADE_BG[health.grade]}`}>
      <div className="flex flex-wrap items-start gap-6">
        {/* Score ring + label */}
        <div className="flex flex-col items-center gap-2 shrink-0">
          <ScoreRing score={health.total} grade={health.grade} />
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted">Health Score</p>
        </div>

        {/* Dimensions grid */}
        <div className="flex-1 min-w-0">
          <p className="text-xs text-muted mb-3 leading-relaxed">{health.summary}</p>
          <div className="grid gap-2.5 sm:grid-cols-2">
            {health.dimensions.map((dim) => (
              <DimensionRow key={dim.name} dim={dim} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export function PortfolioHealthSkeleton() {
  return (
    <div className="rounded-xl border border-border bg-surface p-5">
      <div className="flex flex-wrap gap-6">
        <div className="h-32 w-32 rounded-full bg-surface-2 animate-pulse shrink-0" />
        <div className="flex-1 space-y-3">
          {[1, 2, 3, 4].map((n) => (
            <div key={n} className="h-5 bg-surface-2 rounded animate-pulse" style={{ width: `${70 + n * 5}%` }} />
          ))}
        </div>
      </div>
    </div>
  );
}
