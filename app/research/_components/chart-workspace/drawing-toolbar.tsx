"use client";

import { useState } from "react";
import { ChevronDown, Pin, PinOff, PenTool } from "lucide-react";
import { CATEGORY_LABEL, DRAWING_CATEGORIES } from "./drawing-categories";
import type { DrawingCategory, DrawingToolId } from "./types";

const HINTS_SEEN_KEY = "uaa_chart_tool_hints_seen";

function wasHintShown(toolId: DrawingToolId): boolean {
  try {
    const raw = localStorage.getItem(HINTS_SEEN_KEY);
    const seen: string[] = raw ? JSON.parse(raw) : [];
    return seen.includes(toolId);
  } catch {
    return false;
  }
}

function markHintShown(toolId: DrawingToolId): void {
  try {
    const raw = localStorage.getItem(HINTS_SEEN_KEY);
    const seen: string[] = raw ? JSON.parse(raw) : [];
    if (!seen.includes(toolId)) localStorage.setItem(HINTS_SEEN_KEY, JSON.stringify([...seen, toolId]));
  } catch {
    /* localStorage unavailable — hints just show every time, non-critical */
  }
}

export interface DrawingToolbarProps {
  onSelectTool: (toolId: DrawingToolId) => void;
  pinned: boolean;
  onTogglePin: () => void;
}

/**
 * Compact, categorized drawing toolbar — only one category open at a time.
 * `collapsible-section.tsx` doesn't support accordion (single-open) behavior
 * (each instance manages its own open state independently), so this is a
 * small purpose-built accordion rather than a reuse of that component.
 *
 * Auto-hides to a slim edge strip so the chart stays the visual focus, but
 * never fully disappears — the strip's icon is a deliberate, permanent
 * affordance so the tools are discoverable, not hidden. Hovering (or pinning)
 * reveals the full toolbar; the pinned state is the caller's to persist.
 */
export function DrawingToolbar({ onSelectTool, pinned, onTogglePin }: DrawingToolbarProps) {
  const [hovering, setHovering] = useState(false);
  const [openCategory, setOpenCategory] = useState<DrawingCategory | null>(null);
  const [activeTool, setActiveTool] = useState<DrawingToolId>("cursor");
  const [hint, setHint] = useState<string | null>(null);

  const expanded = pinned || hovering;

  function handleSelectTool(toolId: DrawingToolId, toolHint: string) {
    setActiveTool(toolId);
    onSelectTool(toolId);
    if (!wasHintShown(toolId)) {
      setHint(toolHint);
      markHintShown(toolId);
      window.setTimeout(() => setHint(null), 4000);
    }
  }

  return (
    <div
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      className={`relative flex shrink-0 flex-col overflow-hidden border-r border-border bg-surface transition-[width] duration-200 ease-out ${
        expanded ? "w-56" : "w-10"
      }`}
    >
      {!expanded && (
        <div className="flex flex-col items-center gap-1 py-3 text-muted" title="Drawing tools — hover to expand">
          <PenTool className="h-4 w-4" strokeWidth={1.75} />
        </div>
      )}

      <div
        className={`flex flex-1 flex-col gap-1 overflow-y-auto p-2 transition-opacity duration-150 ${
          expanded ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      >
        <button
          onClick={onTogglePin}
          className={`mb-1 flex items-center gap-1.5 self-end rounded-control px-2 py-1 text-micro font-medium transition-colors ${
            pinned ? "bg-brand/15 text-brand" : "text-muted hover:bg-surface-2 hover:text-foreground"
          }`}
          title={pinned ? "Unpin toolbar" : "Pin toolbar open"}
        >
          {pinned ? <Pin className="h-3 w-3" strokeWidth={1.75} /> : <PinOff className="h-3 w-3" strokeWidth={1.75} />}
          {pinned ? "Pinned" : "Pin"}
        </button>

        {DRAWING_CATEGORIES.map(({ category, tools }) => {
          const isOpen = openCategory === category;
          return (
            <div key={category} className="flex flex-col">
              <button
                onClick={() => setOpenCategory(isOpen ? null : category)}
                className="flex items-center justify-between rounded-control px-2 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
              >
                {CATEGORY_LABEL[category]}
                <ChevronDown
                  className={`h-3.5 w-3.5 transition-transform duration-200 ease-out ${isOpen ? "rotate-180" : ""}`}
                  strokeWidth={2}
                />
              </button>
              {isOpen && (
                <div className="flex flex-col gap-0.5 py-1">
                  {tools.map((tool) => (
                    <button
                      key={tool.id}
                      onClick={() => handleSelectTool(tool.id, tool.hint)}
                      className={`flex items-center gap-2 rounded-control px-2.5 py-1.5 text-left text-xs transition-colors ${
                        activeTool === tool.id
                          ? "bg-brand/15 text-brand"
                          : "text-foreground hover:bg-surface-2"
                      }`}
                    >
                      <tool.icon className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
                      {tool.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}

        {hint && (
          <div className="mt-1 rounded-control border border-brand/30 bg-brand/10 px-2.5 py-2 text-micro text-brand">
            {hint}
          </div>
        )}
      </div>
    </div>
  );
}
