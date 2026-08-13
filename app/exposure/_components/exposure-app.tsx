"use client";

/**
 * Exposure — the page.
 *
 * Load once, explore forever. `/api/exposure` returns the complete route model
 * in a single payload; every click after that is a pure function over it
 * (lib/exposure/query.ts). Drivers arrive on a second, slower request and merge
 * in without disturbing anything already on screen, and the optional AI cluster
 * names arrive third. Nothing the user does triggers a fetch except opening the
 * events panel for a specific issuer.
 *
 * Navigation is a TRAIL, not a selection. Each move appends to a breadcrumb
 * backed by real browser history, so Esc, the back button, a back swipe and the
 * breadcrumb itself are all the same gesture. That is what lets someone go
 * Portfolio → NVDA → VOO → MSFT → Semiconductors → TSM and still find their way
 * home — the thing the old graph could not do past two clicks.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useDataset } from "@/lib/platform/client/use-dataset";
import { PageShell } from "@/app/_components/ui";
import { LoadingMark } from "@/app/_components/loading-mark";
import type {
  ExposureDrivers,
  ExposureGraph,
  ExposureModel,
} from "@/lib/exposure/types";
import { indexGraph } from "@/lib/exposure/query";
import { issuerId } from "@/lib/exposure/types";
import { Ribbon, CoverageStamp } from "./ribbon";
import { FindingsRail } from "./findings-rail";
import { Stage } from "./stage";
import { Inspector } from "./inspector";
import { Trail, type TrailEntry } from "./trail";
import { labelForNode, type Selection } from "./nav";
import { Eyebrow } from "./primitives";

const ROOT: TrailEntry = { nodeId: "portfolio", view: "overview", label: "Portfolio" };

/** The trail a fresh mount starts on, honouring an `?issuer=` deep link. */
function initialTrail(): TrailEntry[] {
  if (typeof window === "undefined") return [ROOT];
  const issuer = new URLSearchParams(window.location.search).get("issuer")?.trim().toUpperCase();
  if (!issuer) return [ROOT];
  return [ROOT, { nodeId: issuerId(issuer), view: "trace", label: issuer }];
}

export function ExposureApp() {
  /* ────────────── Data ────────────── */

  const modelFetcher = useCallback(async (signal: AbortSignal) => {
    const res = await fetch("/api/exposure", { signal });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error ?? "Failed to load exposure");
    return json as ExposureModel;
  }, []);

  const {
    data: model,
    error,
    isInitialLoading,
  } = useDataset<ExposureModel>("exposureModel", "default", modelFetcher);

  const driversFetcher = useCallback(async (signal: AbortSignal) => {
    const res = await fetch("/api/exposure/drivers", { signal });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error ?? "Failed to load drivers");
    return json as ExposureDrivers;
  }, []);

  const { data: driversData, error: driversError } = useDataset<ExposureDrivers>(
    "exposureDrivers",
    "default",
    driversFetcher,
    // Only after the routes are on screen: the drivers pass is the expensive
    // one, and it must never be the reason the first paint is late.
    { enabled: model != null },
  );

  /* Optional AI names for co-movement clusters. Strictly additive, fired last,
     and silently ignored on failure — the deterministic labels are complete. */
  const [aiLabels, setAiLabels] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!driversData) return;
    const unnamed = driversData.drivers.filter((d) =>
      d.basis.every((b) => b.kind === "co-movement"),
    );
    if (unnamed.length === 0) return;
    const controller = new AbortController();
    fetch("/api/exposure/labels", { signal: controller.signal })
      .then((r) => r.json())
      .then((json: { labels?: { id: string; label: string }[] }) => {
        const next: Record<string, string> = {};
        for (const l of json.labels ?? []) next[l.id] = l.label;
        if (Object.keys(next).length > 0) setAiLabels(next);
      })
      .catch(() => {});
    return () => controller.abort();
  }, [driversData]);

  /* ────────────── The merged graph ────────────── */

  const graph = useMemo<ExposureGraph | null>(() => {
    if (!model) return null;
    const industries = driversData?.industries ?? {};
    return {
      ...model,
      // Industry back-fills onto the issuer once the drivers pass resolves it.
      issuers: model.issuers.map((i) =>
        industries[i.symbol] ? { ...i, industry: industries[i.symbol] } : i,
      ),
      drivers: (driversData?.drivers ?? []).map((d) =>
        aiLabels[d.id] ? { ...d, label: aiLabels[d.id], labelFromAi: true } : d,
      ),
      driverEdges: driversData?.edges ?? [],
      driversState: driversError ? "unavailable" : driversData ? "ready" : "pending",
      unresolvedIssuers: driversData?.unresolved ?? [],
      probes: driversData?.probes ?? [],
    };
  }, [model, driversData, driversError, aiLabels]);

  const index = useMemo(() => (graph ? indexGraph(graph) : null), [graph]);

  /* ────────────── The trail ────────────── */

  /**
   * Deep link. `?issuer=NVDA` opens that trace directly, which is what makes an
   * inbound link from Research ("how exposed am I to the thing I'm reading
   * about?") land somewhere useful.
   *
   * Read in the state initializer rather than an effect. It cannot be resolved
   * against the model — that has not loaded yet — so the entry is built
   * optimistically from the symbol and the trace view reports an unheld name as
   * the answer it is ("no exposure to NVDA"), which beats silently showing the
   * overview to someone who asked a specific question. Server-side this returns
   * the bare root, and so does the client's first render, because both paint the
   * loading shell while the model is in flight.
   */
  const [trail, setTrailState] = useState<TrailEntry[]>(initialTrail);
  const trailRef = useRef<TrailEntry[]>(trail);
  const [compareWith, setCompareWith] = useState<string | null>(null);

  const setTrail = useCallback((next: TrailEntry[]) => {
    trailRef.current = next;
    setTrailState(next);
  }, []);

  // Browser history is the source of truth for depth, so the platform's own
  // back gesture walks the trail instead of leaving the page. A deep-linked
  // second crumb gets its own history entry here, so the breadcrumb's
  // "Portfolio" and the back button both land on the overview rather than
  // bouncing the reader off the page entirely.
  useEffect(() => {
    window.history.replaceState({ exposureDepth: 1 }, "");
    if (trailRef.current.length > 1) {
      window.history.pushState({ exposureDepth: trailRef.current.length }, "");
    }
    const onPop = (e: PopStateEvent) => {
      const raw = (e.state as { exposureDepth?: number } | null)?.exposureDepth;
      const depth = typeof raw === "number" ? raw : 1;
      setTrail(trailRef.current.slice(0, Math.max(1, depth)));
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [setTrail]);

  const navigate = useCallback(
    (next: Selection) => {
      if (!index) return;
      const label =
        next.view === "compare" && next.secondaryId
          ? `${labelForNode(index, next.nodeId)} ↔ ${labelForNode(index, next.secondaryId)}`
          : next.view === "overlap" && next.secondaryId
            ? `${labelForNode(index, next.nodeId)} ∩ ${labelForNode(index, next.secondaryId)}`
            : next.view === "blast"
              ? `${labelForNode(index, next.nodeId)} blast radius`
              : labelForNode(index, next.nodeId);

      const current = trailRef.current[trailRef.current.length - 1];
      // Switching the lens on the same subject replaces the crumb instead of
      // stacking a second one — "NVDA / NVDA blast radius" is noise, not a path.
      const replace =
        current.nodeId === next.nodeId && current.view !== next.view && !next.secondaryId;

      const entry: TrailEntry = { ...next, label };
      const nextTrail = replace
        ? [...trailRef.current.slice(0, -1), entry]
        : [...trailRef.current, entry];

      setTrail(nextTrail);
      if (replace) {
        window.history.replaceState({ exposureDepth: nextTrail.length }, "");
      } else {
        window.history.pushState({ exposureDepth: nextTrail.length }, "");
      }
    },
    [index, setTrail],
  );

  const jump = useCallback(
    (i: number) => {
      const delta = i - (trailRef.current.length - 1);
      if (delta < 0) window.history.go(delta);
    },
    [],
  );

  const back = useCallback(() => {
    if (trailRef.current.length > 1) window.history.back();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (compareWith) {
        setCompareWith(null);
        return;
      }
      back();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [back, compareWith]);

  /* ────────────── Render ────────────── */

  if (isInitialLoading) {
    return (
      <PageShell width="wide" gap="gap-6">
        <Header />
        <div className="flex h-96 items-center justify-center">
          <LoadingMark label="Resolving your exposure routes" />
        </div>
      </PageShell>
    );
  }

  if (error || !graph || !index) {
    return (
      <PageShell width="wide" gap="gap-6">
        <Header />
        <div className="rounded-card border border-border bg-surface p-8 text-center">
          <p className="text-sm text-foreground">{error ?? "Exposure could not be built."}</p>
          <p className="mt-2 text-caption text-muted">
            This page reads your portfolio ledger. If it is empty, there is nothing to look through yet.
          </p>
          <Link
            href="/portfolio"
            className="mt-4 inline-block rounded-control border border-border-strong bg-surface-3 px-3 py-2 text-caption font-medium text-foreground transition-colors hover:bg-surface-2"
          >
            Open Portfolio →
          </Link>
        </div>
      </PageShell>
    );
  }

  if (graph.positions.length === 0) {
    return (
      <PageShell width="wide" gap="gap-6">
        <Header />
        <div className="rounded-card border border-dashed border-border p-10 text-center">
          <p className="text-sm text-foreground">Your ledger is empty.</p>
          <p className="mx-auto mt-2 max-w-md text-caption leading-relaxed text-muted">
            Exposure is built entirely from what you hold — there is no version of this page that means
            anything without a portfolio. Add holdings and every route, driver and finding here becomes
            computable.
          </p>
          <Link
            href="/portfolio"
            className="mt-4 inline-block rounded-control border border-border-strong bg-surface-3 px-3 py-2 text-caption font-medium text-foreground transition-colors hover:bg-surface-2"
          >
            Add holdings →
          </Link>
        </div>
      </PageShell>
    );
  }

  const selection = trail[trail.length - 1];
  const showInspector = selection.view !== "overview";

  return (
    <PageShell width="wide" gap="gap-5">
      <Header stamp={<CoverageStamp graph={graph} />} />

      <Ribbon graph={graph} index={index} navigate={navigate} />

      <Trail trail={trail} onJump={jump} onBack={back} />

      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        <div className="w-full shrink-0 lg:w-[340px]">
          <FindingsRail
            findings={graph.findings}
            index={index}
            navigate={navigate}
            selection={selection}
          />
        </div>

        <div className="min-w-0 flex-1">
          <Stage graph={graph} index={index} selection={selection} navigate={navigate} />
        </div>

        {showInspector ? (
          <div className="w-full shrink-0 border-t border-hairline pt-5 lg:w-[276px] lg:border-l lg:border-t-0 lg:pl-5 lg:pt-0">
            <Inspector
              graph={graph}
              index={index}
              selection={selection}
              navigate={navigate}
              compareWith={compareWith}
              onPickCompare={setCompareWith}
            />
          </div>
        ) : null}
      </div>

      {graph.coverage.unmappedLabels.length > 0 ? (
        <footer className="space-y-1.5 border-t border-hairline pt-4">
          <Eyebrow>Outside issuer space</Eyebrow>
          <p className="max-w-3xl text-caption leading-relaxed text-muted">
            {graph.coverage.unmappedLabels.join(", ")} —{" "}
            {(100 - graph.coverage.issuerMappedPct).toFixed(1)}% of your book — have no company
            decomposition. Cash, bullion, currencies, bonds and manually-valued assets are real value
            with no issuer behind them, so they sit outside every percentage on this page rather than
            being folded into one.
          </p>
        </footer>
      ) : null}
    </PageShell>
  );
}

function Header({ stamp }: { stamp?: React.ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-x-8 gap-y-2">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Exposure</h1>
        <p className="text-sm text-muted">
          What you actually own, how you ended up owning it, and what else moves with it.
        </p>
      </div>
      {stamp}
    </header>
  );
}
