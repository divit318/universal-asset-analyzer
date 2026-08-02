"use client";

/**
 * IC Report — data tab (Phase 1.6 provenance surface + Phase 0.4 debug).
 *
 * Every figure the report renders traces to a source here: value, unit,
 * period, provider, field and retrieval timestamp. The debug drawer
 * (development builds only) adds stage latencies and the raw canonical
 * object.
 */

import { useState } from "react";
import type { ICReport } from "@/lib/ic-report";
import type { Datum } from "@/lib/ic/canonical";
import { fmtMoney, fmtMoneyCompact, fmtPercent, fmtMultiple, fmtDateTime, fmtFiscalPeriod } from "@/lib/ic/format";
import { Card } from "./shared";

function datumValue(d: Datum, currency: string): string {
  switch (d.unit) {
    case "currency": return fmtMoneyCompact(d.value, d.currency ?? currency);
    case "perShare": return fmtMoney(d.value, d.currency ?? currency);
    case "fraction": return fmtPercent(d.value);
    case "ratio": return fmtMultiple(d.value, 2);
    case "shares": return fmtMoneyCompact(d.value, null).replace(/^\$/, "");
  }
}

const CONCEPT_LABELS: [keyof ICReport["facts"], string][] = [
  ["spot", "Spot price"],
  ["marketCap", "Market cap"],
  ["sharesOutstanding", "Shares outstanding"],
  ["enterpriseValue", "Enterprise value"],
  ["totalDebt", "Total debt"],
  ["totalCash", "Total cash"],
  ["netDebt", "Net debt"],
  ["freeCashFlowTtm", "Free cash flow (TTM)"],
  ["freeCashFlowFy", "Free cash flow (last FY)"],
  ["ebitdaTtm", "EBITDA (TTM)"],
  ["trailingPE", "Trailing P/E"],
  ["forwardPE", "Forward P/E"],
  ["pegRatio", "PEG"],
  ["priceToBook", "P/B"],
  ["evToEbitda", "EV/EBITDA"],
  ["priceToSales", "P/S"],
  ["dividendYield", "Dividend yield"],
  ["returnOnEquity", "ROE"],
  ["returnOnAssets", "ROA"],
  ["grossMargin", "Gross margin"],
  ["operatingMargin", "Operating margin"],
  ["netMargin", "Net margin"],
  ["revenueGrowthYoY", "Revenue growth YoY"],
  ["earningsGrowthYoY", "Earnings growth YoY"],
  ["debtToEquity", "Debt/equity"],
  ["currentRatio", "Current ratio"],
];

export function DataTab({ report }: { report: ICReport }) {
  const facts = report.facts;
  const [debugOpen, setDebugOpen] = useState(false);
  const isDev = process.env.NODE_ENV !== "production";

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <h3 className="mb-1 text-sm font-semibold">Canonical data with provenance</h3>
        <p className="mb-3 text-xs text-muted">
          One value per concept. Every number the report renders traces to a row here; missing rows are listed as gaps with reasons, never rendered as zero.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-muted">
              <tr>
                <th scope="col" className="pb-2 text-left font-medium">Concept</th>
                <th scope="col" className="pb-2 text-right font-medium">Value</th>
                <th scope="col" className="pb-2 pl-4 text-left font-medium">Period</th>
                <th scope="col" className="pb-2 pl-4 text-left font-medium">Source</th>
                <th scope="col" className="pb-2 pl-4 text-left font-medium">Retrieved</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {CONCEPT_LABELS.map(([key, label]) => {
                const d = facts[key] as Datum | null;
                return (
                  <tr key={key}>
                    <td className="py-1.5 font-medium">{label}</td>
                    <td className="py-1.5 text-right font-mono">
                      {d ? datumValue(d, facts.currency) : <span className="text-muted">not available</span>}
                    </td>
                    <td className="py-1.5 pl-4 text-muted">{d?.periodLabel ?? "—"}</td>
                    <td className="py-1.5 pl-4 font-mono text-muted">
                      {d ? `${d.source.provider}: ${d.source.field}${d.source.ref ? ` (${d.source.ref})` : ""}` : "—"}
                    </td>
                    <td className="py-1.5 pl-4 text-muted">{d ? fmtDateTime(d.asOf, report.market) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {facts.statements && (
        <Card>
          <h3 className="mb-1 text-sm font-semibold">Annual statement series</h3>
          <p className="mb-3 text-xs text-muted">
            Provider: {facts.statements.provider} · currency {facts.statements.currency} · fiscal labels carry their period end month where the year does not end in December.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-muted">
                <tr>
                  <th scope="col" className="pb-2 text-left font-medium">Series</th>
                  {facts.statements.revenue.map((p) => (
                    <th key={p.fy} scope="col" className="pb-2 text-right font-medium">{fmtFiscalPeriod(p)}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border font-mono">
                {([
                  ["Revenue", facts.statements.revenue, true],
                  ["Net income", facts.statements.netIncome, true],
                  ["Free cash flow", facts.statements.freeCashFlow, true],
                  ["Operating margin", facts.statements.operatingMargin, false],
                ] as const).map(([label, series, money]) => (
                  <tr key={label}>
                    <td className="py-1.5 font-sans font-medium">{label}</td>
                    {facts.statements!.revenue.map((rev) => {
                      const p = series.find((x) => x.fy === rev.fy);
                      return (
                        <td key={rev.fy} className="py-1.5 text-right">
                          {p ? (money ? fmtMoneyCompact(p.value, facts.statements!.currency) : fmtPercent(p.value)) : "—"}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {isDev && (
        <Card>
          <button
            className="flex min-h-[36px] w-full items-center justify-between text-left text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
            onClick={() => setDebugOpen((o) => !o)}
            aria-expanded={debugOpen}
          >
            <span>Debug (development builds only)</span>
            <span className="text-xs text-brand">{debugOpen ? "hide" : "show"}</span>
          </button>
          {debugOpen && (
            <div className="mt-3 space-y-3 text-xs">
              <div>
                <p className="mb-1 font-medium">Stage timings</p>
                <ul className="font-mono text-muted">
                  {report.timings.map((t) => (
                    <li key={t.stage}>{t.stage}: {t.ms}ms</li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="mb-1 font-medium">Model and prompt versions</p>
                <p className="font-mono text-muted">
                  model={report.model} · {Object.entries(report.promptVersions).map(([k, v]) => `${k}=${v}`).join(" · ")}
                </p>
              </div>
              <div>
                <p className="mb-1 font-medium">Raw canonical facts</p>
                <pre className="max-h-80 overflow-auto rounded-lg bg-surface-2 p-3 font-mono text-label leading-4 text-muted">
                  {JSON.stringify(facts, null, 2)}
                </pre>
              </div>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
