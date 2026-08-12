import type { ClaimBasis } from "@/lib/research-engines/fund/exposure";

/**
 * The source / calculated / interpretation marker.
 *
 * lib/provenance.ts already answers "where did this come from and how old is
 * it". This is the axis it has no opinion on: whether a statement was REPORTED,
 * COMPUTED by UAA, or is UAA's reading. On a page that mixes all three in
 * adjacent sentences, that distinction is what separates research from
 * assertion — an expense ratio and "concentration materially reduces
 * diversification" should not look equally authoritative.
 *
 * Kept to a single superscript glyph with a native tooltip. A visible word on
 * every line would triple the page's text; the legend below the section carries
 * the key for anyone who needs it.
 */

const MARK: Record<ClaimBasis, { glyph: string; title: string; className: string }> = {
  source:  { glyph: "s", title: "Source — reported by the data provider",     className: "text-faint" },
  calc:    { glyph: "c", title: "Calculated — UAA arithmetic on source data",  className: "text-brand/70" },
  read:    { glyph: "i", title: "Interpretation — UAA's reading, not a measurement", className: "text-accent/70" },
};

export function BasisMark({ basis }: { basis: ClaimBasis }) {
  const m = MARK[basis];
  return (
    <sup
      title={m.title}
      aria-label={m.title}
      className={`ml-0.5 select-none font-mono text-[9px] font-semibold ${m.className}`}
    >
      {m.glyph}
    </sup>
  );
}

/** One-line key. Rendered once per section that uses marks, not once per claim. */
export function BasisLegend({ className = "" }: { className?: string }) {
  return (
    <p className={`text-micro text-faint ${className}`}>
      <span className="font-mono text-faint">s</span> source ·{" "}
      <span className="font-mono text-brand/70">c</span> UAA calculated ·{" "}
      <span className="font-mono text-accent/70">i</span> UAA interpretation
    </p>
  );
}
