"use client";

import { usePortfolio } from "@/lib/portfolio-context";
import { OBJECTIVE_CONFIG, type PortfolioObjective } from "@/lib/portfolio-analytics";

const OBJECTIVES = Object.entries(OBJECTIVE_CONFIG) as [PortfolioObjective, typeof OBJECTIVE_CONFIG[PortfolioObjective]][];

export function ObjectiveSelector() {
  const { objective, setObjective } = usePortfolio();

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-muted/70">Portfolio Objective</span>
        <div className="h-px flex-1 bg-border/60" />
      </div>
      <div className="flex gap-2 overflow-x-auto pb-0.5 scrollbar-none">
        {OBJECTIVES.map(([id, cfg]) => {
          const isActive = objective === id;
          return (
            <button
              key={id}
              onClick={() => setObjective(id)}
              title={cfg.description}
              className={`flex shrink-0 items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-xs font-medium transition-all ${
                isActive ? cfg.activeColor : cfg.color
              }`}
            >
              <span className="text-[11px] leading-none">{cfg.icon}</span>
              <span>{cfg.label}</span>
              {isActive && (
                <span className="ml-0.5 h-1.5 w-1.5 rounded-full bg-current opacity-70" />
              )}
            </button>
          );
        })}
      </div>
      <p className="text-[11px] text-muted/70 leading-4">
        {OBJECTIVE_CONFIG[objective].description}
        {" — "}AI recommendations and analysis adapt to your selected objective.
      </p>
    </div>
  );
}
