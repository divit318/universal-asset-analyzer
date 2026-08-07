import type { ReactNode } from "react";
import { OrnamentalEyebrow } from "./ornamental-eyebrow";
import { TwoToneHeadline, type HeadlineSegment } from "./two-tone-headline";
import { Reveal } from "../motion/reveal";

/**
 * SectionHeader — the eyebrow → headline → lead stack that opens every
 * section, carrying the page's ONE reveal timeline (Phase 3.1):
 *   eyebrow 0ms, headline 90ms, lead 180ms. Sections start their primary
 *   content at 280ms. The rhythm is identical everywhere on purpose.
 *
 * Leads are tagged data-lead (audit harness measures their line counts) and
 * capped at the prose measure with text-wrap: pretty.
 */
export function SectionHeader({
  eyebrow,
  segments,
  lead,
  headingId,
  align = "center",
  afterHeadline,
  className = "",
}: {
  eyebrow: ReactNode;
  segments: HeadlineSegment[];
  lead?: ReactNode;
  headingId: string;
  align?: "center" | "left";
  /** Optional decoration rendered between headline and lead (EyebrowRule). */
  afterHeadline?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex flex-col ${align === "center" ? "items-center" : "items-start"} ${className}`}>
      <Reveal delay={0}>
        <OrnamentalEyebrow variant={align === "center" ? "centered" : "left"}>{eyebrow}</OrnamentalEyebrow>
      </Reveal>
      <Reveal delay={90} className={align === "center" ? "self-stretch" : ""}>
        <TwoToneHeadline id={headingId} segments={segments} align={align} className="mt-mk-eyebrow" />
        {afterHeadline}
      </Reveal>
      {lead && (
        <Reveal delay={180}>
          <p
            data-lead
            className={`mt-mk-headline max-w-measure-prose text-pretty text-mk-lead text-muted ${
              align === "center" ? "text-center" : "text-left"
            }`}
          >
            {lead}
          </p>
        </Reveal>
      )}
    </div>
  );
}
