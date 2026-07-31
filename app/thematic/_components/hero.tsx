"use client";

import { useCallback, useState } from "react";
import { AlertTriangle, Copy, FileSpreadsheet, RotateCcw } from "lucide-react";
import type { ThematicReport, RiskFlag, ScoreFactor } from "@/lib/thematic-engine";
import { Badge, Button, Card, SectionHeader } from "@/app/_components/ui";
import { Reveal } from "@/app/_components/reveal";
import { ScoreRing } from "@/app/_components/score-ring";
import { ValueBar } from "@/app/_components/value-bar";
import { useToast } from "@/app/_components/toast";
import { downloadBlob } from "@/lib/download";
import { scoreTone } from "./shared";
import { toMarkdown } from "./markdown";

const VERDICT_VARIANT = {
  exceptional: "positive",
  strong: "positive",
  moderate: "neutral",
  weak: "negative",
  avoid: "negative",
} as const;

/** "6m 54s" from the report's own measured stage times; null pre-timings shapes. */
function totalRunTime(report: ThematicReport): string | null {
  const ms = (report.stageTimings ?? []).reduce((s, t) => s + t.ms, 0);
  if (ms < 1000) return null;
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
}

export function Hero({ report, onRefresh }: { report: ThematicReport; onRefresh: () => void }) {
  const { opportunity, integrity } = report;
  const toast = useToast();
  const runTime = totalRunTime(report);

  const copyMarkdown = useCallback(() => {
    void navigator.clipboard.writeText(toMarkdown(report)).then(
      () => toast("Report copied as Markdown"),
      () => toast("Couldn't copy to the clipboard", "error"),
    );
  }, [report, toast]);

  const exportExcel = useCallback(() => {
    const slug = report.theme.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "theme";
    void downloadBlob(
      "/api/export/thematic",
      `thematic-${slug}-${new Date().toISOString().slice(0, 10)}.xlsx`,
      "POST",
      { report },
    ).catch((e: unknown) => toast(e instanceof Error ? e.message : "Export failed", "error"));
  }, [report, toast]);

  return (
    <Card padding="lg">
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="brand">Thematic report</Badge>
            <Badge variant={VERDICT_VARIANT[opportunity.verdict]}>{opportunity.verdict}</Badge>
            {integrity.stagesEvidenced < integrity.stagesTotal && (
              <Badge variant="warning">
                {integrity.stagesEvidenced}/{integrity.stagesTotal} AI stages evidenced
              </Badge>
            )}
          </div>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">{report.theme}</h1>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted">{opportunity.verdictRationale}</p>
          {opportunity.verdictCaveat && (
            <p className="mt-2 flex max-w-2xl items-start gap-2 text-sm leading-relaxed text-warning">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2} />
              {opportunity.verdictCaveat}
            </p>
          )}
          <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
            <span>{new Date(report.generatedAt).toLocaleString()}</span>
            <span className="text-faint">·</span>
            <span className="font-mono">{report.model}</span>
            <span className="text-faint">·</span>
            <span>
              {integrity.universeShortlisted} of {integrity.universeTotal} screener names in scope
            </span>
            {runTime && (
              <>
                <span className="text-faint">·</span>
                <span title="Measured wall-clock time of the analysis stages">analysed in {runTime}</span>
              </>
            )}
          </div>
        </div>

        <div className="flex shrink-0 flex-col items-center gap-3">
          <ScoreRing
            key={report.theme}
            score={opportunity.themeScore}
            size={116}
            strokeWidth={5}
            arcClassName={scoreTone(opportunity.themeScore).text}
            valueClassName="text-3xl"
            caption="/ 100"
            label={`Opportunity score ${opportunity.themeScore} out of 100`}
          />
          <div className="flex gap-1.5">
            <Button size="xs" variant="ghost" onClick={copyMarkdown} title="Copy the whole report as Markdown">
              <Copy className="h-3 w-3" strokeWidth={2} /> Copy
            </Button>
            <Button size="xs" variant="ghost" onClick={exportExcel} title="Download the companies table, score summary, and universe as XLSX">
              <FileSpreadsheet className="h-3 w-3" strokeWidth={2} /> Excel
            </Button>
            <Button size="xs" variant="ghost" onClick={onRefresh} title="Discard the saved report and re-run every stage">
              <RotateCcw className="h-3 w-3" strokeWidth={2} /> Re-run
            </Button>
          </div>
        </div>
      </div>

      <FactorStrip factors={opportunity.factors} />

      {/* PR-2: the score's construction, stated where the score is. Stage
          scores are AI interpretation; the flags and caps are computation —
          per the project's "label AI output as interpretation" rule. */}
      <p className="mt-3 text-xs leading-relaxed text-faint">
        Methodology: score = weighted mean of the stage scores above, weights fixed by the framework (Part 10.5).
        The verdict is capped one band when the capital cycle contradicts it. Stage scores are a local model&apos;s
        interpretation; the risk flags, integrity figures, and verdict cap are computed from them, not asked for.
      </p>
    </Card>
  );
}

/**
 * The weighted inputs behind the headline score.
 *
 * Each tile now says what it measures, how much it counts, and — the part that
 * was missing — whether it rests on a real answer at all. An unevidenced factor
 * is drawn muted and struck through with a dashed track so a 5/10 assumption
 * can never be mistaken for a 5/10 finding.
 */
function FactorStrip({ factors }: { factors: ScoreFactor[] }) {
  return (
    <div className="mt-6 grid grid-cols-2 gap-2 border-t border-border pt-5 sm:grid-cols-4 lg:grid-cols-7">
      {factors.map((f, i) => (
        <FactorTile key={f.key} factor={f} index={i} />
      ))}
    </div>
  );
}

/**
 * One factor tile. The meaning text is the only place the score's semantics
 * are explained, so it renders in a click/focus popover (the ScoreChip
 * pattern) rather than a `title` attribute — invisible on touch devices and
 * unreliable for screen readers, which is where it used to live.
 */
function FactorTile({ factor: f, index }: { factor: ScoreFactor; index: number }) {
  const [open, setOpen] = useState(false);
  const tone = scoreTone(f.score);
  return (
    <Reveal index={index} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        title={`${f.meaning}${f.evidenced ? "" : "\n\nThis stage returned nothing usable — scored at a neutral default."}`}
        className="group flex w-full flex-col gap-1.5 rounded-control border border-border bg-surface-2 px-2.5 py-2 text-left outline-none transition-colors hover:border-border-strong focus-visible:ring-2 focus-visible:ring-brand/40"
      >
        <span className="truncate text-label font-medium uppercase tracking-wide text-muted/70">{f.label}</span>
        <span className="flex items-baseline gap-1">
          <span className={`font-mono text-sm font-semibold tabular-nums ${f.evidenced ? tone.text : "text-faint"}`}>
            {f.evidenced ? Math.round(f.score) : "—"}
          </span>
          <span className="text-label text-muted/60">wt {Math.round(f.weight * 100)}%</span>
        </span>
        <ValueBar
          value={f.evidenced ? f.score : null}
          barClassName={tone.bar}
          trackClassName={f.evidenced ? "bg-border" : "bg-border/40"}
          durationMs={900}
        />
      </button>
      {open && (
        <span
          role="tooltip"
          className="absolute left-0 top-full z-50 mt-2 w-64 animate-popover-in rounded-panel border border-border bg-surface p-3 text-left shadow-popover"
        >
          <span className="block text-[11px] font-semibold text-foreground">
            {f.label} · weight {Math.round(f.weight * 100)}%
          </span>
          <span className="mt-1 block text-[11px] leading-relaxed text-muted">{f.meaning}</span>
          {!f.evidenced && (
            <span className="mt-2 block text-[11px] leading-relaxed text-warning">
              This stage returned nothing usable — scored at a neutral default.
            </span>
          )}
        </span>
      )}
    </Reveal>
  );
}

/**
 * What would have to be true for this report to be wrong.
 *
 * The report used to answer "how good is this theme?" and stop. A research
 * surface that only ever argues one side is a pitch deck, not analysis.
 */
export function RiskFlags({ flags }: { flags: RiskFlag[] }) {
  if (flags.length === 0) return null;
  const TONE = {
    high: "border-negative/30 bg-negative/5 text-negative",
    medium: "border-warning/30 bg-warning/5 text-warning",
    low: "border-border bg-surface-2 text-muted",
  } as const;
  return (
    <div className="flex flex-col gap-3">
      <SectionHeader label="What could break this" description="Derived from the stage outputs above — not a separate AI opinion." />
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {flags.map((f, i) => (
          <Reveal key={f.label} index={i} className={`rounded-card border px-3.5 py-3 ${TONE[f.severity]}`}>
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
              <span className="text-xs font-semibold capitalize">{f.label}</span>
            </div>
            <p className="mt-1.5 text-xs leading-relaxed text-muted">{f.detail}</p>
          </Reveal>
        ))}
      </div>
    </div>
  );
}

/** Caveats that qualify the headline, stated once, at the top, in plain language. */
export function IntegrityNotice({ report }: { report: ThematicReport }) {
  const caveats = report.integrity.caveats;
  if (caveats.length === 0) return null;
  return (
    <div className="rounded-card border border-warning/30 bg-warning/5 px-4 py-3">
      <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-warning">
        <AlertTriangle className="h-3.5 w-3.5" strokeWidth={2} />
        Read this score with {caveats.length} caveat{caveats.length === 1 ? "" : "s"}
      </p>
      <ul className="mt-2 flex flex-col gap-1.5">
        {caveats.map((c, i) => (
          <li key={i} className="flex items-start gap-2 text-xs leading-relaxed text-muted">
            <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-warning" />
            {c}
          </li>
        ))}
      </ul>
    </div>
  );
}
