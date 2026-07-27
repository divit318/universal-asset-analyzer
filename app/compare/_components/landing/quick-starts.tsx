"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { LANDING_CONTENT } from "../landing-content";
import type { AssetClassId } from "@/lib/assets/types";

interface Props {
  assetClass: AssetClassId;
  onQuickStart: (symbols: string[]) => void;
  disabled?: boolean;
}

/**
 * Per-asset-class quick starts. Content is keyed by assetClass in
 * LANDING_CONTENT so switching tabs swaps the whole set — the crossfade+rise
 * here is what keeps that swap from reading as an abrupt content jump.
 */
export function QuickStarts({ assetClass, onQuickStart, disabled }: Props) {
  const content = LANDING_CONTENT[assetClass];
  const reduceMotion = useReducedMotion();

  return (
    <div className="flex flex-col items-center gap-5 text-center">
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={assetClass}
          initial={reduceMotion ? { opacity: 1 } : { opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduceMotion ? { opacity: 1 } : { opacity: 0, y: -6 }}
          transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
          className="flex flex-col items-center gap-5"
        >
          <p className="max-w-md text-sm text-muted">{content.subtitle}</p>
          <div className="flex flex-col items-center gap-4">
            {content.groups.map((group) => (
              <div key={group.title} className="flex flex-col items-center gap-2">
                <p className="text-label font-semibold uppercase tracking-widest text-muted/60">
                  {group.title}
                </p>
                <div className="flex flex-wrap justify-center gap-2">
                  {group.items.map((item) => (
                    <button
                      key={item.label}
                      type="button"
                      disabled={disabled}
                      onClick={() => onQuickStart(item.symbols)}
                      className="rounded-lg border border-border bg-surface-2 px-4 py-2 text-sm transition-colors hover:border-brand/30 hover:text-brand disabled:pointer-events-none disabled:opacity-50"
                    >
                      {item.label}
                      <span className="ml-1.5 font-mono text-xs text-muted">
                        {item.symbols.slice(0, 4).join(" · ")}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
