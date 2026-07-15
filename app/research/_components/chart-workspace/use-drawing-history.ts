"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export interface HistoryCommand {
  do: () => void;
  undo: () => void;
}

export interface UseDrawingHistoryResult {
  push: (command: HistoryCommand) => void;
  undo: () => void;
  redo: () => void;
  /** Reactive — reflects the current stack state, for disabling visible Undo/Redo buttons. */
  canUndo: boolean;
  canRedo: boolean;
}

/**
 * Generic in-memory undo/redo command stack. The caller (chart-workspace.tsx)
 * constructs concrete `{ do, undo }` pairs around each drawing mutation
 * (create/move/delete) and pushes them here — this hook only manages the
 * stack itself. Scoped to `resetKey` (symbol+timeframe); switching scope
 * clears history rather than carrying it over, matching how undo works in
 * most creative tools. Not persisted across reloads.
 *
 * The actual command objects live in refs (they hold closures, not
 * serializable/renderable data), but `canUndo`/`canRedo` are tracked as real
 * state — set explicitly right after each ref mutation — rather than derived
 * from the refs during render, since reading `.current` during render is
 * unsafe under React's rules.
 */
export function useDrawingHistory(resetKey: string): UseDrawingHistoryResult {
  const undoStack = useRef<HistoryCommand[]>([]);
  const redoStack = useRef<HistoryCommand[]>([]);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  useEffect(() => {
    undoStack.current = [];
    redoStack.current = [];
    /* eslint-disable react-hooks/set-state-in-effect */
    setCanUndo(false);
    setCanRedo(false);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [resetKey]);

  const push = useCallback((command: HistoryCommand) => {
    undoStack.current.push(command);
    redoStack.current = [];
    setCanUndo(true);
    setCanRedo(false);
  }, []);

  const undo = useCallback(() => {
    const command = undoStack.current.pop();
    if (!command) return;
    command.undo();
    redoStack.current.push(command);
    setCanUndo(undoStack.current.length > 0);
    setCanRedo(true);
  }, []);

  const redo = useCallback(() => {
    const command = redoStack.current.pop();
    if (!command) return;
    command.do();
    undoStack.current.push(command);
    setCanRedo(redoStack.current.length > 0);
    setCanUndo(true);
  }, []);

  return useMemo(() => ({ push, undo, redo, canUndo, canRedo }), [push, undo, redo, canUndo, canRedo]);
}
