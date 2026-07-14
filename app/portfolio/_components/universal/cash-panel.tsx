"use client";

import { useState } from "react";
import { Card, Button, Input, Field, Badge } from "@/app/_components/ui";
import { formatCurrency } from "@/lib/format";
import type { CashAllocationPlan } from "@/lib/portfolio/engines/cash";

/**
 * "How should I allocate new cash?" — across the whole universe, not just what you
 * already own.
 *
 * The engine this replaces could only route new cash into EXISTING positions. If your
 * portfolio was 100% tech stocks, its advice on a $50k inflow was: buy more tech
 * stocks. "Add a Treasury ETF" and "hold it in cash" weren't opinions it disagreed
 * with — they were sentences it could not form.
 *
 * The plan is built by greedy marginal simulation: each tranche goes wherever the real
 * engines say it does the most good, so diversified advice falls out of diminishing
 * returns rather than being imposed by a rule.
 */
export function CashPanel() {
  const [amount, setAmount] = useState("");
  const [plan, setPlan] = useState<CashAllocationPlan | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function run(e: React.FormEvent) {
    e.preventDefault();
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) {
      setErr("Enter a positive amount");
      return;
    }

    setLoading(true);
    setErr(null);
    try {
      const res = await fetch("/api/portfolio/allocate-cash", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: value }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to allocate");
      setPlan(json as CashAllocationPlan);
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Failed to allocate");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="flex flex-col gap-4 p-5">
      <div>
        <h3 className="text-sm font-semibold text-foreground">Allocate new cash</h3>
        <p className="mt-1 text-xs leading-relaxed text-muted">
          Considers every asset class — including holding the cash — and picks whatever
          measurably improves the portfolio most.
        </p>
      </div>

      <form onSubmit={run} className="flex items-end gap-2">
        <div className="flex-1"><Field label="Amount">
          <Input
            type="number" step="any" min="0"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="50000"
          />
        </Field></div>
        <Button type="submit" variant="primary" disabled={loading}>
          {loading ? "Simulating…" : "Allocate"}
        </Button>
      </form>

      {err && <p className="text-xs text-negative">{err}</p>}

      {plan && (
        <div className="flex flex-col gap-3 border-t border-border pt-4">
          <p className="text-xs leading-relaxed text-muted">{plan.summary}</p>

          {plan.items.length > 0 && (
            <ul className="flex flex-col gap-2">
              {plan.items.map((item) => (
                <li
                  key={item.symbol ?? item.name}
                  className="flex flex-col gap-1.5 rounded-lg border border-border bg-surface/40 p-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 flex-col">
                      <span className="flex items-center gap-1.5">
                        {item.symbol && (
                          <span className="font-mono text-sm font-semibold text-foreground">
                            {item.symbol}
                          </span>
                        )}
                        <Badge variant="neutral">{item.assetClass}</Badge>
                      </span>
                      <span className="truncate text-[11px] text-muted">{item.name}</span>
                    </div>
                    <div className="flex shrink-0 flex-col items-end">
                      <span className="font-mono text-sm font-bold tabular-nums text-foreground">
                        {formatCurrency(item.dollarAmount)}
                      </span>
                      <span className="font-mono text-[10px] tabular-nums text-muted">
                        {item.shareCount != null ? `${item.shareCount} shares · ` : ""}
                        → {item.resultingWeight.toFixed(1)}%
                      </span>
                    </div>
                  </div>
                  <p className="text-[11px] leading-relaxed text-muted">{item.reason}</p>
                </li>
              ))}
            </ul>
          )}

          {/* Holding cash is a legitimate outcome, and it is rendered as one rather
              than as a failure to find something to buy. */}
          {plan.heldAsCash > 0 && (
            <div className="flex items-center justify-between rounded-lg border border-border bg-surface/40 p-3">
              <div className="flex flex-col">
                <span className="text-xs font-semibold text-foreground">Hold as cash</span>
                <span className="text-[11px] text-muted">
                  Nothing else improved the portfolio more than keeping the optionality.
                </span>
              </div>
              <span className="font-mono text-sm font-bold tabular-nums text-foreground">
                {formatCurrency(plan.heldAsCash)}
              </span>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
