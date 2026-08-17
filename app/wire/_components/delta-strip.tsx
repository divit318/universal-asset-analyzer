"use client";

import type { ScanDelta } from "@/lib/wire/delta";

/**
 * Since Your Last Scan — a slim strip of genuine state changes between the
 * scan on screen and the previous one this browser saw. Renders nothing when
 * there is no prior scan or nothing actually changed: an empty changelog is
 * not content.
 */

const TONE = {
  positive: { glyph: "▲", text: "text-positive" },
  negative: { glyph: "▼", text: "text-negative" },
  neutral: { glyph: "→", text: "text-muted" },
};

export function DeltaStrip({ deltas }: { deltas: ScanDelta[] }) {
  if (deltas.length === 0) return null;
  return (
    <div className="animate-fade-rise rounded-xl border border-border bg-surface px-4 py-3">
      <p className="mb-2 text-label font-semibold uppercase tracking-widest text-muted/60">
        Since your last scan
      </p>
      <ul className="flex flex-col gap-1.5">
        {deltas.map((d, i) => {
          const tone = TONE[d.tone];
          return (
            <li key={`${d.kind}-${i}`} className="flex items-baseline gap-2 text-sm leading-5">
              <span className={`shrink-0 font-mono text-xs ${tone.text}`} aria-hidden>
                {tone.glyph}
              </span>
              <span className="min-w-0 text-foreground/85">{d.label}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
