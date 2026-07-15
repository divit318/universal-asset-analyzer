"use client";

/**
 * Module 10 — Continue Where You Left Off.
 *
 * Real visit history from the `activity` table, not a re-skin of the market
 * timeline. It answers "what was I doing", which nothing else on this page does.
 */

import Link from "next/link";
import { Badge } from "@/app/_components/ui";
import { getHomeModule } from "@/lib/home/registry";
import type { ActivityKind } from "@/lib/home/contracts";
import { ModuleShell } from "../module-shell";
import { useHome, useHomeSlice } from "../home-provider";

const definition = getHomeModule("continue");

const KIND_LABEL: Record<ActivityKind, string> = {
  research: "Research",
  screen: "Screen",
  report: "Report",
  portfolio: "Portfolio",
  watchlist: "Watchlist",
  compare: "Compare",
};

function ago(iso: string): string {
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

export function ContinueModule() {
  const state = useHomeSlice("activity");
  const { refreshDigest } = useHome();

  return (
    <ModuleShell
      definition={definition}
      state={state}
      minHeight={180}
      onRefresh={refreshDigest}
      isEmpty={(d) => d.entries.length === 0}
      emptyMessage="Your recent research will show up here."
    >
      {(d) => (
        <ul className="flex flex-col gap-2">
          {d.entries.map((e) => (
            <li key={`${e.kind}-${e.ref}`}>
              <Link
                href={e.href}
                className="flex items-center justify-between gap-3 rounded-control border border-border bg-surface-2 p-3 outline-none transition-colors hover:border-brand/30 focus-visible:ring-2 focus-visible:ring-brand/40"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <Badge variant="neutral">{KIND_LABEL[e.kind]}</Badge>
                  <span className="truncate text-sm text-foreground">{e.label}</span>
                </span>
                <span className="shrink-0 text-xs text-muted">{ago(e.at)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </ModuleShell>
  );
}
