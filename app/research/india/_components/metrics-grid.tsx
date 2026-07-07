"use client";

function MetricCell({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string | number | null | undefined;
  highlight?: "positive" | "negative" | "neutral";
}) {
  const displayValue = value == null || value === "" ? "—" : String(value);
  const cls =
    highlight === "positive"
      ? "text-positive"
      : highlight === "negative"
        ? "text-negative"
        : "text-foreground";

  return (
    <div className="flex flex-col gap-1 bg-surface p-4">
      <dt className="text-xs uppercase tracking-wide text-muted">{label}</dt>
      <dd className={`font-mono text-sm font-medium ${cls}`}>{displayValue}</dd>
    </div>
  );
}

function pct(v: number | null | undefined): string {
  if (v == null) return "—";
  return `${v.toFixed(1)}%`;
}

function ratio(v: number | null | undefined, suffix = "x"): string {
  if (v == null) return "—";
  return `${v.toFixed(1)}${suffix}`;
}

interface Derived {
  promoterHolding: number | null;
  fiiHolding: number | null;
  diiHolding: number | null;
  evToEbitda: number | null;
  priceToSales: number | null;
  priceToBook: number | null;
  debtToEquity: number | null;
  interestCoverage: number | null;
}

interface IndianCompanyMetrics {
  pe: number | null;
  bookValue: number | null;
  dividendYield: number | null;
  roce: number | null;
  roe: number | null;
  debt: number | null;
  marketCap: number | null;
  high52w: number | null;
  low52w: number | null;
}

export function MetricsGrid({
  company,
  derived,
}: {
  company: IndianCompanyMetrics;
  derived: Derived;
}) {
  return (
    <dl className="grid gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-3 lg:grid-cols-4">
      <MetricCell label="P/E Ratio" value={ratio(company.pe)} />
      <MetricCell label="EV / EBITDA" value={ratio(derived.evToEbitda)} />
      <MetricCell label="Price / Book" value={ratio(derived.priceToBook)} />
      <MetricCell label="Price / Sales" value={ratio(derived.priceToSales)} />

      <MetricCell
        label="ROCE"
        value={pct(company.roce)}
        highlight={company.roce != null ? (company.roce >= 15 ? "positive" : company.roce < 10 ? "negative" : "neutral") : undefined}
      />
      <MetricCell
        label="ROE"
        value={pct(company.roe)}
        highlight={company.roe != null ? (company.roe >= 15 ? "positive" : company.roe < 10 ? "negative" : "neutral") : undefined}
      />
      <MetricCell label="Dividend Yield" value={pct(company.dividendYield)} />
      <MetricCell label="Book Value / Share" value={company.bookValue != null ? `₹${company.bookValue.toFixed(0)}` : null} />

      <MetricCell
        label="Debt to Equity"
        value={ratio(derived.debtToEquity)}
        highlight={derived.debtToEquity != null ? (derived.debtToEquity > 1 ? "negative" : "positive") : undefined}
      />
      <MetricCell label="Interest Coverage" value={ratio(derived.interestCoverage)} />
      <MetricCell label="Debt (Cr)" value={company.debt != null ? `₹${company.debt.toFixed(0)} Cr` : null} />
      <MetricCell label="Market Cap" value={company.marketCap != null ? `₹${company.marketCap.toFixed(0)} Cr` : null} />

      <MetricCell label="Promoter Holding" value={pct(derived.promoterHolding)} />
      <MetricCell label="FII Holding" value={pct(derived.fiiHolding)} />
      <MetricCell label="DII Holding" value={pct(derived.diiHolding)} />

      <MetricCell label="52W High" value={company.high52w != null ? `₹${company.high52w.toFixed(0)}` : null} />
      <MetricCell label="52W Low" value={company.low52w != null ? `₹${company.low52w.toFixed(0)}` : null} />
    </dl>
  );
}
