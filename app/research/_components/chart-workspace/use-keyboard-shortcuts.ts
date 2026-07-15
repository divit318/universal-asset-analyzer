"use client";

import { useEffect } from "react";

export interface KeyboardShortcutHandlers {
  onDelete: () => void;
  onUndo: () => void;
  onRedo: () => void;
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable;
}

/**
 * Delete / Cmd+Z / Cmd+Shift+Z, active only while mounted (i.e. only while
 * the Fullscreen workspace is open). Guards against firing while a text
 * input/textarea/contenteditable has focus — a deliberate addition beyond
 * `command-palette.tsx`'s Cmd+K listener (which has no such guard), since
 * Delete specifically conflicts with editing a Text/Callout annotation or a
 * style-panel input in a way Cmd+K never does.
 */
export function useKeyboardShortcuts({ onDelete, onUndo, onRedo }: KeyboardShortcutHandlers): void {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (isEditableTarget(e.target)) return;

      if (e.key === "Delete") {
        e.preventDefault();
        onDelete();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) onRedo();
        else onUndo();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onDelete, onUndo, onRedo]);
}
