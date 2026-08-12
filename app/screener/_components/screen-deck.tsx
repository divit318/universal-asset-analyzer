"use client";

/**
 * The command deck — the Screener's entire screen *definition* workflow in one
 * dense band: asset class, market, strategy, and the AI filter builder.
 *
 * The old layout spent ~600px of the viewport on this sequence (tab row,
 * description, a full-width grid of large template cards) before the first
 * result was visible. The deck compresses it to two rows without dropping a
 * step, and makes the taxonomy legible: asset class and market are separate
 * decisions, in that order, because they are separate concepts —
 * `01 Asset class` lists the base classes (lib/assets listBaseAssetClasses),
 * `02 Market` lists that class's screening universes (the base universe plus
 * any marketVariantOf definitions, e.g. Equities → United States / India).
 * A class with a single universe shows its market as a static fact rather
 * than a one-option control.
 *
 * Everything here is registry-derived: adding a `japanEquity` variant would
 * grow the Market row on its own, with its own filters, columns and templates
 * downstream — no changes in this file.
 */

import { useState } from "react";
import { Sparkles } from "lucide-react";
import { Card } from "@/app/_components/ui";
import { getAssetClass, listAssetClasses, listBaseAssetClasses } from "@/lib/assets/registry";
import type { AssetClassId } from "@/lib/assets/types";
import { MARKET_LABEL, type MarketRegion } from "@/lib/market";
import type { UniverseStatus } from "@/lib/screener/types";

interface Props {
  /** The selected screening universe — a base class id or a market variant id. */
  universe: AssetClassId;
  onSelectUniverse: (id: AssetClassId) => void;
  templateId: string | null;
  onApplyTemplate: (id: string) => void;
  onClearAll: () => void;
  /** Template or any filter active — shows the Clear control. */
  hasActiveScreen: boolean;
  status: UniverseStatus | null;
  loading: boolean;
  onRefresh: () => void;
  /** AI filter builder — parses a plain-English description into filters. */
  onNlSubmit: (prompt: string) => void;
  nlBusy: boolean;
}

/** Full market names where the registry stores a region code. */
const MARKET_NAME: Partial<Record<MarketRegion | "Global", string>> = {
  US: "United States",
  IN: "India",
  Global: "Global",
};

function marketName(code: string): string {
  return MARKET_NAME[code as MarketRegion | "Global"] ?? MARKET_LABEL[code as MarketRegion] ?? code;
}

/** Numbered step: uppercase micro-label over its control row (SectionHeader idiom, deck-sized). */
function Step({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span className="text-label font-semibold uppercase tracking-widest text-muted/60">{label}</span>
      <div className="flex flex-wrap items-stretch gap-1.5">{children}</div>
    </div>
  );
}

function chipClass(active: boolean): string {
  return `rounded-control border px-2.5 py-1 text-xs font-medium transition-colors ${
    active
      ? "border-brand bg-brand/10 text-brand"
      : "border-border bg-surface-2 text-muted hover:border-brand/50 hover:text-foreground"
  }`;
}

export function ScreenDeck({
  universe,
  onSelectUniverse,
  templateId,
  onApplyTemplate,
  onClearAll,
  hasActiveScreen,
  status,
  loading,
  onRefresh,
  onNlSubmit,
  nlBusy,
}: Props) {
  const def = getAssetClass(universe);
  const baseId = def.marketVariantOf ?? def.id;
  const base = getAssetClass(baseId);
  // This base class's screening universes: itself plus its market variants.
  const marketUniverses = [base, ...listAssetClasses().filter((c) => c.marketVariantOf === baseId)];
  const [nlDraft, setNlDraft] = useState("");

  const submitNl = () => {
    const q = nlDraft.trim();
    if (!q || nlBusy) return;
    onNlSubmit(q);
    setNlDraft("");
  };

  return (
    <Card padding="none">
      {/* Row 1 — what and where, plus the universe's live state. */}
      <div className="flex flex-wrap items-start gap-x-8 gap-y-3 px-4 py-3">
        <Step label="01 · Asset class">
          {listBaseAssetClasses().map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => onSelectUniverse(c.id)}
              aria-current={baseId === c.id}
              title={c.description}
              className={chipClass(baseId === c.id)}
            >
              {c.label}
            </button>
          ))}
        </Step>

        <Step label="02 · Market">
          {marketUniverses.length > 1 ? (
            marketUniverses.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => onSelectUniverse(m.id)}
                aria-current={universe === m.id}
                title={m.description}
                className={`${chipClass(universe === m.id)} text-left`}
              >
                <span className="block">{m.marketVariantOf ? m.label : marketName(m.markets[0] ?? "")}</span>
                {m.exchanges.length > 0 ? (
                  <span className="block text-[10px] font-normal text-muted">{m.exchanges.join(" · ")}</span>
                ) : null}
              </button>
            ))
          ) : (
            // One universe — its market is a fact, not a choice.
            <span className="self-center rounded-control border border-border/60 px-2.5 py-1 text-xs text-muted">
              {marketName(base.markets[0] ?? "")}
              {base.exchanges.length > 0 ? (
                <span className="text-muted/60"> · {base.exchanges.join(" · ")}</span>
              ) : null}
            </span>
          )}
        </Step>

        {/* Universe state, on the row where the universe is chosen. The cold-build
            progress bar (TaskProgress with ETA) still renders full-width below. */}
        <div className="ml-auto flex items-center gap-2 self-end pb-0.5 text-xs text-muted">
          {status?.stage === "ready" ? (
            <span>
              <span className="font-mono tabular-nums text-foreground">{status.ready.toLocaleString()}</span>{" "}
              {def.noun}
              {status.builtAt ? ` · updated ${new Date(status.builtAt).toLocaleTimeString()}` : ""}
            </span>
          ) : status?.stage === "building" ? (
            <span className="text-brand">building universe…</span>
          ) : status?.stage === "error" ? (
            <span className="text-negative">universe failed to build</span>
          ) : null}
          <button
            type="button"
            onClick={onRefresh}
            disabled={loading}
            className="underline underline-offset-2 transition-colors hover:text-brand disabled:opacity-40"
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Row 2 — how: a strategy preset, or describe the screen in plain English. */}
      <div className="flex flex-wrap items-start gap-x-8 gap-y-3 border-t border-border px-4 py-3">
        <Step label="03 · Strategy">
          {def.templates.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => onApplyTemplate(t.id)}
              aria-pressed={templateId === t.id}
              title={t.tagline}
              className={`${chipClass(templateId === t.id)} text-left`}
            >
              <span className="block">{t.name}</span>
              <span className="block max-w-[168px] truncate text-[10px] font-normal text-muted">{t.tagline}</span>
            </button>
          ))}
          {hasActiveScreen ? (
            <button
              type="button"
              onClick={onClearAll}
              className="self-center px-1 text-xs text-muted underline underline-offset-2 transition-colors hover:text-brand"
            >
              Clear all
            </button>
          ) : null}
        </Step>

        <div className="ml-auto flex min-w-[260px] max-w-md flex-1 flex-col gap-1.5">
          <span className="text-label font-semibold uppercase tracking-widest text-muted/60">
            Or describe it
          </span>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submitNl();
            }}
            className="relative"
          >
            <Sparkles
              aria-hidden
              strokeWidth={2}
              className={`pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 ${nlBusy ? "animate-pulse text-brand" : "text-muted/60"}`}
            />
            <input
              value={nlDraft}
              onChange={(e) => setNlDraft(e.target.value)}
              disabled={nlBusy}
              placeholder={nlBusy ? "Turning your description into filters…" : 'Describe a screen — "high quality, low debt, reasonably priced"'}
              aria-label="Describe a screen in plain English"
              className="w-full rounded-control border border-border bg-surface-2 py-1.5 pl-8 pr-14 text-xs outline-none transition-colors placeholder:text-muted/60 focus:border-brand disabled:opacity-60"
            />
            <button
              type="submit"
              disabled={!nlDraft.trim() || nlBusy}
              className="absolute right-1 top-1/2 -translate-y-1/2 rounded-control px-2 py-1 text-[11px] font-medium text-brand transition-colors hover:bg-brand/10 disabled:opacity-0"
            >
              Apply ↵
            </button>
          </form>
        </div>
      </div>
    </Card>
  );
}
