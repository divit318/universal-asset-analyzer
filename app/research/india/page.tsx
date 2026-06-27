"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { Quote } from "@/lib/types";
import type { ScreenerInCompany, ScreenerInPeer, ScreenerInShareholding } from "@/lib/screener-in";
import { formatCurrency, formatPercent } from "@/lib/format";
import { PeersTable } from "./_components/peers-table";
import { MetricsGrid } from "./_components/metrics-grid";
import { ShareholdingChart } from "./_components/shareholding-chart";
import { AiIndiaPanel } from "./_components/ai-india-panel";

interface DerivedData {
  promoterHolding: number | null;
  fiiHolding: number | null;
  diiHolding: number | null;
  evToEbitda: number | null;
  priceToSales: number | null;
  priceToBook: number | null;
  debtToEquity: number | null;
  interestCoverage: number | null;
  peers: ScreenerInPeer[];
}

interface IndiaResearchData {
  company: ScreenerInCompany;
  quote: Quote | null;
  derived: DerivedData;
}

type Tab = "overview" | "peers" | "shareholding" | "ratios";

export default function IndiaResearchPage() {
  const router = useRouter();
  const [symbol, setSymbol] = useState("");
  const [input, setInput] = useState("");
  const [data, setData] = useState<IndiaResearchData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("overview");

  const load = useCallback(async (sym: string) => {
    const s = sym.trim().toUpperCase().replace(/\.(NS|BO)$/i, "");
    if (!s) return;
    setSymbol(s);
    setLoading(true);
    setError(null);
    setData(null);
    try {
      const res = await fetch(`/api/screener-in?symbol=${encodeURIComponent(s)}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `Not found (${res.status})`);
      setData(json as IndiaResearchData);
      setTab("overview");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }, []);

  // Deep-link: /research/india?symbol=RELIANCE → redirect to /stocks/RELIANCE?market=IN
  useEffect(() => {
    const param = new URLSearchParams(window.location.search).get("symbol");
    if (!param) return;
    const s = param.toUpperCase().replace(/\.(NS|BO)$/i, "");
    router.replace(`/stocks/${encodeURIComponent(s)}?market=IN`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const s = input.trim().toUpperCase().replace(/\.(NS|BO)$/i, "");
    if (!s) return;
    router.push(`/stocks/${encodeURIComponent(s)}?market=IN`);
  }

  const positive = (data?.quote?.changePercent ?? data?.company?.changePercent ?? 0) >= 0;
  const price = data?.quote?.price ?? data?.company?.currentPrice;
  const changePct = data?.quote?.changePercent ?? data?.company?.changePercent;

  const TABS: { id: Tab; label: string }[] = [
    { id: "overview", label: "Key Metrics" },
    { id: "peers", label: `Peer Comparison (${data?.derived.peers.length ?? 0})` },
    { id: "shareholding", label: "Who Owns It" },
    { id: "ratios", label: "10-Year Ratios" },
  ];

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-6 py-12">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Indian Stock Research</h1>
        <p className="text-muted">
          Deep fundamentals via screener.in — P&L, ratios, peer comparison, shareholding, and
          live quotes.
        </p>
      </div>

      <form onSubmit={submit} className="flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value.toUpperCase())}
          placeholder="NSE symbol (e.g. RELIANCE, HDFCBANK, INFY)"
          className="flex-1 rounded-lg border border-border bg-surface px-4 py-2.5 text-sm outline-none placeholder:text-muted focus:border-accent"
        />
        <button
          type="submit"
          disabled={loading}
          className="rounded-lg bg-accent-strong px-5 py-2.5 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {loading ? "Loading…" : "Research"}
        </button>
      </form>

      {error ? (
        <div className="rounded-lg border border-negative/40 bg-negative/10 px-4 py-3 text-sm text-negative">
          {error}
        </div>
      ) : null}

      {data ? (
        <div className="flex flex-col gap-6">
          {/* Company header */}
          <div className="rounded-xl border border-border bg-surface p-5">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-lg font-semibold">{data.company.symbol}</span>
                  {data.company.bseCode ? (
                    <span className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-xs text-muted">
                      BSE {data.company.bseCode}
                    </span>
                  ) : null}
                </div>
                <span className="text-muted">{data.company.name}</span>
              </div>
              <div className="text-right">
                <div className="text-3xl font-semibold">
                  {price != null ? `₹${price.toFixed(2)}` : "—"}
                </div>
                {changePct != null ? (
                  <div className={`font-mono text-sm ${positive ? "text-positive" : "text-negative"}`}>
                    {formatPercent(changePct)}
                  </div>
                ) : null}
              </div>
            </div>
          </div>

          {/* AI panel — always visible, data-grounded */}
          <AiIndiaPanel company={data.company} quote={data.quote} derived={data.derived} />

          {/* Tab nav */}
          <div className="flex gap-1 border-b border-border">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`px-4 py-2 text-sm transition-colors ${
                  tab === t.id
                    ? "border-b-2 border-accent font-medium text-foreground"
                    : "text-muted hover:text-foreground"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* Overview */}
          {tab === "overview" ? (
            <div className="flex flex-col gap-6">
              <MetricsGrid company={data.company} derived={data.derived} />

              {data.company.shareholding.length > 0 ? (
                <section className="flex flex-col gap-3">
                  <h2 className="text-base font-semibold">Shareholding Pattern</h2>
                  <div className="rounded-xl border border-border bg-surface p-5">
                    <ShareholdingChart rows={data.company.shareholding} />
                  </div>
                </section>
              ) : null}
            </div>
          ) : null}

          {/* Peers */}
          {tab === "peers" ? (
            <section className="flex flex-col gap-3">
              <h2 className="text-base font-semibold">Peer Comparison</h2>
              <p className="text-xs text-muted">
                All figures from screener.in. P/E, ROCE, ROE as trailing twelve months.
              </p>
              <PeersTable peers={data.derived.peers} currentSymbol={symbol} />
            </section>
          ) : null}

          {/* Shareholding */}
          {tab === "shareholding" ? (
            <section className="flex flex-col gap-3">
              <h2 className="text-base font-semibold">Shareholding Pattern</h2>
              <div className="rounded-xl border border-border bg-surface p-5">
                {data.company.shareholding.length > 0 ? (
                  <ShareholdingChart rows={data.company.shareholding} />
                ) : (
                  <p className="text-sm text-muted">No shareholding data available.</p>
                )}
              </div>
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: "Promoter", value: data.derived.promoterHolding },
                  { label: "FII", value: data.derived.fiiHolding },
                  { label: "DII", value: data.derived.diiHolding },
                ].map((item) => (
                  <div key={item.label} className="rounded-xl border border-border bg-surface p-4 text-center">
                    <div className="text-xs text-muted">{item.label}</div>
                    <div className="mt-1 font-mono text-lg font-semibold">
                      {item.value != null ? `${item.value.toFixed(1)}%` : "—"}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {/* All ratios from screener.in */}
          {tab === "ratios" ? (
            <section className="flex flex-col gap-3">
              <h2 className="text-base font-semibold">Historical Ratios</h2>
              <div className="flex flex-col gap-4">
                {data.company.ratios.map((r) => (
                  <div key={r.name} className="rounded-xl border border-border bg-surface p-4">
                    <h3 className="mb-3 text-sm font-medium">{r.name}</h3>
                    <div className="flex flex-wrap gap-3">
                      {r.values.map((v, i) => (
                        <div key={i} className="flex flex-col items-center gap-1">
                          {v.period ? (
                            <span className="text-xs text-muted">{v.period}</span>
                          ) : null}
                          <span className="font-mono text-sm">{v.value || "—"}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
                {data.company.ratios.length === 0 ? (
                  <p className="text-sm text-muted">No ratio history available.</p>
                ) : null}
              </div>
            </section>
          ) : null}
        </div>
      ) : null}

      {!data && !loading && !error ? (
        <div className="py-12 text-center text-sm text-muted">
          <p className="mb-4">Try one of these:</p>
          <div className="flex flex-wrap justify-center gap-2">
            {["RELIANCE", "HDFCBANK", "TCS", "INFY", "WIPRO", "SBIN", "BAJFINANCE", "ONGC"].map(
              (s) => (
                <button
                  key={s}
                  onClick={() => {
                    setInput(s);
                    void load(s);
                  }}
                  className="rounded-full border border-border px-3 py-1 text-xs transition-colors hover:border-accent hover:text-accent"
                >
                  {s}
                </button>
              ),
            )}
          </div>
        </div>
      ) : null}
    </main>
  );
}
