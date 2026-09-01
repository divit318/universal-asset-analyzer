"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Clock3, Link2, MoreHorizontal, Network } from "lucide-react";
import { LoadingMark } from "@/app/_components/loading-mark";
import { DownloadIcon } from "./download-icon";

/**
 * Overflow for the masthead's secondary actions (Journal, Exposure, Copy
 * link, Excel export). The row used to show eight peers at once — every
 * action a primary claim on attention. The decisions an investor takes from
 * this page (watchlist, portfolio, IC report, price alert) stay visible;
 * navigation and utilities live here.
 *
 * Outside-click closes via `ref.contains` on pointerdown — never
 * `stopPropagation`, which does not reliably stop a document listener
 * (see AGENTS.md).
 */

interface Props {
  symbol: string;
  onCopyLink: () => void;
  onDownloadReport: () => void;
  downloading: boolean;
}

export function MastheadMoreMenu({ symbol, onCopyLink, onDownloadReport, downloading }: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const closeAnd = useCallback((fn: () => void) => () => {
    setOpen(false);
    fn();
  }, []);

  const itemCls =
    "flex w-full items-center gap-2.5 rounded-control px-3 py-2 text-sm text-foreground transition-colors hover:bg-surface-2";

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="More actions"
        className="inline-flex items-center rounded-control px-2 py-2 text-muted outline-none transition-colors hover:bg-surface-2 hover:text-foreground focus-visible:ring-2 focus-visible:ring-brand/40"
      >
        <MoreHorizontal className="h-4 w-4" strokeWidth={1.75} />
      </button>

      {open && (
        <div
          role="menu"
          aria-label="More actions"
          className="animate-menu-drop absolute right-0 top-full z-50 mt-2 w-52 rounded-panel border border-border bg-surface p-1.5 shadow-popover"
        >
          <Link
            role="menuitem"
            href={`/journal?symbol=${encodeURIComponent(symbol)}`}
            onClick={() => setOpen(false)}
            className={itemCls}
          >
            <Clock3 className="h-4 w-4 text-muted" strokeWidth={1.75} aria-hidden="true" />
            Journal
          </Link>
          <Link
            role="menuitem"
            href={`/exposure?issuer=${encodeURIComponent(symbol)}`}
            onClick={() => setOpen(false)}
            className={itemCls}
          >
            <Network className="h-4 w-4 text-muted" strokeWidth={1.75} aria-hidden="true" />
            Exposure
          </Link>
          <button role="menuitem" type="button" onClick={closeAnd(onCopyLink)} className={itemCls}>
            <Link2 className="h-4 w-4 text-muted" strokeWidth={1.75} aria-hidden="true" />
            Copy link
          </button>
          <button
            role="menuitem"
            type="button"
            onClick={closeAnd(onDownloadReport)}
            disabled={downloading}
            className={`${itemCls} disabled:opacity-60`}
          >
            {downloading
              ? <LoadingMark size={16} label="Generating report" />
              : <span className="text-muted"><DownloadIcon /></span>}
            {downloading ? "Generating…" : "Excel report"}
          </button>
        </div>
      )}
    </div>
  );
}
