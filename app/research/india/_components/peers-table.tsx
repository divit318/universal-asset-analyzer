"use client";

import Link from "next/link";
import type { ScreenerInPeer } from "@/lib/screener-in";

function num(v: string | null | undefined): number | null {
  if (!v) return null;
  const n = parseFloat(v.replace(/,/g, ""));
  return isFinite(n) ? n : null;
}

function Cell({ value }: { value: string | null | undefined }) {
  const n = num(value);
  if (n == null) return <span className="text-muted">—</span>;
  return <span className="font-mono">{n.toFixed(1)}</span>;
}

export function PeersTable({
  peers,
  currentSymbol,
}: {
  peers: ScreenerInPeer[];
  currentSymbol: string;
}) {
  if (!peers.length) return <p className="text-sm text-muted">No peer data available.</p>;

  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full text-sm">
        <thead className="bg-surface-2 text-left text-xs uppercase tracking-wide text-muted">
          <tr>
            <th className="px-3 py-3 font-medium">Company</th>
            <th className="px-3 py-3 text-right font-medium">Mkt Cap (Cr)</th>
            <th className="px-3 py-3 text-right font-medium">Price</th>
            <th className="px-3 py-3 text-right font-medium">P/E</th>
            <th className="px-3 py-3 text-right font-medium">ROCE %</th>
            <th className="px-3 py-3 text-right font-medium">ROE %</th>
            <th className="px-3 py-3 text-right font-medium">Div Yld %</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {peers.map((p) => {
            const slug = p.url?.match(/company\/([^/]+)/)?.[1] ?? "";
            const isCurrent = slug.toUpperCase() === currentSymbol.toUpperCase();
            return (
              <tr
                key={p.url ?? p.name}
                className={`bg-surface hover:bg-surface-2 ${isCurrent ? "font-medium text-foreground" : "text-muted"}`}
              >
                <td className="px-3 py-2.5">
                  {slug ? (
                    <Link
                      href={`/research/india?symbol=${encodeURIComponent(slug)}`}
                      className="hover:text-accent hover:underline"
                    >
                      {p.name}
                      {isCurrent ? " ★" : ""}
                    </Link>
                  ) : (
                    p.name
                  )}
                </td>
                <td className="px-3 py-2.5 text-right">
                  <Cell value={p.market_cap} />
                </td>
                <td className="px-3 py-2.5 text-right">
                  <Cell value={p.current_price} />
                </td>
                <td className="px-3 py-2.5 text-right">
                  <Cell value={p.pe} />
                </td>
                <td className="px-3 py-2.5 text-right">
                  <Cell value={p.roce} />
                </td>
                <td className="px-3 py-2.5 text-right">
                  <Cell value={p.roe} />
                </td>
                <td className="px-3 py-2.5 text-right">
                  <Cell value={p.dividend_yield} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
