"use client";

import Link from "next/link";
import type { ScreenerInPeer } from "@/lib/screener-in";
import { Reveal } from "@/app/_components/reveal";
import { ValueBar } from "@/app/_components/value-bar";

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

function parseNum(v: string | null | undefined): number | null {
  if (!v) return null;
  const n = parseFloat(v.replace(/,/g, ""));
  return isFinite(n) ? n : null;
}

function fmtCr(v: string | null): string {
  const n = parseNum(v);
  if (n == null) return "—";
  if (n >= 1_00_000) return `₹${(n / 1_00_000).toFixed(1)}L Cr`;
  if (n >= 1_000) return `₹${(n / 1_000).toFixed(0)}K Cr`;
  return `₹${n.toFixed(0)} Cr`;
}

/* -------------------------------------------------------------------------- */
/* Rank computation                                                            */
/* -------------------------------------------------------------------------- */

type Metric = "pe" | "roce" | "market_cap" | "dividend_yield";

// Lower P/E = better rank, Higher ROCE = better rank
const METRIC_HIGH_IS_BETTER: Record<Metric, boolean> = {
  pe: false,
  roce: true,
  market_cap: true,
  dividend_yield: true,
};

function computeRanks(peers: ScreenerInPeer[], metric: Metric): Map<string, number> {
  const withValues = peers
    .map((p) => ({ key: p.url ?? p.name, val: parseNum(p[metric]) }))
    .filter((d) => d.val != null) as { key: string; val: number }[];

  const sorted = [...withValues].sort((a, b) =>
    METRIC_HIGH_IS_BETTER[metric] ? b.val - a.val : a.val - b.val,
  );

  const rankMap = new Map<string, number>();
  sorted.forEach((d, i) => rankMap.set(d.key, i + 1));
  return rankMap;
}

/* -------------------------------------------------------------------------- */
/* Relative standing badge                                                     */
/* -------------------------------------------------------------------------- */

function StandingBadge({ rank, total }: { rank: number | undefined; total: number }) {
  if (rank == null) return <span className="text-xs text-muted">—</span>;
  const pct = rank / total;
  if (rank === 1) return (
    <span className="inline-flex items-center rounded border border-positive/30 bg-positive/10 px-1.5 py-0.5 text-[10px] font-semibold text-positive">
      Best
    </span>
  );
  if (pct <= 0.25) return (
    <span className="inline-flex items-center rounded border border-positive/20 bg-positive/8 px-1.5 py-0.5 text-[10px] font-medium text-positive/80">
      Top quartile
    </span>
  );
  if (pct <= 0.5) return (
    <span className="inline-flex items-center rounded border border-warning/25 bg-warning/8 px-1.5 py-0.5 text-[10px] font-medium text-warning/80">
      Above avg
    </span>
  );
  if (pct <= 0.75) return (
    <span className="inline-flex items-center rounded border border-border px-1.5 py-0.5 text-[10px] text-muted">
      Median
    </span>
  );
  return (
    <span className="inline-flex items-center rounded border border-negative/20 bg-negative/8 px-1.5 py-0.5 text-[10px] text-negative/70">
      Below peers
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Metric cell with bar visualization                                          */
/* -------------------------------------------------------------------------- */

function MetricBar({
  value,
  allValues,
  higherIsBetter,
}: {
  value: number | null;
  allValues: number[];
  higherIsBetter: boolean;
}) {
  if (value == null || allValues.length === 0) {
    return <ValueBar value={null} trackClassName="bg-surface-3" />;
  }

  const min = Math.min(...allValues);
  const max = Math.max(...allValues);
  const range = max - min || 1;
  const pct = higherIsBetter
    ? ((value - min) / range) * 100
    : ((max - value) / range) * 100;

  return (
    <ValueBar
      value={pct}
      trackClassName="bg-surface-3"
      barClassName={pct >= 66 ? "bg-positive" : pct >= 33 ? "bg-warning" : "bg-negative"}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Competitive position summary                                                */
/* -------------------------------------------------------------------------- */

function CompetitivePositionSummary({
  target,
  peers,
  currentSymbol,
}: {
  target: ScreenerInPeer | undefined;
  peers: ScreenerInPeer[];
  currentSymbol: string;
}) {
  if (!target) return null;

  const total = peers.length;
  const peRank = computeRanks(peers, "pe").get(target.url ?? target.name);
  const roceRank = computeRanks(peers, "roce").get(target.url ?? target.name);
  const mcapRank = computeRanks(peers, "market_cap").get(target.url ?? target.name);

  const pePct = peRank ? Math.round((1 - peRank / total) * 100) : null;

  const targetROCE = parseNum(target.roce);
  const peerROCEs = peers.map((p) => parseNum(p.roce)).filter((v): v is number => v != null);
  const medianROCE = peerROCEs.length
    ? [...peerROCEs].sort((a, b) => a - b)[Math.floor(peerROCEs.length / 2)]
    : null;

  const points: string[] = [];

  if (targetROCE != null && medianROCE != null) {
    if (targetROCE > medianROCE * 1.2)
      points.push(`${currentSymbol} delivers ROCE ${(targetROCE - medianROCE).toFixed(1)}pp above peer median — strong capital efficiency advantage`);
    else if (targetROCE < medianROCE * 0.8)
      points.push(`ROCE lags peer median by ${(medianROCE - targetROCE).toFixed(1)}pp — monitor capital allocation`);
    else
      points.push(`ROCE broadly in line with peers (${targetROCE.toFixed(1)}% vs sector median ${medianROCE.toFixed(1)}%)`);
  }

  if (pePct != null) {
    if (pePct > 50)
      points.push(`P/E in bottom ${100 - pePct}% of peers — relatively inexpensive vs sector`);
    else if (pePct < 30)
      points.push(`P/E premium to most peers — market pricing in higher growth expectations`);
  }

  const mcapNums = peers.map((p) => parseNum(p.market_cap)).filter((v): v is number => v != null);
  const targetMcap = parseNum(target.market_cap);
  if (targetMcap != null && mcapNums.length > 0) {
    const rank = [...mcapNums].sort((a, b) => b - a).indexOf(targetMcap) + 1;
    if (rank === 1) points.push(`Largest company in the peer group by market cap`);
    else if (rank <= 3) points.push(`${rank === 2 ? "Second" : "Third"} largest in peer group by market cap`);
  }

  if (!points.length) return null;

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface-2 px-4 py-3">
      <span className="text-[10px] font-semibold uppercase tracking-widest text-muted">Competitive Position</span>
      {points.map((p, i) => (
        <Reveal key={i} as="p" index={i} className="text-xs leading-5 text-muted">{p}</Reveal>
      ))}
      <div className="mt-1 flex flex-wrap gap-3 text-xs">
        {peRank != null && <span className="text-muted">P/E rank: <span className="font-mono text-foreground">#{peRank}/{total}</span></span>}
        {roceRank != null && <span className="text-muted">ROCE rank: <span className="font-mono text-foreground">#{roceRank}/{total}</span></span>}
        {mcapRank != null && <span className="text-muted">Mkt cap rank: <span className="font-mono text-foreground">#{mcapRank}/{total}</span></span>}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Main table                                                                  */
/* -------------------------------------------------------------------------- */

export function RankedPeers({
  peers,
  currentSymbol,
}: {
  peers: ScreenerInPeer[];
  currentSymbol: string;
}) {
  if (!peers.length) {
    return (
      <p className="rounded-lg border border-border bg-surface px-4 py-8 text-center text-sm text-muted">
        No peer data available.
      </p>
    );
  }

  const peRanks    = computeRanks(peers, "pe");
  const roceRanks  = computeRanks(peers, "roce");
  const divRanks   = computeRanks(peers, "dividend_yield");

  const allPEs    = peers.map((p) => parseNum(p.pe)).filter((v): v is number => v != null);
  const allROCEs  = peers.map((p) => parseNum(p.roce)).filter((v): v is number => v != null);

  const targetPeer = peers.find((p) => {
    const slug = p.url?.match(/company\/([^/]+)/)?.[1] ?? "";
    return slug.toUpperCase() === currentSymbol.toUpperCase();
  });

  const total = peers.length;

  return (
    <div className="flex flex-col gap-4">
      {/* Competitive position summary */}
      <CompetitivePositionSummary target={targetPeer} peers={peers} currentSymbol={currentSymbol} />

      {/* Peer table */}
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead className="bg-surface-2">
            <tr className="text-left text-[10px] uppercase tracking-wider text-muted">
              <th className="px-3 py-3 font-medium">Company</th>
              <th className="px-3 py-3 text-right font-medium">Mkt Cap</th>
              <th className="px-3 py-3 text-right font-medium">Price</th>
              <th className="px-3 py-3 font-medium">
                P/E
                <span className="ml-1 text-[9px] normal-case tracking-normal text-muted/60">(lower ↑)</span>
              </th>
              <th className="px-3 py-3 font-medium">
                ROCE %
                <span className="ml-1 text-[9px] normal-case tracking-normal text-muted/60">(higher ↑)</span>
              </th>
              <th className="px-3 py-3 text-right font-medium">Div Yld</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {peers.map((p, rowIndex) => {
              const slug = p.url?.match(/company\/([^/]+)/)?.[1] ?? "";
              const isCurrent = slug.toUpperCase() === currentSymbol.toUpperCase();
              const peerKey = p.url ?? p.name;
              const peVal = parseNum(p.pe);
              const roceVal = parseNum(p.roce);

              return (
                <Reveal
                  as="tr"
                  key={peerKey}
                  index={rowIndex}
                  className={`group bg-surface hover:bg-surface-2 ${isCurrent ? "ring-1 ring-inset ring-accent/20" : ""}`}
                >
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-2">
                      {isCurrent && (
                        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                      )}
                      {slug ? (
                        <Link
                          href={`/research/india?symbol=${encodeURIComponent(slug)}`}
                          className={`text-sm ${isCurrent ? "font-semibold text-foreground" : "text-muted hover:text-foreground"}`}
                        >
                          {p.name}
                        </Link>
                      ) : (
                        <span className={`text-sm ${isCurrent ? "font-semibold text-foreground" : "text-muted"}`}>{p.name}</span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-3 text-right font-mono text-xs text-muted">
                    {fmtCr(p.market_cap)}
                  </td>
                  <td className="px-3 py-3 text-right font-mono text-xs">
                    {p.current_price ? `₹${parseNum(p.current_price)?.toFixed(0) ?? "—"}` : "—"}
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex flex-col gap-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-xs">{peVal != null ? peVal.toFixed(1) : "—"}</span>
                        <StandingBadge rank={peRanks.get(peerKey)} total={total} />
                      </div>
                      <MetricBar value={peVal} allValues={allPEs} higherIsBetter={false} />
                    </div>
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex flex-col gap-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-xs">{roceVal != null ? `${roceVal.toFixed(1)}%` : "—"}</span>
                        <StandingBadge rank={roceRanks.get(peerKey)} total={total} />
                      </div>
                      <MetricBar value={roceVal} allValues={allROCEs} higherIsBetter={true} />
                    </div>
                  </td>
                  <td className="px-3 py-3 text-right">
                    <div className="flex flex-col items-end gap-1">
                      <span className="font-mono text-xs">
                        {p.dividend_yield ? `${parseNum(p.dividend_yield)?.toFixed(1)}%` : "—"}
                      </span>
                      <StandingBadge rank={divRanks.get(peerKey)} total={total} />
                    </div>
                  </td>
                </Reveal>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-[10px] text-muted/60">
        Rankings computed within this peer set. P/E rank: lower = cheaper. ROCE rank: higher = better capital efficiency.
        Data from screener.in.
      </p>
    </div>
  );
}
