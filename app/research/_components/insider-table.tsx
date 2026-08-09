import type { InsiderActivity, InsiderTxType } from "@/lib/types";
import { formatCompact, formatDate } from "@/lib/format";

const TYPE_STYLE: Record<InsiderTxType, string> = {
  buy: "text-positive",
  sell: "text-negative",
  other: "text-muted",
};

export function InsiderTable({ insider }: { insider: InsiderActivity }) {
  const net = insider.netValue;
  return (
    // Card container matches OwnershipCard's, so the two sections' left edges
    // align on the Ownership tab.
    <section className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-medium">Insider activity</h3>
          <p className="text-xs text-muted">Open-market buys and sells; awards, grants and exercises are counted as neither</p>
        </div>
        {/* Header totals are computed by lib/fundamentals.ts mapInsider() over
            EXACTLY the transactions rendered below (asserted in tests). */}
        <span className="text-xs text-muted">
          {insider.buyCount} buys · {insider.sellCount} sells · net{" "}
          <span className={net >= 0 ? "text-positive" : "text-negative"}>
            {net >= 0 ? "+" : "−"}${formatCompact(Math.abs(net))}
          </span>
        </span>
      </div>

      {insider.transactions.length === 0 ? (
        <p className="text-sm text-muted">No recent insider transactions reported.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-left text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-4 py-2.5 font-medium">Insider</th>
                <th className="px-4 py-2.5 font-medium">Type</th>
                <th className="px-4 py-2.5 text-right font-medium">Shares</th>
                <th className="px-4 py-2.5 text-right font-medium">Value</th>
                <th className="px-4 py-2.5 text-right font-medium">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {insider.transactions.map((t, i) => (
                <tr key={`${t.name}-${t.date}-${i}`} className="bg-surface">
                  <td className="max-w-[12rem] truncate px-4 py-2.5">{t.name}</td>
                  <td className={`px-4 py-2.5 capitalize ${TYPE_STYLE[t.type]}`}>{t.type}</td>
                  <td className="px-4 py-2.5 text-right font-mono">
                    {t.shares != null ? formatCompact(t.shares) : "—"}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono">
                    {t.value ? `$${formatCompact(t.value)}` : "—"}
                  </td>
                  <td className="px-4 py-2.5 text-right text-muted">{formatDate(t.date)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
