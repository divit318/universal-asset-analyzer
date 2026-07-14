"use client";

/**
 * /stocks/[symbol] was an earlier, thinner parallel implementation of equity
 * research (basic tabs, no Copilot, no verdict/portfolio-fit). It has been
 * superseded by the unified Research Hub and now redirects there, preserving
 * deep-link compatibility for the Watchlist/Engine/Thematic/Scanner pages
 * that still link to it:
 *   /stocks/AAPL  →  /research?symbol=AAPL
 */

import { Suspense, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";

function StocksRedirect() {
  const router = useRouter();
  const params = useParams();

  useEffect(() => {
    const raw = params.symbol;
    const symbol = decodeURIComponent(Array.isArray(raw) ? raw[0] : raw ?? "").toUpperCase();
    router.replace(symbol ? `/research?symbol=${encodeURIComponent(symbol)}` : "/research");
  }, [router, params]);

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col items-center justify-center gap-3 px-6 py-20">
      <p className="text-sm text-muted">Redirecting to Research Hub…</p>
    </div>
  );
}

export default function StockPage() {
  return (
    <Suspense>
      <StocksRedirect />
    </Suspense>
  );
}
