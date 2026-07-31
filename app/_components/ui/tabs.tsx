"use client";

import { useRef } from "react";

export interface TabItem<T extends string> {
  id: T;
  label: string;
  badge?: number;
  badgeVariant?: "brand" | "negative";
}

interface TabsProps<T extends string> {
  tabs: TabItem<T>[];
  active: T;
  onChange: (id: T) => void;
  /** Retained for call-site compatibility; the underline is now CSS-driven. */
  layoutId?: string;
  /**
   * When set, each tab gets `id="{idBase}-tab-{tabId}"` and
   * `aria-controls="{idBase}-panel-{tabId}"` — pair the content with
   * `<TabPanel idBase tabId>` so assistive tech can connect the two.
   */
  idBase?: string;
}

/**
 * Tab bar with an animated underline under the active tab.
 *
 * Follows the WAI-ARIA tabs pattern: one roving tab stop for the whole bar
 * (the active tab), Left/Right/Home/End move focus and select. Previously
 * every tab was its own tab stop and the arrow keys did nothing, on every
 * consumer in the app.
 */
export function Tabs<T extends string>({ tabs, active, onChange, idBase }: TabsProps<T>) {
  const listRef = useRef<HTMLDivElement>(null);

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const idx = tabs.findIndex((t) => t.id === active);
    let next = -1;
    if (e.key === "ArrowRight") next = (idx + 1) % tabs.length;
    else if (e.key === "ArrowLeft") next = (idx - 1 + tabs.length) % tabs.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = tabs.length - 1;
    if (next < 0 || !tabs[next]) return;
    e.preventDefault();
    onChange(tabs[next].id);
    const buttons = listRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    buttons?.[next]?.focus();
  }

  return (
    <div
      ref={listRef}
      role="tablist"
      onKeyDown={onKeyDown}
      className="flex items-center gap-1 overflow-x-auto border-b border-border"
    >
      {tabs.map((t) => {
        const isActive = active === t.id;
        return (
          <button
            key={t.id}
            role="tab"
            id={idBase ? `${idBase}-tab-${t.id}` : undefined}
            aria-controls={idBase ? `${idBase}-panel-${t.id}` : undefined}
            aria-selected={isActive}
            tabIndex={isActive ? 0 : -1}
            onClick={() => onChange(t.id)}
            className={`relative shrink-0 px-4 py-2.5 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-brand/40 ${
              isActive ? "font-semibold text-foreground" : "font-medium text-muted hover:text-foreground"
            }`}
          >
            {t.label}
            {typeof t.badge === "number" && t.badge > 0 && (
              <span
                className={`ml-1.5 inline-flex h-4 w-4 items-center justify-center rounded-full text-micro font-bold text-background ${
                  t.badgeVariant === "brand" ? "bg-brand" : "bg-negative"
                }`}
              >
                {t.badge}
              </span>
            )}
            {isActive && (
              <span className="animate-fade-rise absolute inset-x-4 -bottom-px h-0.5 rounded-full bg-brand" />
            )}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Content wrapper for the active tab, pairing with `<Tabs idBase>`.
 * Carries `role="tabpanel"` and points back at its tab via aria-labelledby.
 */
export function TabPanel({
  idBase,
  tabId,
  className = "",
  children,
}: {
  idBase: string;
  tabId: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      role="tabpanel"
      id={`${idBase}-panel-${tabId}`}
      aria-labelledby={`${idBase}-tab-${tabId}`}
      className={className}
    >
      {children}
    </div>
  );
}
