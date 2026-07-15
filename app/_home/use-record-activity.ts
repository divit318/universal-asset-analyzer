"use client";

/**
 * Records a page visit for the homepage's "Continue where you left off" module.
 *
 * Fire-and-forget by design: the POST is not awaited, its failure is swallowed,
 * and nothing on the calling page depends on it. Logging that you looked at NVDA
 * must never be able to break the page that shows you NVDA.
 */

import { useEffect } from "react";
import type { ActivityKind } from "@/lib/home/contracts";

export function useRecordActivity(
  entry: { kind: ActivityKind; ref: string; label: string; href: string } | null,
) {
  const { kind, ref, label, href } = entry ?? {};

  useEffect(() => {
    if (!kind || !ref || !label || !href) return;

    // Debounced: a symbol typed character-by-character into the research page
    // would otherwise write a row per keystroke.
    const timer = setTimeout(() => {
      void fetch("/api/home/activity", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, ref, label, href }),
      }).catch(() => {
        // Best-effort. See the note above.
      });
    }, 1500);

    return () => clearTimeout(timer);
  }, [kind, ref, label, href]);
}
