"use client";

/**
 * Saved screeners. Net new — the old screener had no persistence at all, so
 * every screen you built died with the page.
 */

import { useState } from "react";
import type { SavedScreen } from "@/lib/db";
import { Button, Card } from "@/app/_components/ui";
import { countActive, type Draft } from "./filter-state";

interface Props {
  screens: SavedScreen[];
  draft: Draft;
  saving: boolean;
  onSave: (name: string) => void;
  onLoad: (screen: SavedScreen) => void;
  onDelete: (id: string) => void;
}

export function SavedScreens({ screens, draft, saving, onSave, onLoad, onDelete }: Props) {
  const [name, setName] = useState("");
  const active = countActive(draft);

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onSave(trimmed);
    setName("");
  };

  return (
    <Card className="flex flex-col gap-3 p-4">
      <p className="text-sm font-medium">Saved screens</p>

      <div className="flex items-center gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
          placeholder="Name this screen…"
          aria-label="Saved screen name"
          className="min-w-0 flex-1 rounded-md border border-border bg-surface-2 px-2 py-1.5 text-xs outline-none placeholder:text-muted/60 focus:border-brand"
        />
        <Button
          onClick={submit}
          disabled={!name.trim() || saving}
          className="shrink-0 px-3 py-1.5 text-xs"
        >
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>

      <p className="text-[11px] text-muted">
        {active === 0
          ? "No filters set — saving now stores the template and sort only."
          : `Saves ${active} active filter${active === 1 ? "" : "s"}, plus the template and sort.`}
      </p>

      {screens.length > 0 ? (
        <ul className="flex flex-col gap-1 border-t border-border pt-2">
          {screens.map((screen) => (
            <li key={screen.id} className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => onLoad(screen)}
                className="min-w-0 flex-1 truncate text-left text-xs text-muted transition-colors hover:text-brand"
                title={`Load "${screen.name}"`}
              >
                {screen.name}
              </button>
              <button
                type="button"
                onClick={() => onDelete(screen.id)}
                aria-label={`Delete ${screen.name}`}
                className="shrink-0 text-xs text-muted transition-colors hover:text-rose-500"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </Card>
  );
}
