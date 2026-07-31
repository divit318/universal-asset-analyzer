"use client";

import { useEffect, useState } from "react";
import type { ThematicReport } from "@/lib/thematic-engine";
import type { ThemeOverlap } from "@/lib/thematic-overlap";
import { Card } from "@/app/_components/ui";
import { readRecent } from "./storage";

/**
 * Cross-theme overlap (PR-4): "how much of this theme do I already own via
 * another one?". Compares the report on screen against every other saved
 * report the Recent list knows about — company overlap, shared proxies, and
 * the correlation of their lead proxies. Renders nothing when there is
 * nothing to compare, which is the common first-run case.
 */
export function ThemeOverlapSection({ report }: { report: ThematicReport }) {
  const [overlaps, setOverlaps] = useState<ThemeOverlap[]>([]);

  useEffect(() => {
    const others = readRecent().filter((t) => t.toLowerCase() !== report.theme.toLowerCase());
    if (others.length === 0) return;
    const controller = new AbortController();
    fetch("/api/thematic/overlap", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ report, others }),
      signal: controller.signal,
    })
      .then((res) => (res.ok ? (res.json() as Promise<{ overlaps?: ThemeOverlap[] }>) : null))
      .then((json) => {
        if (json?.overlaps) setOverlaps(json.overlaps);
      })
      .catch(() => { /* comparison is an enhancement; a failed fetch renders nothing */ });
    return () => controller.abort();
  }, [report]);

  if (overlaps.length === 0) return null;

  return (
    <Card padding="md">
      <h2 className="text-sm font-semibold tracking-tight">Overlap with your other themes</h2>
      <p className="mt-1 text-xs leading-relaxed text-muted">
        Computed from saved reports — how much of this theme you already hold through another one.
      </p>
      <ul className="mt-3 flex flex-col gap-2.5">
        {overlaps.map((o) => (
          <li key={o.theme} className="rounded-card border border-border bg-surface-2 px-3.5 py-2.5 text-sm">
            <span className="font-semibold">{o.theme}</span>
            <span className="text-muted">
              {" "}— shares {o.sharedSymbols.length} of {o.companiesA} name{o.companiesA === 1 ? "" : "s"}
              {o.jaccard != null && o.jaccard > 0 && ` (Jaccard ${Math.round(o.jaccard * 100)}%)`}
            </span>
            {o.sharedSymbols.length > 0 && (
              <span className="font-mono text-xs text-muted">
                {" "}· {o.sharedSymbols.slice(0, 6).join(", ")}
                {o.sharedSymbols.length > 6 && ` +${o.sharedSymbols.length - 6} more`}
              </span>
            )}
            {o.sharedProxies.length > 0 && (
              <span className="text-xs text-muted"> · shared proxies: {o.sharedProxies.join(", ")}</span>
            )}
            {o.proxyCorrelation1Y != null && (
              <span className="text-xs text-muted"> · lead-proxy correlation {o.proxyCorrelation1Y.toFixed(2)}</span>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}
