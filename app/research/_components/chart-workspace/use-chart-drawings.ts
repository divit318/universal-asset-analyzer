"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Chart, Overlay, OverlayCreate, OverlayEvent, Point } from "klinecharts";
import type { ChartDrawingRecord } from "@/lib/types";
import { toOverlayStyle } from "./overlays/style-utils";
import { TOOL_TO_OVERLAY_NAME } from "./drawing-categories";
import type { UseDrawingHistoryResult } from "./use-drawing-history";
import { DEFAULT_DRAWING_STYLE, type DrawingObject, type DrawingStyle, type DrawingToolId } from "./types";

function toDrawingPoints(points: Array<Partial<Point>>): DrawingObject["points"] {
  return points
    .filter((p): p is Point => p.timestamp != null && p.value != null)
    .map((p) => ({ timestamp: p.timestamp, value: p.value }));
}

function serialize(overlay: Overlay, symbol: string, timeframe: string, style: DrawingStyle | undefined): Omit<DrawingObject, "id"> {
  const now = Date.now();
  return {
    // `overlay.name` is klinecharts' own overlay name (e.g. "segment"), not
    // our UI-facing DrawingToolId (e.g. "trend-line") — see
    // TOOL_TO_OVERLAY_NAME in drawing-categories.ts. That's fine here: the
    // only place `type` is read back is `createOverlay({ name: record.type })`
    // on restore, which needs exactly the real overlay name.
    type: overlay.name as DrawingToolId,
    symbol,
    timeframe,
    points: toDrawingPoints(overlay.points),
    style: style ?? DEFAULT_DRAWING_STYLE,
    locked: overlay.lock,
    hidden: !overlay.visible,
    createdAt: now,
    updatedAt: now,
    metadata: {},
  };
}

export interface UseChartDrawingsResult {
  /** Starts interactive creation of a new drawing for the given tool. */
  createDrawing: (toolId: DrawingToolId, style?: DrawingStyle) => void;
  /** Deletes the currently-selected drawing, if any. */
  deleteSelected: () => void;
  /** Restyles the currently-selected drawing (color/opacity/thickness/lineStyle/textSize) and persists it. */
  updateSelectedStyle: (style: DrawingStyle) => void;
  /** The currently-selected drawing's own DrawingStyle, for the properties panel to initialize from. */
  getSelectedStyle: () => DrawingStyle | null;
  /** Removes every persisted drawing for this (symbol, timeframe). */
  clearAll: () => Promise<void>;
  /** Clean View: hide/show every current drawing's rendering without touching its persisted state. */
  setCleanView: (clean: boolean) => void;
  selectedOverlayId: string | null;
  loading: boolean;
}

/**
 * Fetches, restores, and persists drawings for one (symbol, timeframe) scope,
 * and — when `history` is supplied — records undo/redo commands for
 * create/move/delete. Saves fire only on settled events (drag/draw end),
 * never mid-drag, to avoid hammering SQLite. Restoring supplies each
 * overlay's `points` upfront, which completes it immediately (no interactive
 * drawing prompt), so `onDrawEnd` never re-fires for restored drawings.
 *
 * `isApplyingHistory` guards every chart mutation that `undo()`/`redo()`
 * themselves perform (e.g. removing an overlay to undo a create) so those
 * don't re-trigger `onRemoved`/`onPressedMoveEnd` and push a second,
 * self-referential command onto the stack.
 */
export function useChartDrawings(
  chart: Chart | null,
  symbol: string,
  timeframe: string,
  history?: UseDrawingHistoryResult,
  /**
   * Fires once per genuinely new interactive drawing (never for restored or
   * undo/redo-recreated overlays — see onDrawEnd's own doc note below) —
   * drives the AI dock's one-time "review this drawing" nudge.
   */
  onDrawingCreated?: (overlay: Overlay) => void,
): UseChartDrawingsResult {
  const dbIdByOverlayId = useRef<Map<string, number>>(new Map());
  const moveStartPoints = useRef<Map<string, DrawingObject["points"]>>(new Map());
  // The DrawingStyle actually applied to each overlay — `overlay.styles` holds
  // klinecharts' own OverlayStyle shape (post-mapping), not our DrawingStyle,
  // so we track the source style separately to persist it accurately rather
  // than reverse-engineering it from rendered colors.
  const styleByOverlayId = useRef<Map<string, DrawingStyle>>(new Map());
  const isApplyingHistory = useRef(false);
  const [selectedOverlayId, setSelectedOverlayId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Recreating an overlay (undo-a-delete / redo-a-create) needs to re-attach
  // the same event wiring `attachEvents` provides — held in a ref so those
  // closures can call the *current* attachEvents without a direct
  // self-reference inside its own useCallback body.
  const attachEventsRef = useRef<(create: OverlayCreate) => OverlayCreate>(undefined);

  const persistCreate = useCallback(
    (overlay: Overlay) => {
      const style = styleByOverlayId.current.get(overlay.id);
      const payload = serialize(overlay, symbol, timeframe, style);
      return fetch("/api/chart-drawings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol, timeframe, type: overlay.name, data: payload }),
      })
        .then((r) => (r.ok ? (r.json() as Promise<ChartDrawingRecord>) : null))
        .then((record) => {
          if (record) dbIdByOverlayId.current.set(overlay.id, record.id);
          return record;
        })
        .catch(() => null); // best-effort — drawing still exists on-canvas for this session
    },
    [symbol, timeframe],
  );

  const persistUpdate = useCallback(
    (overlay: Overlay) => {
      const dbId = dbIdByOverlayId.current.get(overlay.id);
      if (dbId == null) return;
      const style = styleByOverlayId.current.get(overlay.id);
      const payload = serialize(overlay, symbol, timeframe, style);
      fetch("/api/chart-drawings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: dbId, data: payload }),
      }).catch(() => { /* best-effort */ });
    },
    [symbol, timeframe],
  );

  const persistDelete = useCallback((overlayId: string) => {
    const dbId = dbIdByOverlayId.current.get(overlayId);
    if (dbId == null) return;
    dbIdByOverlayId.current.delete(overlayId);
    styleByOverlayId.current.delete(overlayId);
    fetch(`/api/chart-drawings?id=${dbId}`, { method: "DELETE" }).catch(() => { /* best-effort */ });
  }, []);

  const attachEvents = useCallback(
    (create: OverlayCreate): OverlayCreate => ({
      ...create,
      onDrawEnd: (event: OverlayEvent<unknown>) => {
        const { overlay } = event;
        void persistCreate(overlay);
        onDrawingCreated?.(overlay);
        if (history && !isApplyingHistory.current) {
          const snapshotPoints = toDrawingPoints(overlay.points);
          const snapshotStyle = overlay.styles;
          const snapshotDrawingStyle = styleByOverlayId.current.get(overlay.id);
          history.push({
            undo: () => {
              isApplyingHistory.current = true;
              chart?.removeOverlay({ id: overlay.id });
              persistDelete(overlay.id);
              isApplyingHistory.current = false;
            },
            do: () => {
              isApplyingHistory.current = true;
              const recreated = chart?.createOverlay(
                attachEventsRef.current?.({ name: overlay.name, points: snapshotPoints, styles: snapshotStyle }) ?? { name: overlay.name },
              );
              const id = Array.isArray(recreated) ? recreated[0] : recreated;
              if (id) {
                if (snapshotDrawingStyle) styleByOverlayId.current.set(id, snapshotDrawingStyle);
                const found = chart?.getOverlays({ id })[0];
                if (found) void persistCreate(found);
              }
              isApplyingHistory.current = false;
            },
          });
        }
        return false;
      },
      onPressedMoveStart: (event: OverlayEvent<unknown>) => {
        moveStartPoints.current.set(event.overlay.id, toDrawingPoints(event.overlay.points));
        return false;
      },
      onPressedMoveEnd: (event: OverlayEvent<unknown>) => {
        const { overlay } = event;
        persistUpdate(overlay);
        if (history && !isApplyingHistory.current) {
          const before = moveStartPoints.current.get(overlay.id);
          const after = toDrawingPoints(overlay.points);
          if (before) {
            history.push({
              undo: () => {
                isApplyingHistory.current = true;
                chart?.overrideOverlay({ id: overlay.id, points: before });
                const found = chart?.getOverlays({ id: overlay.id })[0];
                if (found) persistUpdate(found);
                isApplyingHistory.current = false;
              },
              do: () => {
                isApplyingHistory.current = true;
                chart?.overrideOverlay({ id: overlay.id, points: after });
                const found = chart?.getOverlays({ id: overlay.id })[0];
                if (found) persistUpdate(found);
                isApplyingHistory.current = false;
              },
            });
          }
        }
        moveStartPoints.current.delete(overlay.id);
        return false;
      },
      onRemoved: (event: OverlayEvent<unknown>) => {
        const { overlay } = event;
        persistDelete(overlay.id);
        if (history && !isApplyingHistory.current) {
          const snapshotPoints = toDrawingPoints(overlay.points);
          const snapshotStyle = overlay.styles;
          const snapshotDrawingStyle = styleByOverlayId.current.get(overlay.id);
          history.push({
            do: () => {
              isApplyingHistory.current = true;
              chart?.removeOverlay({ id: overlay.id });
              persistDelete(overlay.id);
              isApplyingHistory.current = false;
            },
            undo: () => {
              isApplyingHistory.current = true;
              const recreated = chart?.createOverlay(
                attachEventsRef.current?.({ name: overlay.name, points: snapshotPoints, styles: snapshotStyle }) ?? { name: overlay.name },
              );
              const id = Array.isArray(recreated) ? recreated[0] : recreated;
              if (id) {
                if (snapshotDrawingStyle) styleByOverlayId.current.set(id, snapshotDrawingStyle);
                const found = chart?.getOverlays({ id })[0];
                if (found) void persistCreate(found);
              }
              isApplyingHistory.current = false;
            },
          });
        }
        return false;
      },
      onSelected: (event: OverlayEvent<unknown>) => {
        setSelectedOverlayId(event.overlay.id);
        return false;
      },
      onDeselected: () => {
        setSelectedOverlayId((cur) => (cur === null ? cur : null));
        return false;
      },
    }),
    [chart, history, persistCreate, persistUpdate, persistDelete, onDrawingCreated],
  );

  useEffect(() => {
    attachEventsRef.current = attachEvents;
  }, [attachEvents]);

  // Restore persisted drawings whenever the chart instance or scope changes.
  useEffect(() => {
    if (!chart) return;
    let cancelled = false;
    dbIdByOverlayId.current.clear();
    styleByOverlayId.current.clear();
    /* eslint-disable react-hooks/set-state-in-effect */
    setSelectedOverlayId(null);
    setLoading(true);
    /* eslint-enable react-hooks/set-state-in-effect */

    fetch(`/api/chart-drawings?symbol=${encodeURIComponent(symbol)}&timeframe=${encodeURIComponent(timeframe)}`)
      .then((r) => (r.ok ? (r.json() as Promise<{ drawings: ChartDrawingRecord[] }>) : { drawings: [] }))
      .then(({ drawings }) => {
        if (cancelled) return;
        for (const record of drawings) {
          let parsed: DrawingObject;
          try {
            parsed = JSON.parse(record.data) as DrawingObject;
          } catch {
            continue;
          }
          const created = chart.createOverlay(
            attachEvents({
              name: record.type,
              points: parsed.points,
              styles: toOverlayStyle(parsed.style ?? DEFAULT_DRAWING_STYLE),
              lock: parsed.locked,
              visible: !parsed.hidden,
            }),
          );
          const overlayId = Array.isArray(created) ? created[0] : created;
          if (overlayId) {
            dbIdByOverlayId.current.set(overlayId, record.id);
            if (parsed.style) styleByOverlayId.current.set(overlayId, parsed.style);
          }
        }
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [chart, symbol, timeframe, attachEvents]);

  const createDrawing = useCallback(
    (toolId: DrawingToolId, style: DrawingStyle = DEFAULT_DRAWING_STYLE) => {
      if (!chart) return;
      const overlayName = TOOL_TO_OVERLAY_NAME[toolId];
      if (!overlayName) return; // cursor/crosshair are interaction modes, not overlays
      const created = chart.createOverlay(
        attachEvents({ name: overlayName, mode: "strong_magnet", styles: toOverlayStyle(style) }),
      );
      const overlayId = Array.isArray(created) ? created[0] : created;
      if (overlayId) styleByOverlayId.current.set(overlayId, style);
    },
    [chart, attachEvents],
  );

  const deleteSelected = useCallback(() => {
    if (!chart || !selectedOverlayId) return;
    // removeOverlay triggers onRemoved, which persists the delete and (when
    // history is wired) pushes the undo command — no need to duplicate that here.
    chart.removeOverlay({ id: selectedOverlayId });
    setSelectedOverlayId(null);
  }, [chart, selectedOverlayId]);

  // Style changes are not recorded on the undo/redo stack (Phase 1
  // simplification) — restyling is low-cost to redo by hand, unlike losing a
  // whole drawing's position or existence.
  const updateSelectedStyle = useCallback(
    (style: DrawingStyle) => {
      if (!chart || !selectedOverlayId) return;
      chart.overrideOverlay({ id: selectedOverlayId, styles: toOverlayStyle(style) });
      styleByOverlayId.current.set(selectedOverlayId, style);
      const found = chart.getOverlays({ id: selectedOverlayId })[0];
      if (found) persistUpdate(found);
    },
    [chart, selectedOverlayId, persistUpdate],
  );

  const getSelectedStyle = useCallback((): DrawingStyle | null => {
    if (!selectedOverlayId) return null;
    return styleByOverlayId.current.get(selectedOverlayId) ?? null;
  }, [selectedOverlayId]);

  // Clean View: toggle every current overlay's rendered visibility without
  // touching its persisted `hidden` field or removing it from the chart's own
  // overlay list — flipping back restores everything exactly as it was.
  // overrideOverlay() doesn't fire onRemoved/onPressedMoveEnd, so this never
  // triggers a persistence write.
  const setCleanView = useCallback(
    (clean: boolean) => {
      if (!chart) return;
      for (const overlay of chart.getOverlays()) {
        chart.overrideOverlay({ id: overlay.id, visible: !clean });
      }
    },
    [chart],
  );

  const clearAll = useCallback(async () => {
    if (!chart) return;
    isApplyingHistory.current = true; // a full clear isn't undoable in Phase 1 — don't record per-overlay removals
    chart.removeOverlay();
    isApplyingHistory.current = false;
    dbIdByOverlayId.current.clear();
    setSelectedOverlayId(null);
    await fetch("/api/chart-drawings/clear", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbol, timeframe }),
    }).catch(() => { /* best-effort */ });
  }, [chart, symbol, timeframe]);

  // Memoized for the same reason as useDrawingHistory's return value: a fresh
  // object literal every render would recreate `drawings` in chart-workspace.tsx's
  // dependency arrays (handleSelectTool/handleStyleChange) every render.
  return useMemo(
    () => ({
      createDrawing,
      deleteSelected,
      updateSelectedStyle,
      getSelectedStyle,
      clearAll,
      setCleanView,
      selectedOverlayId,
      loading,
    }),
    [createDrawing, deleteSelected, updateSelectedStyle, getSelectedStyle, clearAll, setCleanView, selectedOverlayId, loading],
  );
}
