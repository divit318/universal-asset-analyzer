import type { ReactNode, SVGProps } from "react";

/**
 * The Terminus Mark icon set — UAA's nav/module icons, derived from the
 * Convergence Point logo rather than borrowed from a generic icon pack.
 * Every glyph is an ordinary, legible pictograph (closest to Lucide's own
 * restraint); the one deliberate brand signature is that every circle/dot
 * a conventional icon would use is a rotated square (a diamond) instead,
 * always filled with the brand accent. Ink strokes use `currentColor` so
 * they inherit the surrounding text color exactly like the Lucide icons
 * they replace; the diamond is always `var(--brand)`, matching the
 * LoadingMark's own terminus.
 *
 * See app/_components/nav-config.ts for where each icon is assigned to a
 * nav tool, and the "UAA — Icon System" design exploration for the full
 * rationale (eight directions considered; this one — "The Terminus Mark" —
 * was picked for lowest recognition risk).
 */

type IconProps = SVGProps<SVGSVGElement>;

function Diamond({ cx, cy, s }: { cx: number; cy: number; s: number }) {
  return (
    <rect
      x={cx - s / 2}
      y={cy - s / 2}
      width={s}
      height={s}
      fill="var(--brand)"
      transform={`rotate(45 ${cx} ${cy})`}
    />
  );
}

function Base({ children, ...props }: IconProps & { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" {...props}>
      {children}
    </svg>
  );
}

export function ResearchIcon(props: IconProps) {
  return (
    <Base {...props}>
      <circle cx={10.5} cy={10.5} r={5.2} fill="none" stroke="currentColor" strokeWidth={1.6} />
      <line x1={14.4} y1={14.4} x2={19} y2={19} stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" />
      <Diamond cx={10.5} cy={10.5} s={2.4} />
    </Base>
  );
}

export function CompareIcon(props: IconProps) {
  return (
    <Base {...props}>
      <line x1={8} y1={6} x2={8} y2={20} stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeOpacity={0.85} />
      <line x1={16} y1={6} x2={16} y2={20} stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" />
      <Diamond cx={12} cy={13} s={2.6} />
    </Base>
  );
}

export function DcfIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M5,17 L9,11 L13,14 L19,6" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
      <Diamond cx={19} cy={6} s={2.4} />
    </Base>
  );
}

export function IcReportIcon(props: IconProps) {
  return (
    <Base {...props}>
      <rect x={6} y={4} width={12} height={16} rx={1.2} fill="none" stroke="currentColor" strokeWidth={1.5} />
      <line x1={8.5} y1={9} x2={15.5} y2={9} stroke="currentColor" strokeWidth={1.3} strokeOpacity={0.6} />
      <line x1={8.5} y1={12.5} x2={15.5} y2={12.5} stroke="currentColor" strokeWidth={1.3} strokeOpacity={0.6} />
      <Diamond cx={9.5} cy={16.7} s={2.2} />
    </Base>
  );
}

export function QuantEngineIcon(props: IconProps) {
  return (
    <Base {...props}>
      <rect x={5} y={13} width={4} height={7} rx={0.6} fill="currentColor" fillOpacity={0.55} />
      <rect x={10} y={8} width={4} height={12} rx={0.6} fill="currentColor" fillOpacity={0.8} />
      <rect x={15} y={10.5} width={4} height={9.5} rx={0.6} fill="currentColor" />
      <Diamond cx={17} cy={7.4} s={2.2} />
    </Base>
  );
}

export function PortfolioIcon(props: IconProps) {
  return (
    <Base {...props}>
      <circle cx={12} cy={12} r={7.6} fill="none" stroke="currentColor" strokeWidth={1.6} />
      <path d="M12,4.4 A7.6,7.6 0 0 1 18.8,15.2 L12,12 Z" fill="currentColor" fillOpacity={0.7} />
      <Diamond cx={12} cy={12} s={2.6} />
    </Base>
  );
}

export function WireIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M3,13 Q7,5 11,13 T19,13" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" />
      <Diamond cx={19} cy={13} s={2.2} />
    </Base>
  );
}

export function ScreenerIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M4,5 L20,5 L13.5,13.5 L13.5,19 L10.5,20.5 L10.5,13.5 Z" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round" />
      <Diamond cx={12} cy={12.5} s={2.2} />
    </Base>
  );
}

export function DiscoverIcon(props: IconProps) {
  return (
    <Base {...props}>
      <circle cx={12} cy={12} r={8} fill="none" stroke="currentColor" strokeWidth={1.6} />
      <polygon points="15,9 12.8,12.8 9,15 11.2,11.2" fill="currentColor" />
      <Diamond cx={12} cy={12} s={1.8} />
    </Base>
  );
}

export function WatchlistIcon(props: IconProps) {
  return (
    <Base {...props}>
      <polygon
        points="12,4.5 13.8,9.8 19.5,9.9 14.9,13.3 16.5,18.7 12,15.4 7.5,18.7 9.1,13.3 4.5,9.9 10.2,9.8"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.4}
        strokeLinejoin="round"
      />
      <Diamond cx={12} cy={11.5} s={2.2} />
    </Base>
  );
}

export function CalendarIcon(props: IconProps) {
  return (
    <Base {...props}>
      <rect x={4} y={5} width={16} height={15} rx={1.5} fill="none" stroke="currentColor" strokeWidth={1.5} />
      <line x1={8} y1={3.5} x2={8} y2={6.5} stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" />
      <line x1={16} y1={3.5} x2={16} y2={6.5} stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" />
      <line x1={4} y1={9} x2={20} y2={9} stroke="currentColor" strokeWidth={1.2} strokeOpacity={0.5} />
      <Diamond cx={9} cy={14} s={2} />
    </Base>
  );
}

export function JournalIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M6,18 L6,21 L9,21 L18,12 L15,9 Z" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinejoin="round" />
      <Diamond cx={16.5} cy={10.5} s={1.8} />
    </Base>
  );
}

export function ThematicIcon(props: IconProps) {
  return (
    <Base {...props}>
      <circle cx={5} cy={12} r={1.6} fill="none" stroke="currentColor" strokeWidth={1.3} />
      <circle cx={12} cy={6} r={1.4} fill="none" stroke="currentColor" strokeWidth={1.3} strokeOpacity={0.8} />
      <circle cx={12} cy={18} r={1.4} fill="none" stroke="currentColor" strokeWidth={1.3} strokeOpacity={0.8} />
      <line x1={6.3} y1={11} x2={10.7} y2={7} stroke="currentColor" strokeWidth={1.2} strokeOpacity={0.5} />
      <line x1={6.3} y1={13} x2={10.7} y2={17} stroke="currentColor" strokeWidth={1.2} strokeOpacity={0.5} />
      <line x1={13.3} y1={7} x2={17.5} y2={11} stroke="currentColor" strokeWidth={1.2} strokeOpacity={0.5} />
      <line x1={13.3} y1={17} x2={17.5} y2={13} stroke="currentColor" strokeWidth={1.2} strokeOpacity={0.5} />
      <Diamond cx={19} cy={12} s={2.2} />
    </Base>
  );
}

/**
 * Exposure — three routes of different weight converging on one holding.
 *
 * Replaces the old KnowledgeGraphIcon, a ring of four equal circles joined by
 * equal lines. That drawing was an accurate summary of the feature it labelled
 * (undifferentiated entities, undifferentiated relationships) and the wrong
 * picture for this one: here the whole point is that the routes have different
 * magnitudes and they all arrive at the same place.
 */
export function ExposureIcon(props: IconProps) {
  return (
    <Base {...props}>
      <line x1={4} y1={4.5} x2={4} y2={19.5} stroke="currentColor" strokeWidth={1.3} />
      <path d="M4.8 6.5 C 10 6.5, 12 11, 17.2 11" fill="none" stroke="currentColor" strokeWidth={2.4} strokeOpacity={0.85} strokeLinecap="round" />
      <path d="M4.8 12 C 10 12, 12 12, 17.2 12" fill="none" stroke="currentColor" strokeWidth={1.4} strokeOpacity={0.55} strokeLinecap="round" />
      <path d="M4.8 17.5 C 10 17.5, 12 13, 17.2 13" fill="none" stroke="currentColor" strokeWidth={0.9} strokeOpacity={0.4} strokeLinecap="round" />
      <Diamond cx={19.4} cy={12} s={2.4} />
    </Base>
  );
}
