"use client";

/**
 * /thematic — Industries & Commodities Discovery Framework
 *
 * 10-stage thematic analysis:
 *   Stage 1  Future State Identification
 *   Stage 2  Dependency Chain Mapping (6 tiers)
 *   Stage 3  Bottleneck Analysis
 *   Stage 4  Supply-Demand & Capital Cycle
 *   Stage 5  Commodity Framework
 *   Stage 6  Policy & Geopolitics
 *   Stage 7  Global Structural Advantage Analysis
 *   Stage 8  Company Tier Mapping
 *   Stage 9  Company Quality (composite screen over the mapped companies)
 *   Stage 10 Opportunity Score
 *
 * This file owns the page's state machine (search, SSE run, restore) and the
 * pre-run onboarding surface. Everything the report renders lives under
 * ./_components, split along the report's own seams (hero, one file per tab,
 * progress, storage, markdown) — the module convention every other tab uses.
 */

import { Suspense, useState, useRef, useCallback, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { ThematicReport, ThematicProgressEvent } from "@/lib/thematic-engine";
import { MAX_THEME_LENGTH } from "@/lib/thematic-theme";
import { Badge, Button, Input, PageShell, SectionHeader } from "@/app/_components/ui";
import { Reveal } from "@/app/_components/reveal";
import { useToast } from "@/app/_components/toast";
import { ThematicReportView } from "./_components/report-view";
import { ProgressView } from "./_components/progress";
import { STORAGE_KEY, asCurrentReport, pushRecent, readRecent } from "./_components/storage";

/* ─────────────────── Preset themes ──────────────────────────────────── */

const PRESET_THEMES = [
  { label: "AI Compute", desc: "Data centres, chips, power" },
  { label: "Energy Storage", desc: "Batteries, lithium, grid" },
  { label: "Nuclear Energy", desc: "Uranium, SMRs, decarbonisation" },
  { label: "Copper & Electrification", desc: "EVs, grids, copper bottleneck" },
  { label: "Cybersecurity", desc: "Zero trust, identity, cyber spend" },
  { label: "Water Infrastructure", desc: "Treatment, pipes, desalination" },
  { label: "Rare Earth & Critical Minerals", desc: "Supply-chain sovereignty" },
  { label: "Defence Modernisation", desc: "Rearmament, munitions, primes" },
  { label: "Robotics & Automation", desc: "Factory of the future" },
  { label: "Offshore Wind", desc: "Turbines, cables, ports" },
];

/* ─────────────────── Main page ──────────────────────────────────────── */

function ThematicPageInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const toast = useToast();
  const themeFromQuery = searchParams.get("theme");

  const [report, setReport] = useState<ThematicReport | null>(null);
  const [theme, setTheme] = useState(() => themeFromQuery ?? "");
  const [running, setRunning] = useState(false);
  const [events, setEvents] = useState<ThematicProgressEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [recent, setRecent] = useState<string[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  /** The theme most recently started (typed, preset, or deep link) — the guard
   *  that keeps the URL sync below from re-triggering the run it came from. */
  const startedThemeRef = useRef<string | null>(null);

  // Recent themes and the saved report live in browser storage, which doesn't
  // exist during SSR — restore both after mount so the server and client first
  // paints agree. Restoring the report in the lazy initializer instead caused
  // a hydration mismatch (and a full client re-render) on every revisit with a
  // saved report, because /thematic prerenders without one. A `?theme=`
  // deep-link always wins over any stale saved report, since it auto-runs.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reading browser storage after mount IS the mechanism: doing it in the initializer makes the SSR and client first paints disagree.
    setRecent(readRecent());
    if (themeFromQuery) return;
    try {
      const saved = sessionStorage.getItem(STORAGE_KEY);
      const restored = saved ? asCurrentReport(JSON.parse(saved)) : null;
      if (restored) setReport(restored);
    } catch { /* ignore corrupt storage */ }
    // Mount only: a later query change is handled by the deep-link effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    document.title = report ? `${report.theme} · Thematic · UAA` : "Thematic · UAA";
    return () => { document.title = "Universal Asset Analyzer"; };
  }, [report]);

  // One interval for the whole run; the start time lives in a ref so restarting
  // the timer never depends on a state update landing first.
  const startRef = useRef<number>(0);
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - startRef.current) / 1000)), 1000);
    return () => clearInterval(id);
  }, [running]);

  const run = useCallback(async (themeOverride?: string, opts: { refresh?: boolean } = {}) => {
    const t = (themeOverride ?? theme).trim().slice(0, MAX_THEME_LENGTH);
    if (!t) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    startRef.current = Date.now();
    setRunning(true);
    setElapsed(0);
    setEvents([]);
    setReport(null);
    setError(null);

    // The URL names what is on screen. Without this, a reload after
    // researching a second theme silently re-ran whatever stale `?theme=`
    // the address bar still carried and discarded the report being read.
    startedThemeRef.current = t;
    router.replace(`/thematic?theme=${encodeURIComponent(t)}`, { scroll: false });

    // Stall watchdog. The server heartbeats every 15s even mid-stage, so 90s
    // of total silence means the connection is dead (proxy idle timeout, a
    // laptop sleep) — without this, `reader.read()` waited forever while the
    // elapsed clock kept ticking, indistinguishable from a slow model.
    let stalled = false;
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    const armWatchdog = () => {
      clearTimeout(watchdog);
      watchdog = setTimeout(() => {
        stalled = true;
        controller.abort();
      }, 90_000);
    };

    try {
      const res = await fetch("/api/thematic", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ theme: t, refresh: opts.refresh === true }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(json.error ?? `Request failed (${res.status})`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      armWatchdog();

      while (true) {
        const { done, value } = await reader.read();
        armWatchdog();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const parts = buf.split("\n\n");
        buf = parts.pop() ?? "";
        for (const part of parts) {
          const line = part.trim();
          if (!line.startsWith("data: ")) continue;
          let evt: ThematicProgressEvent & { report?: ThematicReport; cached?: boolean };
          try {
            evt = JSON.parse(line.slice(6));
          } catch {
            continue; // a truncated frame; the next chunk completes it
          }
          setEvents((prev) => [...prev, evt]);
          if (evt.stage === "done" && evt.report) {
            setReport(evt.report);
            // Recent is a list of themes with a *saved report to load* — a
            // cancelled or failed run has none, so it joins only on success
            // (its chips promise "Saved reports load instantly").
            setRecent(pushRecent(evt.report.theme));
            // The route says when a report was served from cache and how old
            // it is; that message was previously discarded on the floor.
            if (evt.cached) toast(evt.message);
            try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(evt.report)); } catch { /* quota */ }
          }
          if (evt.stage === "error") setError(evt.message);
        }
      }
    } catch (err) {
      if (stalled) {
        // The watchdog aborted, not the user — say what actually happened.
        setError("The connection to the analysis went quiet for 90 seconds and was closed. The run has been stopped — try again.");
      } else if ((err as Error).name !== "AbortError") {
        setError(err instanceof Error ? err.message : "Unexpected error");
      }
    } finally {
      clearTimeout(watchdog);
      setRunning(false);
    }
  }, [theme, router, toast]);

  const handlePreset = useCallback((label: string) => {
    setTheme(label);
    void run(label);
  }, [run]);

  // Deep-link auto-run: a theme arriving via `?theme=` should populate the
  // field AND start analysis immediately — the user should never re-enter it.
  // This reacts to every query change, not just the mount: a second deep link
  // while already on /thematic (assistant navigation, another Wire card) used
  // to change the URL and trigger nothing. The ref distinguishes a genuinely
  // new deep link from the echo of run()'s own router.replace.
  useEffect(() => {
    if (!themeFromQuery || themeFromQuery === startedThemeRef.current) return;
    setTheme(themeFromQuery);
    void run(themeFromQuery);
    // `run`'s identity changes whenever `theme` state updates; the ref above
    // is the real re-run guard.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [themeFromQuery]);

  const tooLong = theme.length >= MAX_THEME_LENGTH;

  return (
    <PageShell py="py-10">
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">Thematic Research</h1>
          <Badge variant="brand">10 stages</Badge>
        </div>
        <p className="max-w-2xl text-sm leading-relaxed text-muted">
          Industries &amp; Commodities Discovery Framework. Most investors study products — this maps the dependency
          chain behind them, finds the bottleneck, and tells you who owns it.
        </p>
      </div>

      {/* Search */}
      <div className="flex flex-col gap-2.5">
        <div className="flex gap-2">
          <Input
            value={theme}
            onChange={(e) => setTheme(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !running) void run(); }}
            placeholder="Name a theme — AI Compute, Nuclear Energy, Rare Earths, Cybersecurity, Shipping…"
            maxLength={MAX_THEME_LENGTH}
            disabled={running}
            aria-label="Investment theme to research"
            className="flex-1 py-2.5"
          />
          {running ? (
            <Button variant="destructive" onClick={() => abortRef.current?.abort()}>
              Cancel
            </Button>
          ) : (
            <Button variant="primary" onClick={() => void run()} disabled={!theme.trim()}>
              Analyse
            </Button>
          )}
        </div>
        {tooLong && (
          <p className="text-xs text-warning">
            Themes are capped at {MAX_THEME_LENGTH} characters — a tighter theme also produces a sharper report.
          </p>
        )}
        {recent.length > 0 && !running && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-label font-semibold uppercase tracking-widest text-muted/60">Recent</span>
            {recent.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => handlePreset(t)}
                title="Saved reports load instantly"
                className="rounded-full border border-border px-2.5 py-0.5 text-xs text-muted outline-none transition-colors hover:border-brand/40 hover:text-foreground focus-visible:ring-2 focus-visible:ring-brand/40"
              >
                {t}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Onboarding — only before the first run */}
      {!running && !report && (
        <div className="flex flex-col gap-5">
          <SectionHeader label="Start here" description="Ten themes the framework handles well." />
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
            {PRESET_THEMES.map((p, i) => (
              <Reveal key={p.label} index={i}>
                <button
                  type="button"
                  onClick={() => handlePreset(p.label)}
                  className="flex h-full w-full flex-col gap-0.5 rounded-card border border-border bg-surface px-3.5 py-3 text-left outline-none transition-[transform,border-color,background-color] duration-200 hover:-translate-y-0.5 hover:border-brand/40 hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-brand/40"
                >
                  <span className="text-sm font-medium">{p.label}</span>
                  <span className="text-xs leading-snug text-muted">{p.desc}</span>
                </button>
              </Reveal>
            ))}
          </div>

          <SectionHeader label="How it works" description="Roughly 5–20 minutes on a local model. Reports are saved, so a repeat search is instant." />
          <div className="grid gap-3 sm:grid-cols-3">
            {[
              { step: "1–3", title: "Foundation", desc: "Inevitability of the future state, the six-tier dependency chain, and which tier is the real bottleneck." },
              { step: "4–7", title: "Market dynamics", desc: "Capital-cycle position against live market proxies, commodity intensity, policy flows, and regional advantage." },
              { step: "8–10", title: "Expression", desc: "Screener companies mapped to tiers, screened on composite quality, then scored into one verdict with named risks." },
            ].map(({ step, title, desc }, i) => (
              <Reveal key={step} index={i} className="flex gap-3 rounded-card border border-border bg-surface p-4">
                <span className="mt-0.5 shrink-0 font-mono text-label font-bold text-muted/60">{step}</span>
                <div>
                  <p className="text-sm font-semibold">{title}</p>
                  <p className="mt-1 text-xs leading-relaxed text-muted">{desc}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      )}

      {error && (
        <div className="rounded-card border border-negative/30 bg-negative/5 px-4 py-3">
          <p className="text-sm text-negative">{error}</p>
          <Button size="xs" variant="secondary" className="mt-2" onClick={() => void run()}>
            Try again
          </Button>
        </div>
      )}

      {running && <ProgressView events={events} elapsed={elapsed} />}

      {report && (
        <ThematicReportView
          report={report}
          refreshing={running}
          onRefresh={() => void run(report.theme, { refresh: true })}
        />
      )}
    </PageShell>
  );
}

export default function ThematicPage() {
  return (
    <Suspense fallback={<PageShell py="py-10"><div className="h-40" /></PageShell>}>
      <ThematicPageInner />
    </Suspense>
  );
}
