"use client";

/**
 * The homepage — Today, "The Morning Ledger".
 *
 * This file contains no business logic, no data fetching, and no knowledge of
 * what any section renders. It mounts the provider (one /api/home request for
 * the whole page, plus the independent brief stream) and the composition.
 *
 * 2026-08-15: the module-grid dashboard was replaced by the approved
 * Morning Ledger composition (app/_home/today/) — an editorial briefing:
 * state → verdict → signals → week → book → markets. The registry, layout
 * config, and module map remain the contract of record for module metadata
 * (refresh cadences, data sources, nav targets) and stay under test; the
 * page simply no longer walks the 12-column grid to paint.
 *
 * The digest alone paints the page. The AI brief streams in behind it and
 * never blocks the first render (see HomeProvider).
 */

import { HomeProvider } from "./_home/home-provider";
import { TodayPage } from "./_home/today/today-page";

export default function Home() {
  return (
    <HomeProvider>
      <TodayPage />
    </HomeProvider>
  );
}
