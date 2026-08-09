import type { JSX } from "react";

/**
 * TwoToneHeadline — every landing section headline. Serif display type with
 * per-segment tone: "primary" renders in the foreground ink, "accent" in
 * brass. Sections pass segments; nobody hardcodes spans.
 *
 * `size` maps to the marketing type tokens (globals.css @theme): "hero" is
 * reserved for the page's single h1, "display" is the section tier.
 */
export interface HeadlineSegment {
  text: string;
  tone?: "primary" | "accent";
  /** Force a line break before this segment. */
  block?: boolean;
  /** Join to the previous segment with no space (e.g. an accent period). */
  tight?: boolean;
}

export function TwoToneHeadline({
  segments,
  as: Tag = "h2",
  size = "display",
  align = "center",
  id,
  className = "",
}: {
  segments: HeadlineSegment[];
  as?: keyof Pick<JSX.IntrinsicElements, "h1" | "h2" | "h3">;
  size?: "hero" | "hero-split" | "display";
  align?: "center" | "left";
  id?: string;
  className?: string;
}) {
  return (
    <Tag
      id={id}
      className={`text-balance font-serif ${size === "hero" ? "text-mk-hero" : size === "hero-split" ? "text-mk-hero-split" : "text-mk-display"} ${
        // Optical alignment: serif side bearings inset the glyph edge, so
        // left-aligned headlines carry a small negative indent (Phase 4.1).
        align === "center" ? "text-center" : "-indent-[0.02em] text-left"
      } ${className}`}
    >
      {segments.map((seg, i) => (
        // Line breaks render as <br/> (not display:block) so a `tight`
        // segment (e.g. the accent period) stays on the previous line.
        <span key={i}>
          {seg.block && i > 0 && <br />}
          <span className={seg.tone === "accent" ? "text-brand" : "text-foreground"}>
            {seg.text}
            {i < segments.length - 1 && !segments[i + 1]?.block && !segments[i + 1]?.tight ? " " : ""}
          </span>
        </span>
      ))}
    </Tag>
  );
}
