"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

/**
 * Progressive disclosure primitive — a titled section that collapses secondary
 * detail behind a click so a dense page can lead with the answer and reveal
 * evidence on demand. Reusable platform-wide.
 */
export function CollapsibleSection({
  title,
  subtitle,
  defaultOpen = false,
  children,
}: {
  title: string;
  subtitle?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="overflow-hidden rounded-card border border-border bg-surface">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left outline-none transition-colors hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-brand/40"
      >
        <span className="flex flex-col">
          <span className="text-sm font-semibold text-foreground">{title}</span>
          {subtitle && <span className="text-xs text-muted">{subtitle}</span>}
        </span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-muted transition-transform ${open ? "rotate-180" : ""}`} strokeWidth={2} />
      </button>
      {open && <div className="border-t border-border p-4">{children}</div>}
    </div>
  );
}
