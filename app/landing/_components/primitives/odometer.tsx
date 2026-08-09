"use client";

import { useEffect, useRef, useState } from "react";
import { prefersReducedMotion } from "../motion/engine";

/**
 * Odometer — monospace digit columns that roll independently, staggered
 * 30ms per column. Tabular figures, fixed column width per character, so
 * nothing reflows while rolling.
 *
 * Contract:
 *   - SSR / no-JS: the final value renders directly (each strip is
 *     positioned at its digit via inline transform), nothing is hidden.
 *   - `play`: when it flips true the digits roll up from 0 (viewport-entry
 *     choreography, Research Hub / Valuation mockups).
 *   - value changes while mounted (currency toggle, model morph): every
 *     affected column rolls to its new digit.
 *   - Reduced motion: transitions suppressed via motion-reduce.
 */
const DIGITS = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];

export function Odometer({
  value,
  play = true,
  className = "",
}: {
  value: string;
  /** While false, digit columns hold at 0 (armed for a viewport-entry roll). */
  play?: boolean;
  className?: string;
}) {
  const [armed, setArmed] = useState(false); // true once hydration confirmed motion
  const rolled = useRef(false);

  useEffect(() => {
    if (prefersReducedMotion()) return;
    if (!rolled.current) {
      // Must match SSR (final value) first, then arm the roll-from-zero entry.
      setArmed(true);
      rolled.current = true;
    }
  }, []);

  const atRest = !armed || play;

  return (
    // Every character, digit or not, renders in an identical 1em leading-none
    // cell so the whole figure shares one baseline (a mixed line-height would
    // stagger "$" and "." against the rolling digits).
    <span className={`inline-flex items-end leading-none tabular-nums ${className}`}>
      <span className="sr-only">{value}</span>
      {Array.from(value).map((ch, i) => {
        const d = DIGITS.indexOf(ch);
        if (d < 0) {
          return (
            <span key={i} aria-hidden="true" className="inline-block h-[1em] leading-none">
              {ch}
            </span>
          );
        }
        return (
          <span key={i} aria-hidden="true" className="inline-flex h-[1em] overflow-hidden">
            <span
              className="flex flex-col leading-none transition-transform duration-700 ease-out motion-reduce:transition-none"
              style={{
                transform: `translateY(${atRest ? -d : 0}em)`,
                transitionDelay: `${i * 30}ms`,
                // Arming (the snap back to 0 before an entry roll) is instant;
                // only the roll itself animates.
                transitionDuration: armed && !play ? "0ms" : undefined,
              }}
            >
              {DIGITS.map((dd) => (
                <span key={dd} className="h-[1em] leading-none">
                  {dd}
                </span>
              ))}
            </span>
          </span>
        );
      })}
    </span>
  );
}
