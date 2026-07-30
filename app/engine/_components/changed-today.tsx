/**
 * What changed since the last run — the desk's answer to "why am I looking at
 * this today rather than yesterday".
 *
 * Deliberately a delta view, not another ranking. The conviction book below
 * already says what's best right now; this says what *moved*, which is the only
 * part of a systematic process that generates new work. A name that was a SELL
 * and is now a BUY is a decision; a name that has been a BUY for three weeks is
 * not news.
 */

"use client";

import Link from "next/link";
import { Reveal } from "@/app/_components/reveal";
import { signalTone, SIGNAL_LABEL, type Movers } from "@/lib/engine-desk";
import { Derivation, Rule, fmtZ } from "./desk-primitives";

export function ChangedToday({ movers, prevDate }: { movers: Movers; prevDate: string | null }) {
  const hasAny =
    movers.upgrades.length > 0 ||
    movers.downgrades.length > 0 ||
    movers.signals_added.length > 0 ||
    movers.signals_removed.length > 0;

  if (!prevDate) {
    return (
      <p className="text-sm text-muted">
        Only one run on file, so there is nothing to compare against yet. Change tracking starts from
        the second engine run.
      </p>
    );
  }

  if (!hasAny) {
    return (
      <p className="text-sm text-muted">
        Nothing moved between {prevDate} and the latest run across the {movers.n_compared} names
        present in both.
      </p>
    );
  }

  // Largest absolute move across both directions sets a shared bar scale, so an
  // upgrade and a downgrade of equal size draw equal bars.
  const maxDelta = Math.max(
    ...movers.upgrades.map((m) => Math.abs(m.delta)),
    ...movers.downgrades.map((m) => Math.abs(m.delta)),
    0.01,
  );

  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-5 lg:grid-cols-2">
        <MoverColumn title="Biggest upgrades" rows={movers.upgrades} maxDelta={maxDelta} direction="up" />
        <MoverColumn title="Biggest downgrades" rows={movers.downgrades} maxDelta={maxDelta} direction="down" />
      </div>

      {(movers.signals_added.length > 0 || movers.signals_removed.length > 0) && (
        <div className="grid gap-5 lg:grid-cols-2">
          <SignalChangeList
            title="Signals opened"
            hint="Crossed from HOLD into an actionable tier"
            rows={movers.signals_added}
            accent="border-l-positive"
          />
          <SignalChangeList
            title="Signals closed"
            hint="Fell back to HOLD — the thesis no longer clears the threshold"
            rows={movers.signals_removed}
            accent="border-l-negative"
          />
        </div>
      )}

      <Derivation>
        Compared against the previous run ({prevDate}) across the {movers.n_compared} names scored in
        both. Δ is the change in composite z-score, not price.
      </Derivation>
    </div>
  );
}

function MoverColumn({
  title,
  rows,
  maxDelta,
  direction,
}: {
  title: string;
  rows: Movers["upgrades"];
  maxDelta: number;
  direction: "up" | "down";
}) {
  return (
    <div className="flex flex-col gap-2">
      <Rule>{title}</Rule>
      {rows.length === 0 ? (
        <p className="py-3 text-xs text-faint">None this run.</p>
      ) : (
        <div className="flex flex-col">
          {rows.map((m, i) => (
            <Reveal
              key={m.symbol}
              index={i}
              className="group flex items-center gap-3 border-b border-border/50 py-2 last:border-0"
            >
              <Link
                href={`/stocks/${m.symbol}`}
                className="w-16 shrink-0 font-mono text-xs font-semibold text-brand transition-colors hover:underline"
              >
                {m.symbol}
              </Link>

              {/* Δ bar, drawn from a shared left edge so the column reads as a ranking. */}
              <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
                <div
                  className={`absolute inset-y-0 left-0 animate-bar-fill rounded-full ${direction === "up" ? "bg-positive" : "bg-negative"}`}
                  style={{ ["--bar-value" as string]: `${(Math.abs(m.delta) / maxDelta) * 100}%` } as React.CSSProperties}
                />
              </div>

              <span
                className={`w-14 shrink-0 text-right font-mono text-xs tabular-nums ${direction === "up" ? "text-positive" : "text-negative"}`}
              >
                {fmtZ(m.delta)}
              </span>

              {/* Tier transitions are the only changes worth a label; a same-tier
                  drift is already fully described by the bar. */}
              {m.tier_changed ? (
                <span className="flex w-28 shrink-0 items-center justify-end gap-1 text-label">
                  <span className={signalTone(m.prev_signal).text}>{SIGNAL_LABEL[m.prev_signal] ?? m.prev_signal}</span>
                  <span className="text-faint">→</span>
                  <span className={`font-semibold ${signalTone(m.signal).text}`}>
                    {SIGNAL_LABEL[m.signal] ?? m.signal}
                  </span>
                </span>
              ) : (
                <span className="w-28 shrink-0 text-right text-label text-faint">
                  {SIGNAL_LABEL[m.signal] ?? m.signal}
                </span>
              )}
            </Reveal>
          ))}
        </div>
      )}
    </div>
  );
}

function SignalChangeList({
  title,
  hint,
  rows,
  accent,
}: {
  title: string;
  hint: string;
  rows: Movers["signals_added"];
  accent: string;
}) {
  if (rows.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <Rule>{title}</Rule>
      <p className="text-caption text-faint">{hint}</p>
      <div className="flex flex-wrap gap-1.5">
        {rows.map((r, i) => (
          <Reveal key={r.symbol} index={i}>
            <Link
              href={`/stocks/${r.symbol}`}
              title={r.name ?? r.symbol}
              className={`flex items-center gap-2 rounded-control border border-l-2 border-border ${accent} bg-surface-2 px-2.5 py-1 transition-colors hover:border-border-strong hover:bg-surface-3`}
            >
              <span className="font-mono text-xs font-semibold">{r.symbol}</span>
              <span className={`text-label font-semibold uppercase ${signalTone(r.signal).text}`}>
                {SIGNAL_LABEL[r.signal] ?? r.signal}
              </span>
            </Link>
          </Reveal>
        ))}
      </div>
    </div>
  );
}
