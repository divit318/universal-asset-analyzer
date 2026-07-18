"use client";

/**
 * /intelligence — dissolved (§4.3). This route was a container named after a
 * technology ("Graph and Timeline, the two exploration surfaces"), not a user
 * objective, so the IA repair retires it:
 *
 *   - the Graph is now a first-class route at /knowledge-graph;
 *   - the Timeline's daily job moved to the Attention Queue on the Desk (home);
 *   - its thesis-evolution panel migrates into the Journal in Phase D.
 *
 * For this release the route stays as a redirect to the Desk so bookmarks and
 * any lingering inbound links land somewhere sensible, with a one-time toast
 * telling the user where the Timeline went (§12). The page directory is removed
 * in the following release.
 */

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/app/_components/toast";
import { PageShell } from "@/app/_components/ui";

export default function IntelligenceRedirect() {
  const router = useRouter();
  const toast = useToast();
  const fired = useRef(false);

  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    toast("Timeline now lives on your Desk. The graph moved to Knowledge Graph.", "info");
    router.replace("/");
  }, [router, toast]);

  return (
    <PageShell>
      <p className="py-12 text-center text-sm text-muted">Taking you to your Desk…</p>
    </PageShell>
  );
}
