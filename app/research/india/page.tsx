"use client";

/**
 * India Research has been merged into the universal /research page.
 *
 * This route now redirects there, preserving deep-link compatibility:
 *   /research/india?symbol=RELIANCE  →  /research?symbol=RELIANCE.NS
 *   /research/india                  →  /research
 *
 * The unified research page auto-detects NSE/BSE stocks and renders
 * India-specific modules (InvestmentSnapshot, OwnershipTimeline, RankedPeers,
 * RatioSparklines, AiSectionInsight) when currency === INR or exchange
 * contains NSE/BSE.
 */

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function IndiaResearchRedirect() {
  const router = useRouter();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sym = params.get("symbol");
    if (sym) {
      // Keep an explicit exchange suffix. This used to strip .NS/.BO and then
      // unconditionally re-append .NS, silently rewriting every BSE deep link
      // (RELIANCE.BO → RELIANCE.NS) to a different listing. Only a bare symbol
      // gets .NS added, so the Yahoo quote resolves to India rather than to a
      // same-named US ticker.
      const upper = sym.trim().toUpperCase();
      const target = /\.(NS|BO)$/.test(upper) ? upper : `${upper}.NS`;
      router.replace(`/research?symbol=${encodeURIComponent(target)}`);
    } else {
      router.replace("/research");
    }
  }, [router]);

  // Show a brief transitional state while the redirect fires.
  return (
    <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col items-center justify-center gap-3 px-6 py-20">
      <p className="text-sm text-muted">Redirecting to Research…</p>
    </div>
  );
}
