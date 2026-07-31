"use client";

import type { ReactNode } from "react";
import { useState } from "react";
import { usePersistedState } from "@/app/_components/use-persisted-state";

/**
 * The one section wrapper every zone on The Wire uses: consistent title row,
 * optional count badge, optional collapse control, consistent spacing.
 *
 * Distinct from the app-wide `ui/Section`, which is a data-lifecycle primitive
 * (SectionState-driven skeleton/error/empty). Zones here get their data from
 * the page's streamed `partial`/`result` merge, own their skeletons per-zone,
 * and what they share is *chrome* — so that is all this component owns.
 *
 * Collapse state persists per section (localStorage, same hook as the
 * watchlist's view state) when `persist` is set; sections that should reset
 * every visit simply omit it and get plain component state.
 */

const isBoolean = (v: unknown): v is boolean => typeof v === "boolean";

interface WireSectionProps {
  /** DOM id — the scroll-spy SectionNav target. */
  id: string;
  title: string;
  /** Compact count/status text rendered as a pill beside the title. */
  badge?: ReactNode;
  /** Extra header controls, right-aligned. */
  actions?: ReactNode;
  collapsible?: boolean;
  defaultCollapsed?: boolean;
  /** Persist collapse state under `uaa.wire.collapsed.<id>` in localStorage. */
  persist?: boolean;
  className?: string;
  children: ReactNode;
}

export function WireSection({
  id,
  title,
  badge,
  actions,
  collapsible = false,
  defaultCollapsed = false,
  persist = false,
  className = "",
  children,
}: WireSectionProps) {
  const persisted = usePersistedState<boolean>(
    `uaa.wire.collapsed.${id}`,
    defaultCollapsed,
    isBoolean,
  );
  const local = useState(defaultCollapsed);
  const [collapsed, setCollapsed] = persist ? persisted : local;

  return (
    <section id={id} className={`flex flex-col gap-4 ${className}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <h2 className="text-sm font-semibold">{title}</h2>
          {badge != null && (
            <span className="rounded-full border border-border bg-surface-2 px-2 py-0.5 text-label font-medium text-muted">
              {badge}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {actions}
          {collapsible && (
            <button
              type="button"
              onClick={() => setCollapsed(!collapsed)}
              aria-expanded={!collapsed}
              aria-controls={`${id}-body`}
              className="flex items-center gap-1 text-xs text-muted transition-colors hover:text-foreground"
            >
              {collapsed ? "Show" : "Hide"}
              <span key={collapsed ? "expand" : "collapse"} className="animate-icon-swap">
                {collapsed ? "+" : "−"}
              </span>
            </button>
          )}
        </div>
      </div>
      {(!collapsible || !collapsed) && <div id={`${id}-body`}>{children}</div>}
    </section>
  );
}
