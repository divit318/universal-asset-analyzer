"use client";

import { useEffect, useRef, useState } from "react";

const FLASH_MS = 900;

/**
 * Returns a class to spread onto a value that has just been *refreshed* — a
 * quote re-poll, a re-run screen — so an updated number is briefly marked
 * instead of silently swapping under the user's eyes. Deliberately skips the
 * first render: arrival is the Reveal/CountUp system's job, and flashing on
 * first paint would make every load look like an update.
 *
 * Direction-aware so a price tick reads as up or down at a glance, and a no-op
 * (empty string) when the value hasn't changed, so nothing pulses at idle.
 */
export function useValueFlash(value: number | string | null | undefined): string {
  const previous = useRef(value);
  const [flash, setFlash] = useState<"up" | "down" | "neutral" | null>(null);

  useEffect(() => {
    const prev = previous.current;
    previous.current = value;
    if (prev === value || prev == null || value == null) return;
    const direction =
      typeof prev === "number" && typeof value === "number"
        ? value > prev ? "up" : "down"
        : "neutral";
    // Comparing against the previous committed value is the whole point: the
    // flash is a reaction to a change, so it cannot be derived during render.
    setFlash(direction);
    const handle = setTimeout(() => setFlash(null), FLASH_MS);
    return () => clearTimeout(handle);
  }, [value]);

  if (!flash) return "";
  return `value-flash value-flash-${flash}`;
}
