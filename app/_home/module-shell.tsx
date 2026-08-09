"use client";

/**
 * ModuleShell — every homepage module's frame.
 *
 * Owns the five states the brief requires of every module (loading, empty,
 * error, refresh, success) by delegating to `Section`, which already implements
 * that state machine for the rest of the app. Reimplementing it here would have
 * given the homepage a *second*, subtly-different notion of what "empty" looks
 * like; instead the homepage inherits the app's.
 *
 * On top of Section it adds the three things a *module* needs and a section
 * does not:
 *
 *   - **Capability gating.** A module declares `requires: ["portfolio"]`; the
 *     shell renders a call-to-action instead of a zeroed-out card when there is
 *     no portfolio. An empty state that tells you how to fill it beats an empty
 *     state that just says "no data".
 *   - **Lifecycle emission.** mount / loading / success / error / refresh /
 *     expand / collapse, pushed to the provider. Nothing consumes them in
 *     Phase 1. They exist so Phase 2 can animate a module without the module
 *     knowing.
 *   - **Collapse.** Driven by the layout config, not by the module.
 *
 * Presentation components below this line receive `data` and render markup.
 * They hold no state, no fetching, and no knowledge of any of the above.
 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { ChevronDown, RefreshCw } from "lucide-react";
import { Section, type SectionState } from "@/app/_components/ui";
import type { Capability, HomeModuleDefinition } from "@/lib/home/types";
import { useHome } from "./home-provider";

/** What an unmet capability should say, and where it should send the user. */
const UNMET: Record<Capability, { message: string; href: string; cta: string }> = {
  portfolio: {
    message: "Add a holding to see your portfolio here.",
    href: "/portfolio",
    cta: "Add a holding",
  },
  watchlist: {
    message: "Track a few names to see what's moving.",
    href: "/watchlist",
    cta: "Build a watchlist",
  },
  "scanner-snapshot": {
    message: "Run The Wire once to surface opportunities.",
    href: "/wire",
    cta: "Run The Wire",
  },
  ai: {
    message: "Connect an AI provider (Devin CLI login or an API key) to enable AI narration.",
    href: "/settings",
    cta: "Open Settings",
  },
  decisions: {
    message: "Log a few decisions to start building a track record.",
    href: "/journal",
    cta: "Open journal",
  },
};

interface ModuleShellProps<T> {
  definition: HomeModuleDefinition;
  state: SectionState<T>;
  /** True when the module's preconditions aren't met — renders the CTA empty state. */
  unmet?: Capability | null;
  /** "No data" vs "still loading" — only the module knows which. */
  isEmpty?: (data: T) => boolean;
  emptyMessage?: string;
  collapsible?: boolean;
  defaultCollapsed?: boolean;
  minHeight?: number;
  onRefresh?: () => void;
  /** Small caption inline with the header's action cluster, e.g. "Updated 4:51 AM". */
  headerCaption?: ReactNode;
  /**
   * "display" renders the header in the Today page's shared type scale — the
   * title as a section label, the subtitle as a two-line caption — and widens
   * the card padding to 24px. The default header is unchanged for every other
   * module.
   */
  variant?: "default" | "display";
  children: (data: T) => ReactNode;
}

export function ModuleShell<T>({
  definition,
  state,
  unmet = null,
  isEmpty,
  emptyMessage,
  collapsible = false,
  defaultCollapsed = false,
  minHeight = 140,
  onRefresh,
  headerCaption,
  variant = "default",
  children,
}: ModuleShellProps<T>) {
  const { emit } = useHome();
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  // Lifecycle. Phase 2 hangs motion off these; Phase 1 only guarantees they fire.
  useEffect(() => {
    emit("mount", definition.id);
    return () => emit("unmount", definition.id);
  }, [emit, definition.id]);

  const lastStatus = useRef<string | null>(null);
  useEffect(() => {
    if (lastStatus.current === state.status) return;
    lastStatus.current = state.status;
    if (state.status === "loading") emit("loading", definition.id);
    else if (state.status === "success") emit("success", definition.id);
    else if (state.status === "error") emit("error", definition.id);
  }, [state.status, emit, definition.id]);

  useEffect(() => {
    if (state.revalidating) emit("refresh", definition.id);
  }, [state.revalidating, emit, definition.id]);

  const toggle = () => {
    // The emit happens OUTSIDE the state updater: updaters must be pure, and
    // React StrictMode double-invokes them, double-firing the event (CH-05).
    emit(collapsed ? "expand" : "collapse", definition.id);
    setCollapsed((c) => !c);
  };

  const display = variant === "display";
  const cardPadding = display ? "p-6" : "p-4";
  const titleClass = display
    ? "text-[13px] font-semibold uppercase tracking-[0.09em] text-foreground/55"
    : "text-sm font-semibold text-foreground";
  const subtitleClass = display ? "text-sm text-foreground/72" : "text-xs text-muted";

  const header = (
    <div className="mb-3 flex items-start justify-between gap-3">
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex items-center gap-2">
          {collapsible ? (
            <button
              type="button"
              onClick={toggle}
              aria-expanded={!collapsed}
              className={`flex items-center gap-1.5 rounded-control outline-none transition-colors hover:text-brand focus-visible:ring-2 focus-visible:ring-brand/40 ${titleClass}`}
            >
              <ChevronDown
                className={`h-4 w-4 shrink-0 text-muted transition-transform ${collapsed ? "-rotate-90" : ""}`}
                strokeWidth={2}
              />
              {definition.title}
            </button>
          ) : (
            <h2 className={titleClass}>{definition.title}</h2>
          )}
        </div>
        <p className={subtitleClass}>{definition.description}</p>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        {onRefresh ? (
          <button
            type="button"
            onClick={onRefresh}
            aria-label={`Refresh ${definition.title}`}
            className="rounded-control p-1.5 text-muted outline-none transition-colors hover:bg-surface-2 hover:text-foreground focus-visible:ring-2 focus-visible:ring-brand/40"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${state.revalidating ? "animate-spin" : ""}`} strokeWidth={2} />
          </button>
        ) : null}
        {/* Header metadata, one tier below the subtitle (text-sm) — at 14px the
            "Updated …" stamp outweighed the card's own description. */}
        {headerCaption ? <span className="text-xs text-foreground/60">{headerCaption}</span> : null}
        {definition.navTarget ? (
          <Link
            href={definition.navTarget.href}
            className="rounded-control px-2 py-1 text-xs font-medium text-brand outline-none transition-colors hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-brand/40"
          >
            {definition.navTarget.label}
          </Link>
        ) : null}
      </div>
    </div>
  );

  // An unmet precondition is not a loading state and not an error. It is a
  // fact about the user's setup, and it gets its own affordance.
  if (unmet) {
    const cta = UNMET[unmet];
    return (
      <div className={`uaa-card flex h-full flex-col ${cardPadding}`}>
        {header}
        <div className="flex flex-1 flex-col items-start justify-center gap-2 py-6">
          <p className="text-sm text-muted">{cta.message}</p>
          <Link
            href={cta.href}
            className="rounded-control border border-border bg-surface-2 px-3 py-1.5 text-xs font-medium text-foreground outline-none transition-colors hover:border-brand/40 hover:text-brand focus-visible:ring-2 focus-visible:ring-brand/40"
          >
            {cta.cta} →
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className={`uaa-card flex h-full flex-col ${cardPadding}`}>
      {header}
      {collapsed ? null : (
        <Section
          bare
          state={state}
          isEmpty={isEmpty}
          emptyMessage={emptyMessage}
          minHeight={minHeight}
          onRetry={onRefresh}
          className="flex-1"
        >
          {children}
        </Section>
      )}
    </div>
  );
}
