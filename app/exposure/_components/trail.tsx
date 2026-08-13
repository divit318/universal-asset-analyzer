"use client";

/**
 * The exploration trail.
 *
 * "Portfolio / NVDA / VOO / MSFT / Semiconductors" — where you are, how you got
 * here, and one click back to any point on the path. Without it, deep
 * exploration is a one-way trip that ends with the user reloading the page,
 * which is precisely why the old feature's exploration went two clicks deep and
 * stopped.
 *
 * Backed by browser history, so the platform's own back gesture (button, swipe,
 * ⌘←) walks the trail rather than leaving the feature entirely.
 */

import { VIEW_LABEL, type Selection, type StageView } from "./nav";
import { TONE_COLOR } from "./primitives";

export interface TrailEntry extends Selection {
  label: string;
}

const VIEW_TONE: Record<StageView, "direct" | "fund" | "derived"> = {
  overview: "fund",
  trace: "direct",
  blast: "derived",
  position: "fund",
  overlap: "fund",
  driver: "derived",
  compare: "derived",
};

export function Trail({
  trail,
  onJump,
  onBack,
}: {
  trail: TrailEntry[];
  onJump: (index: number) => void;
  onBack: () => void;
}) {
  return (
    <nav
      aria-label="Exploration trail"
      className="flex min-h-8 flex-wrap items-center gap-x-1 gap-y-1 text-caption"
    >
      {trail.length > 1 ? (
        <button
          onClick={onBack}
          className="mr-1.5 rounded border border-border bg-surface-2 px-1.5 py-0.5 font-mono text-micro text-muted transition-colors duration-[var(--duration-feedback)] hover:border-border-strong hover:text-foreground"
          title="Back (Esc)"
        >
          ← Esc
        </button>
      ) : null}

      {trail.map((entry, i) => {
        const last = i === trail.length - 1;
        return (
          <span key={`${entry.nodeId}-${entry.view}-${i}`} className="flex items-center gap-1">
            {i > 0 ? <span className="text-faint">/</span> : null}
            <button
              onClick={() => onJump(i)}
              disabled={last}
              className={[
                "flex items-center gap-1.5 rounded px-1.5 py-0.5 transition-colors duration-[var(--duration-feedback)]",
                last
                  ? "cursor-default text-foreground"
                  : "text-muted hover:bg-surface-2 hover:text-foreground",
              ].join(" ")}
              title={VIEW_LABEL[entry.view]}
            >
              {i > 0 ? (
                <span
                  aria-hidden
                  className="h-2.5 w-[2px] rounded-full"
                  style={{ background: TONE_COLOR[VIEW_TONE[entry.view]] }}
                />
              ) : null}
              <span className={last ? "font-medium" : ""}>{entry.label}</span>
            </button>
          </span>
        );
      })}
    </nav>
  );
}
