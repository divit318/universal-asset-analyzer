"use client";

import { useEffect, useState } from "react";

interface CompareMetricRow {
  metric: string;
  a: string;
  b: string;
  better: "a" | "b" | "tie";
}

interface ComparisonResult {
  model: string;
  symbolA: string;
  symbolB: string;
  sections: {
    overview: string;
    valuation: string;
    quality: string;
    growth: string;
    financialHealth: string;
    momentum: string;
    verdict: string;
  };
  winner: string | null;
  winnerRationale: string;
  metricTable: CompareMetricRow[];
}

const SECTION_LABELS: { key: keyof ComparisonResult["sections"]; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "valuation", label: "Valuation" },
  { key: "quality", label: "Quality" },
  { key: "growth", label: "Growth" },
  { key: "financialHealth", label: "Financial Health" },
  { key: "momentum", label: "Momentum" },
  { key: "verdict", label: "Verdict" },
];

const POPULAR_PAIRS = [
  ["AAPL", "MSFT"],
  ["NVDA", "AMD"],
  ["GOOGL", "META"],
  ["JPM", "BAC"],
  ["TSLA", "F"],
];

export default function ComparePage() {
  const [symbolA, setSymbolA] = useState("");
  const [symbolB, setSymbolB] = useState("");
  const [result, setResult] = useState<ComparisonResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function runCompare(a = symbolA, b = symbolB) {
    const sa = a.trim().toUpperCase();
    const sb = b.trim().toUpperCase();
    if (!sa || !sb) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/compare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbolA: sa, symbolB: sb }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Comparison failed");
      setResult(json as ComparisonResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  // Deep-link: /compare?a=AAPL&b=MSFT
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const pa = params.get("a");
    const pb = params.get("b");
    if (pa && pb) {
      /* eslint-disable react-hooks/set-state-in-effect */
      setSymbolA(pa.toUpperCase());
      setSymbolB(pb.toUpperCase());
      /* eslint-enable react-hooks/set-state-in-effect */
      void runCompare(pa, pb);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-6 py-12">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Compare</h1>
        <p className="text-muted">
          Side-by-side AI analysis of two stocks — valuation, quality, growth, momentum, and a
          verdict grounded entirely in structured data.
        </p>
      </div>

      {/* Input */}
      <form
        onSubmit={(e) => { e.preventDefault(); void runCompare(); }}
        className="flex flex-wrap items-center gap-3"
      >
        <input
          value={symbolA}
          onChange={(e) => setSymbolA(e.target.value.toUpperCase())}
          placeholder="Symbol A (e.g. AAPL)"
          className="w-36 rounded-lg border border-border bg-surface px-4 py-2.5 font-mono text-sm outline-none placeholder:font-sans placeholder:text-muted focus:border-accent"
        />
        <span className="text-muted">vs</span>
        <input
          value={symbolB}
          onChange={(e) => setSymbolB(e.target.value.toUpperCase())}
          placeholder="Symbol B (e.g. MSFT)"
          className="w-36 rounded-lg border border-border bg-surface px-4 py-2.5 font-mono text-sm outline-none placeholder:font-sans placeholder:text-muted focus:border-accent"
        />
        <button
          type="submit"
          disabled={loading || !symbolA.trim() || !symbolB.trim()}
          className="rounded-lg bg-accent-strong px-6 py-2.5 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {loading ? "Comparing…" : "Compare"}
        </button>
      </form>

      {/* Popular pairs */}
      <div className="flex flex-wrap gap-2">
        <span className="text-xs text-muted self-center">Quick pairs:</span>
        {POPULAR_PAIRS.map(([a, b]) => (
          <button
            key={`${a}-${b}`}
            onClick={() => {
              setSymbolA(a);
              setSymbolB(b);
              void runCompare(a, b);
            }}
            disabled={loading}
            className="rounded-full border border-border px-3 py-1 text-xs transition-colors hover:border-accent hover:text-accent disabled:opacity-50"
          >
            {a} vs {b}
          </button>
        ))}
      </div>

      {error ? (
        <div className="rounded-lg border border-negative/40 bg-negative/10 px-4 py-3 text-sm text-negative">
          {error}
        </div>
      ) : null}

      {loading ? (
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-3 text-sm text-muted">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-accent" />
            </span>
            Fetching fundamentals, scores, analyst data, momentum for both stocks…
          </div>
          <div className="h-64 animate-pulse rounded-xl border border-border bg-surface" />
        </div>
      ) : null}

      {result && !loading ? (
        <div className="flex flex-col gap-6">
          {/* Winner banner */}
          {result.winner ? (
            <div className="flex items-center gap-4 rounded-xl border border-accent/30 bg-accent/10 px-5 py-4">
              <span className="text-2xl font-bold text-accent">{result.winner}</span>
              <div>
                <div className="text-sm font-medium text-foreground">Better overall pick</div>
                <div className="text-sm text-muted">{result.winnerRationale}</div>
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-border bg-surface px-5 py-4 text-sm text-muted">
              Too close to call — review the detail below.
            </div>
          )}

          {/* Metric table */}
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full text-sm">
              <thead className="bg-surface-2 text-left text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-4 py-3 font-medium">Metric</th>
                  <th className="px-4 py-3 font-medium">{result.symbolA}</th>
                  <th className="px-4 py-3 font-medium">{result.symbolB}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {result.metricTable.map((row) => (
                  <tr key={row.metric} className="bg-surface">
                    <td className="px-4 py-2.5 text-muted">{row.metric}</td>
                    <td className={`px-4 py-2.5 font-mono ${row.better === "a" ? "font-semibold text-positive" : ""}`}>
                      {row.a}
                      {row.better === "a" ? " ✓" : ""}
                    </td>
                    <td className={`px-4 py-2.5 font-mono ${row.better === "b" ? "font-semibold text-positive" : ""}`}>
                      {row.b}
                      {row.better === "b" ? " ✓" : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* AI sections */}
          <div className="flex flex-col gap-4">
            {SECTION_LABELS.map(({ key, label }) =>
              result.sections[key] ? (
                <div key={key} className="flex flex-col gap-1.5 rounded-xl border border-border bg-surface p-5">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</h3>
                  <p className="text-sm leading-6">{result.sections[key]}</p>
                </div>
              ) : null,
            )}
          </div>

          <p className="font-mono text-xs text-muted">model: {result.model}</p>
        </div>
      ) : null}

      {!result && !loading && !error ? (
        <div className="py-12 text-center text-sm text-muted">
          Enter two symbols to get a structured head-to-head comparison.
        </div>
      ) : null}
    </main>
  );
}
