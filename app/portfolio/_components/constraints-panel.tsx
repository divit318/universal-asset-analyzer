"use client";

import { useState } from "react";
import { usePortfolio } from "@/lib/portfolio-context";
import type { PortfolioConstraints } from "@/lib/portfolio-analytics";
import { DEFAULT_CONSTRAINTS } from "@/lib/portfolio-analytics";

function SliderRow({
  label,
  description,
  value,
  min,
  max,
  step = 1,
  unit = "%",
  onChange,
}: {
  label: string;
  description: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-medium">{label}</p>
          <p className="text-[11px] text-muted">{description}</p>
        </div>
        <span className="font-mono text-sm font-bold text-accent">{value}{unit}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-accent h-1.5 rounded-full"
      />
      <div className="flex justify-between text-[10px] text-muted/60">
        <span>{min}{unit}</span>
        <span>{max}{unit}</span>
      </div>
    </div>
  );
}

export function ConstraintsPanel() {
  const { constraints, setConstraints } = usePortfolio();
  const [local, setLocal] = useState<PortfolioConstraints>({ ...constraints });
  const [excludedInput, setExcludedInput] = useState("");
  const [saved, setSaved] = useState(false);

  function update<K extends keyof PortfolioConstraints>(key: K, value: PortfolioConstraints[K]) {
    setLocal((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
  }

  function addExcluded() {
    const sym = excludedInput.trim().toUpperCase();
    if (!sym || local.excludedSymbols.includes(sym)) { setExcludedInput(""); return; }
    update("excludedSymbols", [...local.excludedSymbols, sym]);
    setExcludedInput("");
  }

  function removeExcluded(sym: string) {
    update("excludedSymbols", local.excludedSymbols.filter((s) => s !== sym));
  }

  function save() {
    setConstraints(local);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  function reset() {
    setLocal({ ...DEFAULT_CONSTRAINTS });
    setSaved(false);
  }

  return (
    <div className="rounded-xl border border-border bg-surface p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <p className="text-sm font-semibold">Portfolio Constraints</p>
          <p className="text-xs text-muted mt-0.5">Define rules that govern AI recommendations and optimization.</p>
        </div>
        <button
          onClick={reset}
          className="text-xs text-muted hover:text-foreground transition-colors"
        >
          Reset defaults
        </button>
      </div>

      <div className="flex flex-col gap-5">
        <SliderRow
          label="Max Position Size"
          description="Maximum % allocation for any single stock"
          value={local.maxPositionPct}
          min={5}
          max={50}
          step={5}
          onChange={(v) => update("maxPositionPct", v)}
        />

        <SliderRow
          label="Max Sector Exposure"
          description="Maximum % allocation across a single sector"
          value={local.maxSectorPct}
          min={10}
          max={80}
          step={5}
          onChange={(v) => update("maxSectorPct", v)}
        />

        <SliderRow
          label="Minimum Cash Reserve"
          description="Minimum % of portfolio to keep as cash"
          value={local.minCashPct}
          min={0}
          max={20}
          step={1}
          onChange={(v) => update("minCashPct", v)}
        />

        {/* Market cap filter */}
        <div>
          <p className="text-xs font-medium mb-1">Market Cap Filter</p>
          <p className="text-[11px] text-muted mb-2">Only recommend stocks of this market cap size</p>
          <div className="flex gap-2 flex-wrap">
            {(["any", "large", "mid", "small"] as const).map((cap) => (
              <button
                key={cap}
                onClick={() => update("marketCapFilter", cap)}
                className={`rounded-lg border px-3 py-1.5 text-xs capitalize transition-colors ${
                  local.marketCapFilter === cap
                    ? "border-accent/50 bg-accent/10 text-accent font-medium"
                    : "border-border text-muted hover:text-foreground"
                }`}
              >
                {cap === "any" ? "Any size" : `${cap.charAt(0).toUpperCase() + cap.slice(1)}-cap`}
              </button>
            ))}
          </div>
        </div>

        {/* Dividend requirement */}
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-medium">Require Dividend</p>
            <p className="text-[11px] text-muted">Only recommend stocks that pay dividends</p>
          </div>
          <button
            onClick={() => update("requireDividend", !local.requireDividend)}
            className={`relative h-6 w-11 rounded-full transition-colors ${
              local.requireDividend ? "bg-accent" : "bg-surface-2 border border-border"
            }`}
          >
            <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-background shadow transition-transform ${
              local.requireDividend ? "translate-x-5" : "translate-x-0.5"
            }`} />
          </button>
        </div>

        {/* Excluded symbols */}
        <div>
          <p className="text-xs font-medium mb-1">Never Recommend / Sell</p>
          <p className="text-[11px] text-muted mb-2">Stocks excluded from all AI recommendations and optimizations</p>
          <div className="flex gap-2 mb-2">
            <input
              value={excludedInput}
              onChange={(e) => setExcludedInput(e.target.value.toUpperCase())}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addExcluded(); } }}
              placeholder="AAPL"
              className="flex-1 rounded-lg border border-border bg-surface-2 px-3 py-1.5 font-mono text-xs outline-none focus:border-accent placeholder:text-muted"
            />
            <button
              onClick={addExcluded}
              disabled={!excludedInput.trim()}
              className="rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-surface-2 disabled:opacity-40 transition-colors"
            >
              Add
            </button>
          </div>
          {local.excludedSymbols.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {local.excludedSymbols.map((sym) => (
                <span
                  key={sym}
                  className="flex items-center gap-1 rounded border border-border bg-surface-2 px-2 py-0.5 font-mono text-xs"
                >
                  {sym}
                  <button
                    onClick={() => removeExcluded(sym)}
                    className="text-muted hover:text-negative transition-colors ml-0.5"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Save button */}
        <div className="flex gap-2 pt-2 border-t border-border/50">
          <button
            onClick={save}
            className="flex-1 rounded-lg bg-accent-strong py-2 text-sm font-medium text-background hover:opacity-90 transition-opacity"
          >
            {saved ? "✓ Saved" : "Save Constraints"}
          </button>
          <button
            onClick={() => setLocal({ ...constraints })}
            className="rounded-lg border border-border px-4 py-2 text-sm text-muted hover:bg-surface-2 transition-colors"
          >
            Discard
          </button>
        </div>
      </div>
    </div>
  );
}
