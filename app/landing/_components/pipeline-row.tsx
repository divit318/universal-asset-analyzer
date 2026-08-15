/**
 * PipelineRow — the 01 to 05 pipeline as a DETACHED typographic row beneath
 * the hero body: numbers, stage names, sub-labels, dotted connector rules.
 * Spatially independent of the particle field, with its own baseline
 * visibility; it never depends on the field existing.
 *
 * Coupling is ONE-WAY: the hero flow field brightens a stage as its
 * travelling bulge passes that stage's horizontal position (it queries
 * [data-pipeline-stage] directly), but the field never gates the row. No
 * vertical ticks into the field.
 */
export const PIPELINE_STAGES = [
  { n: "01", label: "Ingest", sub: "Market Data" },
  { n: "02", label: "Normalize", sub: "Clean & Standardize" },
  { n: "03", label: "Compute", sub: "Deterministic Engines" },
  { n: "04", label: "Analyze", sub: "Explain What Matters" },
  { n: "05", label: "Trace", sub: "Back to Source" },
] as const;

export function PipelineRow() {
  return (
    <ol
      aria-label="How UAA works, in order"
      className="grid w-full grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-5 sm:gap-x-0"
    >
      {PIPELINE_STAGES.map((stage, i) => (
        <li
          key={stage.n}
          data-pipeline-stage
          className="relative flex flex-col items-start pr-6 transition-[filter] duration-300"
        >
          <div className="flex w-full items-center gap-3">
            <span className="font-mono text-[11px] tabular-nums tracking-[0.08em] text-brand/80">{stage.n}</span>
            {/* Dotted connector rule to the next stage. */}
            {i < PIPELINE_STAGES.length - 1 && (
              <span
                aria-hidden="true"
                className="hidden h-px flex-1 bg-[repeating-linear-gradient(to_right,var(--color-border-strong)_0,var(--color-border-strong)_2px,transparent_2px,transparent_9px)] opacity-70 sm:block"
              />
            )}
          </div>
          <span className="mt-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-foreground/90">{stage.label}</span>
          <span className="mt-0.5 text-mk-small text-muted/80">{stage.sub}</span>
        </li>
      ))}
    </ol>
  );
}
