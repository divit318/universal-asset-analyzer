"use client";

import { useCallback, useRef, useState } from "react";
import type { FundamentalsData, PeerComparison, Quote, HistoryPoint, Filing } from "@/lib/types";
import type { ScreenerInCompany, ScreenerInPeer } from "@/lib/screener-in";

export type Market = "US" | "IN";

export interface StockQuoteData {
  quote: Quote;
  history: HistoryPoint[];
  filings: Filing[];
  edgarError: string | null;
}

export interface IndiaStockData {
  company: ScreenerInCompany;
  derived: {
    promoterHolding: number | null;
    fiiHolding: number | null;
    diiHolding: number | null;
    evToEbitda: number | null;
    priceToSales: number | null;
    priceToBook: number | null;
    debtToEquity: number | null;
    interestCoverage: number | null;
    peers: ScreenerInPeer[];
  };
}

export type StockLoadState = "idle" | "loading" | "ready" | "error";

export interface UseStockDataReturn {
  // Shared
  symbol: string;
  market: Market;
  state: StockLoadState;
  error: string | null;

  // US data
  quoteData: StockQuoteData | null;
  fundamentals: FundamentalsData | null;
  peers: PeerComparison | null;
  fundamentalsLoading: boolean;

  // India data
  indiaData: IndiaStockData | null;

  // Actions
  load: (symbol: string, market?: Market) => void;
  reset: () => void;
}

/** Detect market from symbol suffix. */
export function detectMarket(symbol: string): Market {
  return /\.(NS|BO)$/i.test(symbol) ? "IN" : "US";
}

export function useStockData(): UseStockDataReturn {
  const [symbol, setSymbol] = useState("");
  const [market, setMarket] = useState<Market>("US");
  const [state, setState] = useState<StockLoadState>("idle");
  const [error, setError] = useState<string | null>(null);

  // US
  const [quoteData, setQuoteData] = useState<StockQuoteData | null>(null);
  const [fundamentals, setFundamentals] = useState<FundamentalsData | null>(null);
  const [peers, setPeers] = useState<PeerComparison | null>(null);
  const [fundamentalsLoading, setFundamentalsLoading] = useState(false);

  // India
  const [indiaData, setIndiaData] = useState<IndiaStockData | null>(null);

  // Track current load to cancel stale requests
  const loadIdRef = useRef(0);

  const loadUS = useCallback(async (sym: string, id: number) => {
    try {
      const res = await fetch(`/api/research?symbol=${encodeURIComponent(sym)}`);
      const json = await res.json();
      if (loadIdRef.current !== id) return;
      if (!res.ok) throw new Error(json.error ?? `Lookup failed (${res.status})`);
      const { quote, history, filings, edgarError } = json as {
        quote: Quote;
        history: HistoryPoint[];
        filings: Filing[];
        edgarError: string | null;
      };
      setQuoteData({ quote, history, filings, edgarError });
      setState("ready");
      setError(null);
    } catch (err) {
      if (loadIdRef.current !== id) return;
      setError(err instanceof Error ? err.message : "Something went wrong");
      setState("error");
    }
  }, []);

  const loadUSFundamentals = useCallback(async (sym: string, id: number) => {
    setFundamentalsLoading(true);
    setFundamentals(null);
    setPeers(null);

    const [fundsRes, peersRes] = await Promise.allSettled([
      fetch(`/api/fundamentals?symbol=${encodeURIComponent(sym)}`),
      fetch(`/api/peers?symbol=${encodeURIComponent(sym)}`),
    ]);

    if (loadIdRef.current !== id) return;

    if (fundsRes.status === "fulfilled" && fundsRes.value.ok) {
      const data = await fundsRes.value.json() as FundamentalsData;
      if (loadIdRef.current === id) setFundamentals(data);
    }
    if (peersRes.status === "fulfilled" && peersRes.value.ok) {
      const data = await peersRes.value.json() as PeerComparison;
      if (loadIdRef.current === id) setPeers(data);
    }
    if (loadIdRef.current === id) setFundamentalsLoading(false);
  }, []);

  const loadIndia = useCallback(async (sym: string, id: number) => {
    try {
      const clean = sym.replace(/\.(NS|BO)$/i, "").toUpperCase();
      const res = await fetch(`/api/screener-in?symbol=${encodeURIComponent(clean)}`);
      const json = await res.json();
      if (loadIdRef.current !== id) return;
      if (!res.ok) throw new Error(json.error ?? `Not found (${res.status})`);
      setIndiaData(json as IndiaStockData);
      setState("ready");
      setError(null);
    } catch (err) {
      if (loadIdRef.current !== id) return;
      setError(err instanceof Error ? err.message : "Something went wrong");
      setState("error");
    }
  }, []);

  const load = useCallback((rawSymbol: string, explicitMarket?: Market) => {
    const sym = rawSymbol.trim().toUpperCase();
    if (!sym) return;

    const mkt = explicitMarket ?? detectMarket(sym);
    const id = ++loadIdRef.current;

    setSymbol(sym);
    setMarket(mkt);
    setState("loading");
    setError(null);
    setQuoteData(null);
    setFundamentals(null);
    setPeers(null);
    setIndiaData(null);
    setFundamentalsLoading(false);

    if (mkt === "IN") {
      void loadIndia(sym, id);
    } else {
      void loadUS(sym, id);
      void loadUSFundamentals(sym, id);
    }
  }, [loadUS, loadUSFundamentals, loadIndia]);

  const reset = useCallback(() => {
    loadIdRef.current++;
    setSymbol("");
    setMarket("US");
    setState("idle");
    setError(null);
    setQuoteData(null);
    setFundamentals(null);
    setPeers(null);
    setIndiaData(null);
    setFundamentalsLoading(false);
  }, []);

  return {
    symbol,
    market,
    state,
    error,
    quoteData,
    fundamentals,
    peers,
    fundamentalsLoading,
    indiaData,
    load,
    reset,
  };
}
