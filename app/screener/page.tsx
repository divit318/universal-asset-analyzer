"use client";

import { useState } from "react";
import Link from "next/link";
import type { ScreenerRow } from "@/lib/types";
import { SECTORS } from "@/lib/sp500";
import { formatCurrency, formatMarketCap, formatPercent } from "@/lib/format";

interface Filters {
  sector: string;
  minPrice: string;
  maxPrice: string;
  minChangePercent: string;
  maxChangePercent: string;
  minMarketCap: string; // in billions, for UX
}

const EMPTY: Filters = {
  sector: "",
  minPrice: "",
  maxPrice: "",
  minChangePercent: "",
  maxChangePercent: "",
  minMarketCap: "",
};

export default function ScreenerPage() {
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [rows, setRows] = useState<ScreenerRow[] | null>(null);
  const [meta, setMeta] = useState<{ count: number; scanned: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set<K extends keyof Filters>(key: K, value: string) {
    setFilters((f) => ({ ...f, [key]: value }));
  }

  async function run() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/screener", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sector: filters.sector || null,
          minPrice: filters.minPrice || null,
          maxPrice: filters.maxPrice || null,
          minChangePercent: filters.minChangePercent || null,
          maxChangePercent: filters.maxChangePercent || null,
          // convert billions input -> dollars
          minMarketCap: filters.minMarketCap
            ? Number(filters.minMarketCap) * 1e9
            : null,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Screener failed");
      setRows(json.rows as ScreenerRow[]);
      setMeta({ count: json.count, scanned: json.scanned });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setRows(null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-6 py-12">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Screener</h1>
        <p className="text-muted">
          Filter the S&P 500 universe by sector, price, daily move, and market cap.
        </p>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run();
        }}
        className="grid gap-4 rounded-xl border border-border bg-surface p-6 sm:grid-cols-3"
      >
        <Field label="Sector">
          <select
            value={filters.sector}
            onChange={(e) => set("sector", e.target.value)}
            className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm outline-none focus:border-accent"
          >
            <option value="">All sectors</option>
            {SECTORS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </Field>
        <NumField label="Min price ($)" value={filters.minPrice} onChange={(v) => set("minPrice", v)} />
        <NumField label="Max price ($)" value={filters.maxPrice} onChange={(v) => set("maxPrice", v)} />
        <NumField label="Min change (%)" value={filters.minChangePercent} onChange={(v) => set("minChangePercent", v)} />
        <NumField label="Max change (%)" value={filters.maxChangePercent} onChange={(v) => set("maxChangePercent", v)} />
        <NumField label="Min market cap ($B)" value={filters.minMarketCap} onChange={(v) => set("minMarketCap", v)} />

        <div className="flex items-end gap-2 sm:col-span-3">
          <button
            type="submit"
            disabled={loading}
            className="rounded-lg bg-accent-strong px-5 py-2.5 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {loading ? "Scanning…" : "Run screen"}
          </button>
          <button
            type="button"
            onClick={() => {
              setFilters(EMPTY);
              setRows(null);
              setMeta(null);
            }}
            className="rounded-lg border border-border px-4 py-2.5 text-sm transition-colors hover:bg-surface-2"
          >
            Reset
          </button>
        </div>
      </form>

      {error ? (
        <div className="rounded-lg border border-negative/40 bg-negative/10 px-4 py-3 text-sm text-negative">
          {error}
        </div>
      ) : null}

      {meta ? (
        <p className="text-sm text-muted">
          {meta.count} match{meta.count === 1 ? "" : "es"} of {meta.scanned} scanned
        </p>
      ) : null}

      {rows && rows.length > 0 ? (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-left text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-4 py-3 font-medium">Symbol</th>
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Sector</th>
                <th className="px-4 py-3 text-right font-medium">Price</th>
                <th className="px-4 py-3 text-right font-medium">Change</th>
                <th className="px-4 py-3 text-right font-medium">Mkt cap</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((r) => (
                <tr key={r.symbol} className="bg-surface hover:bg-surface-2">
                  <td className="px-4 py-3">
                    <Link
                      href={`/research?symbol=${r.symbol}`}
                      className="font-mono font-semibold text-accent hover:underline"
                    >
                      {r.symbol}
                    </Link>
                  </td>
                  <td className="max-w-[14rem] truncate px-4 py-3 text-muted">{r.name}</td>
                  <td className="px-4 py-3 text-muted">{r.sector}</td>
                  <td className="px-4 py-3 text-right font-mono">{formatCurrency(r.price)}</td>
                  <td
                    className={`px-4 py-3 text-right font-mono ${r.changePercent >= 0 ? "text-positive" : "text-negative"}`}
                  >
                    {formatPercent(r.changePercent)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono">{formatMarketCap(r.marketCap)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : rows && rows.length === 0 ? (
        <p className="text-sm text-muted">No matches. Try loosening the filters.</p>
      ) : null}
    </main>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs uppercase tracking-wide text-muted">{label}</span>
      {children}
    </label>
  );
}

function NumField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <Field label={label}>
      <input
        type="number"
        step="any"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="—"
        className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm outline-none placeholder:text-muted focus:border-accent"
      />
    </Field>
  );
}
