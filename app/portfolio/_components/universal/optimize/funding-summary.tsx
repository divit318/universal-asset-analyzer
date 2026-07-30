import { formatCurrency } from "@/lib/format";
import { MATERIAL_WEIGHT_DELTA_PCT } from "@/lib/portfolio/policy";
import type { PlanFundingDisclosure } from "@/lib/portfolio/engines/optimize";

/**
 * Where the money for the whole rebalancing plan comes from.
 *
 * A trade list whose buys and sells don't tie out is indistinguishable, by eye,
 * from a trade list with a sizing bug — and it takes sixteen rows of mental
 * arithmetic to even notice. On a real $9.2M book under Maximize Sharpe the listed
 * trades bought $1.95M and sold $1.71M, and the $242k difference was four sub-1pp
 * trims (filtered out of the list) plus the cash row (never listed, because "sell
 * cash" IS the other trades). Both are legitimate; neither was stated anywhere, so
 * the only available reading was "this plan is $242k short".
 *
 * So the plan states its own funding, unconditionally — including when it balances,
 * because "fully self-funded" is exactly the fact a reader cannot otherwise verify.
 */
export function FundingSummary({
  funding,
  baseCurrency,
}: {
  funding: PlanFundingDisclosure;
  baseCurrency: string;
}) {
  const money = (v: number) => formatCurrency(v, baseCurrency);
  const draws = funding.netCash > 0;

  const tone = funding.shortfall > 0
    ? "border-negative/30 bg-negative/[0.05]"
    : draws
      ? "border-border bg-surface/40"
      : "border-positive/25 bg-positive/[0.04]";

  const headline = funding.shortfall > 0
    ? `Not fully funded — needs ${money(funding.shortfall)} more`
    : draws
      ? `Net cash required: ${money(funding.netCash)}`
      : funding.netCash < 0
        ? `Fully self-funded ✓ — releases ${money(-funding.netCash)} to cash`
        : "Fully self-funded ✓";

  const headlineTone = funding.shortfall > 0
    ? "text-negative"
    : draws ? "text-foreground" : "text-positive";

  return (
    <div className={`flex flex-col gap-1.5 rounded-lg border p-3 ${tone}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span className={`text-xs font-semibold ${headlineTone}`}>{headline}</span>
        <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-[11px]">
          <span>
            <span className="text-muted/70">Buys </span>
            <span className="font-mono font-semibold tabular-nums text-positive">{money(funding.buys)}</span>
          </span>
          <span className="text-muted/40" aria-hidden>−</span>
          <span>
            <span className="text-muted/70">Sells </span>
            <span className="font-mono font-semibold tabular-nums text-negative">{money(funding.sells)}</span>
          </span>
          <span className="text-muted/40" aria-hidden>=</span>
          <span>
            <span className="font-mono font-semibold tabular-nums text-foreground">
              {funding.netCash > 0 ? "+" : ""}{money(funding.netCash)}
            </span>
          </span>
        </span>
      </div>

      <p className="text-[11px] leading-relaxed text-muted">
        {draws ? (
          <>
            Drawn from the {money(funding.cashAvailable)} cash balance, leaving{" "}
            <span className="font-mono tabular-nums text-foreground">{money(funding.cashAfter)}</span>.{" "}
          </>
        ) : funding.netCash < 0 ? (
          <>
            The sells cover every buy; the {money(-funding.netCash)} left over takes the cash balance
            to <span className="font-mono tabular-nums text-foreground">{money(funding.cashAfter)}</span>.{" "}
          </>
        ) : (
          <>The sells cover the buys exactly; the cash balance is unchanged. </>
        )}
        {/* Why the two columns don't tie out. Never left implicit: that difference
            is the whole reason this panel exists. */}
        {funding.netCash !== 0 && (
          <>
            Buys − Sells is not zero because the cash target is settled against the balance rather
            than listed as a trade
            {funding.unlistedTrades > 0 && (
              <>
                , as {funding.unlistedTrades === 1 ? "is" : "are"} {funding.unlistedTrades} further
                target change{funding.unlistedTrades === 1 ? "" : "s"} under the{" "}
                {MATERIAL_WEIGHT_DELTA_PCT}pp materiality threshold
              </>
            )}
            .
          </>
        )}
      </p>
    </div>
  );
}
