"use client";

import type { MarketEvent } from "@/lib/types";

const DIR_COLOR = {
  bullish: "text-positive border-positive/30 bg-positive/10",
  bearish: "text-negative border-negative/30 bg-negative/10",
  neutral: "text-muted border-border bg-surface-2",
};

const CAT_STYLE: Record<string, string> = {
  macro:       "text-blue-400 bg-blue-400/10 border-blue-400/20",
  policy:      "text-amber-400 bg-amber-400/10 border-amber-400/20",
  company:     "text-accent bg-accent/10 border-accent/20",
  commodity:   "text-orange-400 bg-orange-400/10 border-orange-400/20",
  geopolitics: "text-red-400 bg-red-400/10 border-red-400/20",
  market:      "text-purple-400 bg-purple-400/10 border-purple-400/20",
  sentiment:   "text-muted bg-muted/10 border-muted/20",
};

export function CausalChainCard({ event }: { event: MarketEvent }) {
  const firstOrder = event.causalChain.filter((e) => e.order === 1);
  const secondOrder = event.causalChain.filter((e) => e.order === 2);

  return (
    <div className="rounded-xl border border-border bg-surface p-4 flex flex-col gap-3">
      {/* Event header */}
      <div className="flex items-start gap-2 flex-wrap">
        <span
          className={`rounded-full border px-2 py-0.5 text-[10px] font-medium capitalize ${CAT_STYLE[event.category] ?? CAT_STYLE.market}`}
        >
          {event.category}
        </span>
        <h3 className="text-xs font-semibold text-foreground leading-4 flex-1">
          {event.headline}
        </h3>
      </div>

      {event.causalChain.length > 0 && (
        <div className="flex flex-col gap-2">
          {/* First-order effects */}
          {firstOrder.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <span className="text-[9px] font-semibold uppercase tracking-widest text-muted/60">
                1st-Order Effects
              </span>
              {firstOrder.map((effect, i) => (
                <div
                  key={i}
                  className={`flex items-start gap-2 rounded-md border px-2.5 py-1.5 text-xs leading-4 ${DIR_COLOR[effect.direction]}`}
                >
                  <span className="shrink-0 font-bold">
                    {effect.direction === "bullish" ? "↑" : effect.direction === "bearish" ? "↓" : "→"}
                  </span>
                  <div className="flex flex-col gap-0.5">
                    <span>{effect.description}</span>
                    {effect.affectedSectors.length > 0 && (
                      <span className="text-[10px] opacity-70">
                        {effect.affectedSectors.join(", ")}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Second-order effects */}
          {secondOrder.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <span className="text-[9px] font-semibold uppercase tracking-widest text-muted/60">
                2nd-Order Effects
              </span>
              {secondOrder.map((effect, i) => (
                <div
                  key={i}
                  className={`flex items-start gap-2 rounded-md border px-2.5 py-1.5 text-xs leading-4 opacity-80 ${DIR_COLOR[effect.direction]}`}
                >
                  <span className="shrink-0 font-bold">
                    {effect.direction === "bullish" ? "↑" : effect.direction === "bearish" ? "↓" : "→"}
                  </span>
                  <span>{effect.description}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Sources count */}
      <div className="flex items-center gap-2 text-[10px] text-muted/60">
        <span>{event.sources.length} source{event.sources.length !== 1 ? "s" : ""}</span>
        {event.sources[0]?.url && (
          <>
            <span>·</span>
            <a
              href={event.sources[0].url}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-accent hover:underline"
            >
              {event.sources[0].source}
            </a>
          </>
        )}
      </div>
    </div>
  );
}
