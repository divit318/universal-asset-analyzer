import { X, Plus, Columns3, Download } from "lucide-react";

/**
 * Universal Screener mockup — static, hand-authored sample data. Filter chips,
 * toolbar, and a six-column results table with AI-sentiment pills (green for
 * positive variants, brass for neutral).
 */
const FILTERS = ["Market Cap > $1B", "P/E < 25", "Revenue Growth > 10%", "AI Sentiment: Positive"];

const ROWS: { ticker: string; company: string; cap: string; pe: string; growth: string; sentiment: string }[] = [
  { ticker: "NVDA", company: "NVIDIA Corporation", cap: "$2.42T", pe: "22.4x", growth: "125.4%", sentiment: "Very Positive" },
  { ticker: "MSFT", company: "Microsoft Corporation", cap: "$3.01T", pe: "28.7x", growth: "15.2%", sentiment: "Positive" },
  { ticker: "AVGO", company: "Broadcom Inc.", cap: "$1.02T", pe: "19.1x", growth: "23.7%", sentiment: "Positive" },
  { ticker: "CRM", company: "Salesforce, Inc.", cap: "$246B", pe: "21.3x", growth: "11.3%", sentiment: "Neutral" },
  { ticker: "AMD", company: "Advanced Micro Devices", cap: "$236B", pe: "37.6x", growth: "18.6%", sentiment: "Positive" },
  { ticker: "NOW", company: "ServiceNow, Inc.", cap: "$168B", pe: "48.2x", growth: "24.1%", sentiment: "Positive" },
  { ticker: "PANW", company: "Palo Alto Networks", cap: "$112B", pe: "44.9x", growth: "16.5%", sentiment: "Neutral" },
  { ticker: "SNPS", company: "Synopsys, Inc.", cap: "$88B", pe: "34.8x", growth: "13.9%", sentiment: "Positive" },
];

export function ScreenerMockup() {
  return (
    <div className="flex h-full flex-col p-4 text-left">
      <p className="text-mk-small font-semibold text-foreground">Universal Screener</p>

      {/* Filter chips + toolbar */}
      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        {FILTERS.map((f) => (
          <span
            key={f}
            className="flex items-center gap-1 rounded-full border border-hairline bg-surface-2 px-2 py-0.5 text-micro text-muted"
          >
            {f}
            <X className="h-2.5 w-2.5 text-muted" strokeWidth={2} />
          </span>
        ))}
        <span className="flex items-center gap-1 rounded-full border border-dashed border-border px-2 py-0.5 text-micro text-muted">
          <Plus className="h-2.5 w-2.5" strokeWidth={2} />
          Add filter
        </span>
        <span className="ml-auto hidden items-center gap-1 text-micro text-muted sm:flex">
          <Columns3 className="h-3 w-3" strokeWidth={1.75} />
          Columns
        </span>
        <span className="hidden items-center gap-1 text-micro text-muted sm:flex">
          <Download className="h-3 w-3" strokeWidth={1.75} />
          Export
        </span>
        <span className="rounded-control bg-brand px-2.5 py-1 text-micro font-semibold text-background">
          Run screener
        </span>
      </div>

      {/* Results table */}
      <div className="mt-3 overflow-hidden rounded-card border border-hairline">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-hairline bg-surface-2/80">
              {["Ticker", "Company", "Market Cap", "P/E TTM", "Rev. Growth YoY", "AI Sentiment"].map((h, i) => (
                <th key={h} className={`px-2.5 py-1 text-micro font-medium text-muted ${i >= 2 && i <= 4 ? "text-right" : ""}`}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ROWS.map((r) => (
              <tr key={r.ticker} className="border-b border-hairline last:border-b-0">
                <td className="px-2.5 py-1 font-mono text-caption font-semibold tabular-nums text-foreground">{r.ticker}</td>
                <td className="px-2.5 py-1 text-caption text-muted">{r.company}</td>
                <td className="px-2.5 py-1 text-right font-mono text-caption tabular-nums text-foreground">{r.cap}</td>
                <td className="px-2.5 py-1 text-right font-mono text-caption tabular-nums text-foreground">{r.pe}</td>
                <td className="px-2.5 py-1 text-right font-mono text-caption tabular-nums text-foreground">{r.growth}</td>
                <td className="px-2.5 py-1">
                  <span
                    className={`rounded-full px-2 py-0.5 text-micro font-medium ${
                      r.sentiment === "Neutral" ? "bg-brand/12 text-brand" : "bg-positive/12 text-positive"
                    }`}
                  >
                    {r.sentiment}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Status footer pins to the frame bottom. */}
      <div className="mt-auto flex items-center justify-between pt-2 font-mono text-micro tabular-nums text-muted">
        <span>Showing 8 of 2,847 matches</span>
        <span>Screened in 0.42s</span>
      </div>
    </div>
  );
}
