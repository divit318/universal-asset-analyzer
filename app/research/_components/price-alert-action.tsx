"use client";

/**
 * Research Hub's entry point into the EXISTING price-alert system — not a
 * second one.
 *
 * A "price alert" in UAA is a watchlist row's target price + direction:
 * persisted by lib/db.ts, evaluated server-side every 5 minutes by
 * lib/monitor.ts (plus the bell's 90s poll) with genuine crossing semantics
 * (lib/price-crossing.ts — armed on first observation, fires only on a
 * transition through the level, re-armed when the level changes), delivered
 * through the existing notification table and header bell, and managed on
 * /watchlist. This component only *creates/edits* that row, via the same
 * POST + PATCH /api/watchlist the Watchlist page uses, and reuses the same
 * TargetModal editor — so an alert set here is indistinguishable from one
 * set anywhere else, and keeps working when Research Hub is closed.
 *
 * One target per symbol is the system's contract, so the modal pre-fills the
 * existing alert (edit, with revision history) rather than silently creating
 * a duplicate.
 */

import { useState } from "react";
import { Bell } from "lucide-react";
import { TargetModal, type ConsensusReference, type TargetPatch } from "@/app/_components/target-modal";
import { useToast } from "@/app/_components/toast";
import { formatCurrency } from "@/lib/format";
import type { WatchlistItem } from "@/lib/types";

interface Props {
  symbol: string;
  name: string;
  currency: string;
  /** Analyst consensus, shown as reference inside the modal (never pre-filled). */
  consensus?: ConsensusReference;
  /** Saving tracks the symbol on the watchlist — lets the header's Watchlist button reflect that. */
  onTracked?: () => void;
}

function syntheticItem(symbol: string, name: string): WatchlistItem {
  return {
    symbol,
    name,
    addedAt: new Date().toISOString(),
    targetPrice: null,
    targetDirection: null,
    alertPctDrop: null,
    notes: null,
    buyTrigger: null,
    sellTrigger: null,
    conviction: null,
    horizon: null,
    lastReviewedAt: null,
    lastResearchedAt: null,
    stage: "surfaced",
    stageChangedAt: null,
    source: null,
    sourceDetail: null,
  };
}

export function PriceAlertAction({ symbol, name, currency, consensus, onTracked }: Props) {
  const [item, setItem] = useState<WatchlistItem | null>(null); // non-null = modal open
  const [wasTracked, setWasTracked] = useState(false);
  const [loading, setLoading] = useState(false);
  const toast = useToast();

  async function open() {
    if (loading) return;
    setLoading(true);
    try {
      // Pre-fill from the existing row so an alert that already exists is
      // edited (with a recorded revision) instead of silently replaced.
      const res = await fetch("/api/watchlist");
      const json = res.ok ? ((await res.json()) as { items: WatchlistItem[] }) : { items: [] };
      const existing = json.items.find((i) => i.symbol.toUpperCase() === symbol.toUpperCase()) ?? null;
      setWasTracked(existing != null);
      setItem(existing ?? syntheticItem(symbol, name));
    } catch {
      setWasTracked(false);
      setItem(syntheticItem(symbol, name));
    } finally {
      setLoading(false);
    }
  }

  async function save(patch: TargetPatch) {
    // Alerts live on watchlist rows, so the row must exist first. The POST is
    // an idempotent upsert that never clobbers an existing target/notes/stage
    // (lib/db.ts addToWatchlist), so re-running it for a tracked symbol is safe.
    const post = await fetch("/api/watchlist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbol, name, source: "research", sourceDetail: "Price alert set while researching" }),
    });
    if (!post.ok) {
      const body = (await post.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? "Could not save the alert");
    }

    const res = await fetch("/api/watchlist", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbol, ...patch }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? "Could not save the alert");
    }

    setItem(null);
    if (patch.targetPrice != null) {
      const level = `${symbol} ${patch.targetDirection === "below" ? "below" : "above"} ${formatCurrency(patch.targetPrice, currency)}`;
      toast(wasTracked ? `Price alert set · ${level}` : `Price alert set · ${level} — now tracked on your Watchlist`);
    } else {
      toast("Price alert cleared");
    }
    onTracked?.();
  }

  return (
    <>
      <button
        onClick={() => void open()}
        disabled={loading}
        className="inline-flex items-center gap-1.5 rounded-control px-2.5 py-2 text-sm text-muted outline-none transition-colors hover:bg-surface-2 hover:text-foreground focus-visible:ring-2 focus-visible:ring-brand/40 disabled:opacity-60"
      >
        <Bell className="h-4 w-4" strokeWidth={1.75} /> Price alert
      </button>
      {item && (
        <TargetModal
          item={item}
          consensus={consensus}
          onSave={save}
          onCancel={() => setItem(null)}
        />
      )}
    </>
  );
}
