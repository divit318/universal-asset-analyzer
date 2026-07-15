"use client";

/**
 * The homepage — the Investment Operating System dashboard.
 *
 * This file contains no business logic, no data fetching, no module ordering,
 * and no knowledge of what any module does. It mounts the provider (one request
 * for the whole page) and renders the grid (which walks the layout config).
 * That is the entire page.
 *
 * Adding an eleventh module does not touch this file. Reordering the page does
 * not touch this file. Phase 2's visual overhaul should not touch this file.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * What used to be here, and why it isn't:
 *
 *   - A marketing hero ("Institutional-grade equity research, in your browser")
 *     with a feature-count strip. A landing page for a product the user has
 *     already installed and is already using.
 *   - A "Jump in" objective launcher — a third copy of the site navigation,
 *     which is already in the header and the command palette.
 *   - `<DailyPulse>` and `<MarketDashboard>` — two separate teasers of the same
 *     digest, fetching through two separate endpoints, that between them showed
 *     a strict subset of what /intelligence's Mission Control already showed on
 *     the same data. Both are deleted; the modules below render that data once,
 *     properly, from one request.
 *
 * Mission Control itself now lives here rather than at /intelligence — this is
 * the page a user opens first, so this is where "what should I know and do
 * right now" belongs. /intelligence keeps Graph and Timeline, which are genuine
 * exploration surfaces rather than daily-habit ones.
 */

import { PageShell } from "./_components/ui";
import { HomeProvider } from "./_home/home-provider";
import { HomeHeader } from "./_home/home-header";
import { ModuleGrid } from "./_home/module-grid";

export default function Home() {
  return (
    <PageShell>
      <HomeProvider>
        {/* The page's <h1>. Not a hero — see home-header.tsx. */}
        <HomeHeader />
        <ModuleGrid />
      </HomeProvider>
    </PageShell>
  );
}
