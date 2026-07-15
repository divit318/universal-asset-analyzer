"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";
import type { DrawingStyle } from "./types";

export interface DrawingPropertiesPanelProps {
  style: DrawingStyle;
  onChange: (style: DrawingStyle) => void;
  onDelete: () => void;
}

const LINE_STYLES: DrawingStyle["lineStyle"][] = ["solid", "dashed", "dotted"];

/**
 * Color/opacity/thickness/line-style/text-size editor for the currently
 * selected drawing. Every change both restyles the live overlay (via
 * `onChange`, wired to `useChartDrawings().updateSelectedStyle`) and is saved
 * as the new preferred default for future drawings (handled by the parent —
 * see style-preferences.ts) — "remember their preferred defaults."
 *
 * The parent renders this keyed by the selected overlay's id
 * (`key={selectedOverlayId}`) so switching the selection remounts it fresh
 * with the new drawing's style, rather than syncing local state via effect.
 */
export function DrawingPropertiesPanel({ style, onChange, onDelete }: DrawingPropertiesPanelProps) {
  // Local copy so range/color inputs feel immediate; every keystroke still
  // propagates up via onChange (cheap: it's just a style override, no re-fetch).
  const [local, setLocal] = useState(style);

  function update(patch: Partial<DrawingStyle>) {
    const next = { ...local, ...patch };
    setLocal(next);
    onChange(next);
  }

  return (
    <div className="flex flex-col gap-3 border-l border-border bg-surface p-3">
      <p className="text-micro font-semibold uppercase tracking-widest text-faint">Drawing style</p>

      <label className="flex items-center justify-between gap-2 text-xs text-muted">
        Color
        <input
          type="color"
          value={local.color}
          onChange={(e) => update({ color: e.target.value })}
          className="h-6 w-10 cursor-pointer rounded border border-border bg-transparent"
        />
      </label>

      <label className="flex flex-col gap-1 text-xs text-muted">
        <span className="flex items-center justify-between">
          Opacity <span className="font-mono text-foreground">{Math.round(local.opacity * 100)}%</span>
        </span>
        <input
          type="range"
          min={0.1}
          max={1}
          step={0.05}
          value={local.opacity}
          onChange={(e) => update({ opacity: Number(e.target.value) })}
        />
      </label>

      <label className="flex flex-col gap-1 text-xs text-muted">
        <span className="flex items-center justify-between">
          Thickness <span className="font-mono text-foreground">{local.thickness}px</span>
        </span>
        <input
          type="range"
          min={1}
          max={6}
          step={0.5}
          value={local.thickness}
          onChange={(e) => update({ thickness: Number(e.target.value) })}
        />
      </label>

      <label className="flex items-center justify-between gap-2 text-xs text-muted">
        Line style
        <select
          value={local.lineStyle}
          onChange={(e) => update({ lineStyle: e.target.value as DrawingStyle["lineStyle"] })}
          className="rounded-control border border-border bg-surface-2 px-2 py-1 text-xs text-foreground"
        >
          {LINE_STYLES.map((ls) => (
            <option key={ls} value={ls}>
              {ls}
            </option>
          ))}
        </select>
      </label>

      <label className="flex items-center justify-between gap-2 text-xs text-muted">
        Text size
        <input
          type="number"
          min={8}
          max={24}
          value={local.textSize}
          onChange={(e) => update({ textSize: Number(e.target.value) })}
          className="w-16 rounded-control border border-border bg-surface-2 px-2 py-1 text-xs text-foreground"
        />
      </label>

      <button
        onClick={onDelete}
        className="mt-1 flex items-center justify-center gap-1.5 rounded-control border border-negative/30 bg-negative/10 px-2.5 py-1.5 text-xs font-medium text-negative transition-colors hover:bg-negative/20"
      >
        <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} /> Delete
      </button>
    </div>
  );
}
