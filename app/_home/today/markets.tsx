"use client";

/**
 * VI · MARKETS — the tape.
 *
 * The digest's market groups, arranged as the prototype's four hairline
 * columns (indices+volatility, rates & fx, commodities, crypto). The same
 * 60s cadence the old module declared refreshes the digest here (visible
 * tab only); a repriced ticker flashes with direction color via the
 * existing value-flash grammar. The rotation strip is the engine's
 * sector-leadership changes for sectors you actually hold.
 */

import { useEffect, useMemo } from "react";
import { useValueFlash } from "@/app/_components/use-value-flash";
import type { MarketTicker } from "@/lib/home/contracts";
import { fmtSignedPct } from "../_viz/format";
import { useHome, useHomeSlice } from "../home-provider";
import { Eyebrow } from "./primitives";

const REFRESH_MS = 60_000;

const COLUMNS: { title: string; ids: string[] }[] = [
  { title: "INDICES", ids: ["indices", "volatility"] },
  { title: "RATES & FX", ids: ["rates", "currencies"] },
  { title: "COMMODITIES", ids: ["commodities"] },
  { title: "CRYPTO", ids: ["crypto"] },
];

/** Tight cell labels for the sector strip; full names live in the tooltip. */
const SECTOR_SHORT: Record<string, string> = {
  XLK: "TECH",
  XLC: "COMMS",
  XLY: "CYCLIC",
  XLF: "FINCL",
  XLB: "MATRLS",
  XLI: "INDUST",
  XLV: "HEALTH",
  XLP: "STAPLES",
  XLU: "UTILS",
  XLRE: "REALTY",
  XLE: "ENERGY",
};

function fmtPrice(v: number | null): string {
  if (v == null) return "—";
  const digits = Math.abs(v) >= 1000 ? 2 : Math.abs(v) >= 10 ? 2 : 4;
  return v.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: digits });
}

/** One tape row. A repriced value flashes with direction color (re-poll only). */
function TickerRow({ t }: { t: MarketTicker }) {
  const flash = useValueFlash(t.price);
  return (
    <li className="-mx-1.5 grid grid-cols-[1fr_auto_auto] items-baseline gap-3 rounded-md px-1.5 py-2 transition-colors duration-(--duration-base) hover:bg-surface/70">
      <span className="truncate text-xs text-muted" title={t.symbol}>
        {t.label}
      </span>
      <span className={`-mr-1 rounded-[3px] px-1 font-mono text-[12.5px] tabular-nums ${flash}`}>
        {fmtPrice(t.price)}
      </span>
      <span
        className={`w-16 text-right font-mono text-[11.5px] tabular-nums ${
          t.changePct == null ? "text-faint" : t.changePct < 0 ? "text-negative" : "text-positive"
        }`}
      >
        {t.changePct == null ? "—" : fmtSignedPct(t.changePct)}
      </span>
    </li>
  );
}

export function Markets() {
  const market = useHomeSlice("marketIntelligence");
  const pulse = useHomeSlice("portfolioPulse");
  const { refreshDigest } = useHome();

  // The tape is the one genuinely live surface — same cadence the module
  // registry declared (60s), skipped while the tab is hidden.
  useEffect(() => {
    const id = window.setInterval(() => {
      if (!document.hidden) refreshDigest();
    }, REFRESH_MS);
    return () => window.clearInterval(id);
  }, [refreshDigest]);

  const columns = useMemo(() => {
    const groups = market.data?.groups ?? [];
    return COLUMNS.map((c) => ({
      title: c.title,
      live: c.ids.includes("crypto"),
      tickers: c.ids.flatMap((id) => groups.find((g) => g.id === id)?.tickers ?? []).slice(0, 5),
    })).filter((c) => c.tickers.length > 0);
  }, [market.data]);

  const rotation = useMemo(() => market.data?.sectorAttention ?? [], [market.data]);
  const sectors = market.data?.sectors ?? [];
  const regime = market.data?.regime ?? null;
  // sectorAttention is already filtered to held sectors — its weights mark
  // the strip's diamonds. A held sector with no leadership change carries no
  // weight here, so the diamond means "held, and moving".
  const heldWeights = useMemo(
    () =>
      new Map(
        rotation
          .filter((r) => r.portfolioWeightPct != null)
          .map((r) => [r.sector, r.portfolioWeightPct as number]),
      ),
    [rotation],
  );

  return (
    <section id="tdy-markets" aria-labelledby="tdy-markets-h" className="py-14 max-md:py-10">
      <div className="tdy-shell">
        <Eyebrow
          id="tdy-markets-h"
          note={
            <>
              {pulse.data?.sessionNote ? `${pulse.data.sessionNote.toUpperCase()} · ` : ""}
              {regime ? `${regime.trend.toUpperCase()}${regime.breadthPct != null ? ` · BREADTH ${Math.round(regime.breadthPct)}%` : ""}` : ""}
            </>
          }
        >
          Markets — the tape
        </Eyebrow>

        {market.status === "error" && !market.data ? (
          <p className="mt-6 text-sm text-muted">
            Tape unavailable.{" "}
            <button type="button" onClick={refreshDigest} className="font-medium text-brand hover:underline">
              Retry
            </button>
          </p>
        ) : (
          <>
            <div className="mt-8 grid grid-cols-4 gap-11 max-lg:grid-cols-2 max-lg:gap-7 max-md:grid-cols-1">
              {columns.map((col) => (
                <div key={col.title}>
                  <p className="mb-1.5 flex items-center gap-2 border-b border-hairline pb-3 font-mono text-[9.5px] tracking-[0.2em] text-faint">
                    {col.title}
                    {col.live ? (
                      <span
                        className="h-[5px] w-[5px] rounded-full bg-positive [animation:uaa-breathe_2.4s_var(--ease-precise)_infinite] motion-reduce:animate-none"
                        aria-hidden="true"
                        title="Trades continuously"
                      />
                    ) : null}
                  </p>
                  <ul>
                    {col.tickers.map((t) => (
                      <TickerRow key={t.symbol} t={t} />
                    ))}
                  </ul>
                </div>
              ))}
            </div>

            {sectors.length > 0 ? (
              <div className="mt-11">
                <div className="mb-3 flex items-baseline justify-between gap-4">
                  <p className="font-mono text-[9.5px] tracking-[0.2em] text-faint">
                    SECTORS · STRONG <span aria-hidden="true">→</span> WEAK
                  </p>
                  {heldWeights.size > 0 ? (
                    <p className="font-mono text-[9.5px] tracking-[0.14em] text-faint">
                      <span className="mb-px mr-1.5 inline-block h-[5px] w-[5px] rotate-45 bg-brand align-middle" aria-hidden="true" />
                      HELD · MOVING
                    </p>
                  ) : null}
                </div>
                <div className="flex gap-1 max-md:flex-wrap">
                  {sectors.map((s) => {
                    const chg = s.changePct ?? 0;
                    const held = heldWeights.get(s.label);
                    const rank = rotation.find((r) => r.sector === s.label);
                    return (
                      <div
                        key={s.symbol}
                        className="flex min-w-0 flex-1 flex-col items-center gap-1 rounded border border-transparent px-1 py-2.5 transition-[border-color,transform] duration-(--duration-base) hover:-translate-y-0.5 hover:border-border-strong motion-reduce:hover:translate-y-0 max-md:min-w-[16%]"
                        style={{
                          background: `color-mix(in srgb, var(${chg >= 0 ? "--positive" : "--negative"}) ${Math.min(
                            24,
                            Math.abs(chg) * 16,
                          ).toFixed(0)}%, var(--surface))`,
                        }}
                        role="img"
                        aria-label={`${s.label} ${fmtSignedPct(chg, 1)}${held != null ? `, ${held.toFixed(1)}% of book` : ""}`}
                        title={`${s.label}${rank ? ` · leadership #${rank.fromRank} → #${rank.toRank}` : ""}`}
                      >
                        <span className="flex items-center gap-1 font-mono text-[9px] tracking-[0.06em] text-muted">
                          {held != null ? (
                            <span className="h-[4px] w-[4px] flex-none rotate-45 bg-brand" aria-hidden="true" />
                          ) : null}
                          {SECTOR_SHORT[s.symbol] ?? s.label}
                        </span>
                        <b
                          className={`font-mono text-[10.5px] font-medium tabular-nums ${
                            chg >= 0 ? "text-positive" : "text-negative"
                          }`}
                        >
                          {fmtSignedPct(chg, 1)}
                        </b>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}
