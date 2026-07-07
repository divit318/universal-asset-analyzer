"use client";

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
}

/** Tab bar with an animated underline under the active tab. */
export function Tabs<T extends string>({ tabs, active, onChange }: TabsProps<T>) {
  return (
    <div role="tablist" className="flex items-center gap-1 overflow-x-auto border-b border-border">
      {tabs.map((t) => {
        const isActive = active === t.id;
        return (
          <button
            key={t.id}
            role="tab"
            aria-selected={isActive}
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
