import type { ReactNode } from "react";

/**
 * MockupFrame — the browser-chrome shell around every product mockup. 14px
 * radius, hairline border with a slightly brighter TOP edge (single overhead
 * light source), a soft ambient shadow beneath (--depth-1), a 26px title bar,
 * an app-background body at fixed 16:10, and the standardized ILLUSTRATIVE
 * marker: bottom-right, 12px inset, 30% opacity, identical on every mockup.
 *
 * The marker renders as SVG text: it is a decorative watermark whose 30%
 * opacity is a design requirement; as a DOM text node it would trip the WCAG
 * contrast audit (it is aria-hidden and informationally redundant — the
 * frame's aria-label already says "Illustrative").
 *
 * Everything inside is a STATIC ILLUSTRATIVE COMPONENT with hand-authored
 * sample data: mockups never import product components, never call an API,
 * and never render real market data.
 */
export function MockupFrame({
  children,
  label,
  className = "",
}: {
  children: ReactNode;
  /** Required accessible description of the mockup. */
  label: string;
  className?: string;
}) {
  return (
    <div role="img" aria-label={label} className={`relative ${className}`}>
      {/* Soft ambient glow beneath the frame. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-8 -bottom-6 h-16 rounded-full bg-brand/15 blur-2xl"
      />
      <div className="relative overflow-hidden rounded-[14px] border border-foreground/10 border-t-foreground/20 bg-surface [box-shadow:var(--depth-1)]">
        <div aria-hidden="true" className="flex h-[26px] items-center gap-1.5 border-b border-hairline bg-surface-2 px-3">
          <span className="h-[7px] w-[7px] rounded-full bg-foreground/20" />
          <span className="h-[7px] w-[7px] rounded-full bg-foreground/20" />
          <span className="h-[7px] w-[7px] rounded-full bg-foreground/20" />
        </div>
        <div aria-hidden="true" data-frame-body className="relative aspect-[16/10] overflow-hidden bg-background">
          {/* Dense mockups scroll horizontally at narrow widths rather than
              shrinking type below legibility. */}
          <div className="h-full w-full overflow-x-auto overflow-y-hidden">
            <div className="h-full min-w-[480px]">{children}</div>
          </div>
          <svg
            data-illustrative
            aria-hidden="true"
            className="pointer-events-none absolute bottom-3 right-3 h-[9px] w-[76px] opacity-30"
            viewBox="0 0 76 9"
          >
            <text
              x="76"
              y="8"
              textAnchor="end"
              className="fill-foreground font-sans"
              fontSize="8"
              letterSpacing="1.5"
            >
              ILLUSTRATIVE
            </text>
          </svg>
        </div>
      </div>
    </div>
  );
}
