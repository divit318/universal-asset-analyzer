"use client";

import type { CSSProperties } from "react";
import type { MarketEvent } from "@/lib/types";

const DIR_COLOR = {
  bullish: "text-positive border-positive/30 bg-positive/10",
  bearish: "text-negative border-negative/30 bg-negative/10",
  neutral: "text-muted border-border bg-surface-2",
};

const CAT_STYLE: Record<string, string> = {
  /* macro rides the categorical steel token (dark value is identical to the
     old blue-400); commodity rides --warning (dark value is identical to the
     old orange-400) — both adapt to light automatically. */
  macro:       "text-chart-2 bg-chart-2/10 border-chart-2/20",
  policy:      "text-warning bg-warning/10 border-warning/20",
  company:     "text-accent bg-accent/10 border-accent/20",
  commodity:   "text-warning bg-warning/10 border-warning/20",
  geopolitics: "text-negative bg-negative/10 border-negative/20",
  market:      "text-purple-400 light:text-purple-700 bg-purple-400/10 border-purple-400/20",
  sentiment:   "text-muted bg-muted/10 border-muted/20",
};

export function CausalChainCard({
  event,
  style,
  onShowEvidence,
  highlighted = false,
}: {
  event: MarketEvent;
  style?: CSSProperties;
  onShowEvidence?: () => void;
  highlighted?: boolean;
}) {
  const firstOrder = event.causalChain.filter((e) => e.order === 1);
  const secondOrder = event.causalChain.filter((e) => e.order === 2);
  const sourceCount = event.sources.length;

  return (
    <div
      className={`card-lift animate-fade-rise flex flex-col gap-3 rounded-xl border bg-surface p-4 ${
        highlighted ? "border-accent/60 ring-2 ring-accent/40" : "border-border"
      }`}
      style={style}
    >
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
          {/* Cause → Effect connector: particles flow once, on arrival, from
              the event into its effects — reuses .particle-flow (globals.css). */}
          <div className="particle-flow flex items-center gap-2 px-0.5">
            <span className="text-[9px] font-semibold uppercase tracking-widest text-muted/40">Cause</span>
            <span className="relative h-2 flex-1">
              <span className="particle" style={{ animationDelay: "0ms" }} />
              <span className="particle" style={{ animationDelay: "300ms" }} />
              <span className="particle" style={{ animationDelay: "600ms" }} />
            </span>
            <span className="text-[9px] font-semibold uppercase tracking-widest text-muted/40">Effect</span>
          </div>

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

      {/* Corroboration — a visible signal, not a footnote: a causal tree built
          on one article carries materially less weight than one five outlets
          reported, and the card must not present both with equal confidence. */}
      <div className="flex items-center justify-between gap-2 text-[10px]">
        <button
          type="button"
          onClick={onShowEvidence}
          disabled={!onShowEvidence}
          className={`rounded-full border px-2 py-0.5 font-semibold transition-colors ${
            sourceCount <= 1
              ? "border-warning/40 bg-warning/10 text-warning"
              : "border-border bg-surface-2 text-muted"
          } ${onShowEvidence ? "hover:border-accent/40 hover:text-accent" : ""}`}
          title={onShowEvidence ? "Open source articles" : undefined}
        >
          {sourceCount <= 1 ? "1 source — uncorroborated" : `${sourceCount} sources`}
        </button>
        {event.sources[0]?.url && (
          <a
            href={event.sources[0].url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-muted/60 hover:text-accent hover:underline"
          >
            {event.sources[0].source}
          </a>
        )}
      </div>
    </div>
  );
}
