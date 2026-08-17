"use client";

/**
 * The decision moment — one dialog, three honest outcomes.
 *
 * Opened by the "Decide" / "Review" / "Work or pass" actions. It does not
 * execute anything itself: each option hands off to the surface that already
 * owns that act (the buy modal, the target editor, the pass dialog, the
 * Research Hub), with the idea's own context — thesis, conviction, level,
 * price — restated so the user decides with the file open, not from memory.
 *
 * The Watchlist is deliberately not a second trading system: "Buy now" opens
 * the same AddToPortfolio flow every other surface uses, and the ledger write
 * is what flips the idea to Owned.
 */

import Link from "next/link";
import { Dialog } from "@/app/_components/dialog";
import { formatCurrency } from "@/lib/format";
import type { Conviction } from "@/lib/types";

export type DecideMode = "decide" | "review" | "triage";

const TITLE: Record<DecideMode, (symbol: string) => string> = {
  decide: (s) => `Decide on ${s}`,
  review: (s) => `Review ${s}`,
  triage: (s) => `Work ${s}, or let it go`,
};

const CONVICTION_WORD: Record<Conviction, string> = { low: "Low", medium: "Medium", high: "High" };

function Option({
  label,
  detail,
  tone = "neutral",
  onClick,
}: {
  label: string;
  detail: string;
  tone?: "brand" | "warning" | "neutral";
  onClick: () => void;
}) {
  const toneClass =
    tone === "brand"
      ? "border-brand/40 hover:bg-brand/10"
      : tone === "warning"
        ? "border-warning/40 hover:bg-warning/10"
        : "border-border hover:bg-surface-2";
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full flex-col items-start gap-0.5 rounded-control border px-3 py-2.5 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-brand/40 ${toneClass}`}
    >
      <span className="text-sm font-medium text-foreground">{label}</span>
      <span className="text-[11px] leading-snug text-muted">{detail}</span>
    </button>
  );
}

export function DecideDialog({
  mode,
  symbol,
  name,
  notes,
  conviction,
  targetPrice,
  currency,
  price,
  contextLine,
  onBuy,
  onTrigger,
  onPass,
  onEditThesis,
  onClose,
}: {
  mode: DecideMode;
  symbol: string;
  name: string;
  notes: string | null;
  conviction: Conviction | null;
  targetPrice: number | null;
  currency: string;
  price: number | null;
  /** The next-action's own grounds, restated so the dialog explains itself. */
  contextLine: string;
  onBuy: () => void;
  onTrigger: () => void;
  onPass: () => void;
  onEditThesis: () => void;
  onClose: () => void;
}) {
  return (
    <Dialog open onClose={onClose} title={TITLE[mode](symbol)} description={contextLine}>
      <div className="flex flex-col gap-4">
        {/* The file, restated: what you wrote, how sure you were, the level. */}
        <div className="rounded-control border border-hairline bg-surface-2/50 p-3">
          <p className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="font-mono text-sm font-semibold text-foreground">{symbol}</span>
            <span className="truncate text-xs text-muted">{name}</span>
            {price != null ? (
              <span className="font-mono text-xs tabular-nums text-foreground/80">{formatCurrency(price, currency)}</span>
            ) : null}
            {conviction ? <span className="text-[10px] uppercase tracking-wide text-faint">{CONVICTION_WORD[conviction]} conviction</span> : null}
            {targetPrice != null ? (
              <span className="text-[10px] text-faint">level {formatCurrency(targetPrice, currency)}</span>
            ) : null}
          </p>
          {notes?.trim() ? (
            <p className="mt-1.5 line-clamp-3 text-[11px] leading-snug text-muted">{notes}</p>
          ) : (
            <p className="mt-1.5 text-[11px] italic text-faint">No written view yet.</p>
          )}
        </div>

        <div className="flex flex-col gap-2">
          {mode === "triage" ? (
            <Option
              label="Keep working it"
              detail="Open the Research Hub — the evidence trail picks the work up automatically."
              tone="brand"
              onClick={onClose}
            />
          ) : null}
          {mode !== "triage" ? (
            <Option
              label="Buy now…"
              detail="Open the buy flow. The ledger write marks the idea Owned by itself."
              tone="brand"
              onClick={onBuy}
            />
          ) : null}
          {mode !== "triage" ? (
            <Option
              label="Wait at a level…"
              detail="Arm a price target. The idea moves to Waiting and monitors itself."
              onClick={onTrigger}
            />
          ) : null}
          {mode === "review" ? (
            <Option
              label="Update the thesis…"
              detail="Re-read your view against the new evidence and re-stamp the review."
              onClick={onEditThesis}
            />
          ) : null}
          <Option
            label="Pass…"
            detail="Decline with a reason. Journaled, archived, reversible."
            tone="warning"
            onClick={onPass}
          />
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-hairline pt-3">
          {mode === "triage" ? (
            <Link
              href={`/research?symbol=${encodeURIComponent(symbol)}`}
              className="text-[11px] text-brand underline-offset-2 hover:underline"
            >
              Open Research →
            </Link>
          ) : (
            <Link
              href={`/journal?symbol=${encodeURIComponent(symbol)}`}
              className="text-[11px] text-brand underline-offset-2 hover:underline"
            >
              Log a full decision in the Journal →
            </Link>
          )}
          <button
            type="button"
            onClick={onClose}
            className="rounded-control border border-border px-3 py-1.5 text-xs text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
          >
            Not now
          </button>
        </div>
      </div>
    </Dialog>
  );
}
