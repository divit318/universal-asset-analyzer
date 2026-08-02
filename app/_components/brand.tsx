import Link from "next/link";
import type { CSSProperties } from "react";
import {
  MARK_BARS,
  MARK_BAR_HEIGHT,
  MARK_BAR_RADIUS,
  MARK_TERMINUS,
  MARK_VIEWBOX,
} from "@/lib/brand/mark";
import { LoadingMark } from "./loading-mark";

/**
 * The UAA logo, as components. The ONLY sanctioned way to draw the brand.
 *
 * ── The rules ───────────────────────────────────────────────────────────────
 * 1. Never hand-roll the mark. No `◆`, no `<Diamond/>`, no inline `<svg>`. Both
 *    headers used to fake it with the Unicode glyph U+25C6, which meant the real
 *    logo appeared nowhere in the app's chrome.
 * 2. Never set width/height directly. Pick a `size` token. The mark is a 32×32
 *    square with balanced optical padding, and it is drawn on that grid at every
 *    size — so it can never be stretched, and never lands on a half-pixel from
 *    an arbitrary `h-[19px]`.
 * 3. Never recolour the terminus. Ink is `currentColor` (so the mark inherits
 *    the text colour of wherever it sits, in either theme, with no per-theme
 *    variants); the terminus is always `var(--brand)`. `tone="mono"` is the one
 *    exception, for the rare surface where a colour accent would compete.
 * 4. One lockup per view. `<BrandLockup>` belongs in chrome (app header,
 *    marketing header, footer). Inside a page, use the bare `<BrandMark>` and
 *    only at a genuine brand moment — a boot splash, an empty state, a
 *    first-run panel. A logo beside every `<h1>` is noise, not branding.
 * 5. Clear space is at least half the mark's height on every side. The `size`
 *    tokens' companion `gap` values below already satisfy this inside a lockup.
 * 6. When the wordmark has to go (phones), the mark steps UP a size. A 22px mark
 *    stranded to the left of six 18px icon buttons reads as a seventh button, not
 *    as a logo; at 28px it is unambiguously the largest thing in the bar. This is
 *    handled inside `<BrandLockup wordmark="sm-up">` — do not reimplement it.
 *
 * ── Sizes ───────────────────────────────────────────────────────────────────
 * Six steps, no in-betweens:
 *   xs (14) inline with body text · sm (18) dense chrome, mobile header
 *   md (22) the default; app + marketing header lockup
 *   lg (28) footer, dialog and panel headers
 *   xl (44) empty states, first-run and zero-data panels
 *   hero (96) the boot splash and the marketing hero only
 *
 * See docs/BRAND.md for the full identity spec, and lib/brand/mark.ts for the
 * geometry every one of these shares with `<LoadingMark>` and the app icons.
 */

export type BrandMarkSize = "xs" | "sm" | "md" | "lg" | "xl" | "hero";

const MARK_PX: Record<BrandMarkSize, number> = {
  xs: 14,
  sm: 18,
  md: 22,
  lg: 28,
  xl: 44,
  hero: 96,
};

/** Mark-to-wordmark gap and wordmark type scale, paired to each mark size. */
const LOCKUP_STYLE: Record<BrandMarkSize, { gap: string; text: string }> = {
  xs: { gap: "gap-1.5", text: "text-xs" },
  sm: { gap: "gap-2", text: "text-[13px]" },
  md: { gap: "gap-2.5", text: "text-sm" },
  lg: { gap: "gap-3", text: "text-base" },
  xl: { gap: "gap-4", text: "text-xl" },
  hero: { gap: "gap-5", text: "text-3xl" },
};

interface BrandMarkProps {
  size?: BrandMarkSize;
  /**
   * `brand` (default) — ink follows `currentColor`, terminus is `var(--brand)`.
   * `mono` — everything follows `currentColor`, for surfaces already carrying a
   * brand-coloured accent that the terminus would compete with.
   */
  tone?: "brand" | "mono";
  className?: string;
  /**
   * Screen-reader name. Omit on decorative marks that sit next to a wordmark or
   * a heading which already names the product — a lockup must not announce
   * "Universal Asset Analyzer" twice.
   */
  label?: string;
}

/**
 * The logo mark alone — four converging bars resolving into the brand diamond.
 * Resolved by definition: the unrotated-square variant means "still working"
 * and belongs only to `<LoadingMark>`.
 */
export function BrandMark({ size = "md", tone = "brand", className = "", label }: BrandMarkProps) {
  const px = MARK_PX[size];
  return (
    <svg
      viewBox={`0 0 ${MARK_VIEWBOX} ${MARK_VIEWBOX}`}
      width={px}
      height={px}
      fill="none"
      className={`uaa-brand-mark shrink-0 ${className}`}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {MARK_BARS.map((bar, i) => (
        <rect
          key={i}
          className="brand-bar"
          x={bar.x}
          y={bar.y}
          width={bar.width}
          height={MARK_BAR_HEIGHT}
          rx={MARK_BAR_RADIUS}
          fill="currentColor"
          style={{ "--mark-rest": bar.opacity } as CSSProperties}
        />
      ))}
      <rect
        className="brand-terminus"
        x={MARK_TERMINUS.x}
        y={MARK_TERMINUS.y}
        width={MARK_TERMINUS.size}
        height={MARK_TERMINUS.size}
        rx={MARK_TERMINUS.radius}
        fill={tone === "mono" ? "currentColor" : "var(--brand)"}
      />
    </svg>
  );
}

/**
 * The wordmark. Monospace and lowercase, matching the app's data typography
 * rather than a marketing display face — the slash is a path separator, which is
 * the joke: the product is a tool, not a brand campaign.
 *
 * Deliberately NOT its own export: a wordmark without the mark is not an
 * approved form of the logo. Use `<BrandLockup>`.
 */
function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`font-mono font-semibold leading-none tracking-tight ${className}`}>
      <span className="text-foreground">asset</span>
      <span className="text-faint">/</span>
      <span className="text-foreground">analyzer</span>
    </span>
  );
}

/** One step up the scale, for the wordmark-less phone form. See rule 6. */
const NEXT_SIZE_UP: Record<BrandMarkSize, BrandMarkSize> = {
  xs: "sm",
  sm: "md",
  md: "lg",
  lg: "xl",
  xl: "hero",
  hero: "hero",
};

interface BrandLockupProps {
  size?: BrandMarkSize;
  /** Renders as a `next/link` when set. Chrome lockups should link home. */
  href?: string;
  /**
   * `always` (default) shows the wordmark at every width; `sm-up` drops it below
   * 640px so a cramped mobile header keeps the mark rather than eliding both.
   * The mark is never the thing that gets dropped — and when the wordmark goes,
   * the mark grows one step so it still outranks the icon buttons beside it.
   */
  wordmark?: "always" | "sm-up" | "never";
  /** Optional descriptor beneath the lockup — footers and splash screens only. */
  tagline?: string;
  className?: string;
}

/**
 * Mark + wordmark, horizontally locked. The canonical signature of the product;
 * use this in chrome, and only once per view.
 */
export function BrandLockup({
  size = "md",
  href,
  wordmark = "always",
  tagline,
  className = "",
}: BrandLockupProps) {
  const { gap, text } = LOCKUP_STYLE[size];

  // Two marks rather than responsive width/height utilities: the mark's px size
  // is a token (rule 2), and `h-[28px] sm:h-[22px]` would smuggle raw values back
  // in. One <svg> is ~500 bytes and only one is ever painted.
  const inner =
    wordmark === "sm-up" ? (
      <>
        <BrandMark size={NEXT_SIZE_UP[size]} className="sm:hidden" />
        <BrandMark size={size} className="hidden sm:block" />
        <Wordmark className={`${text} hidden sm:inline`} />
      </>
    ) : (
      <>
        <BrandMark size={size} />
        {wordmark === "always" && <Wordmark className={text} />}
      </>
    );

  // `aria-label` on the whole lockup, rather than letting the wordmark's own
  // text be the accessible name: "asset/analyzer" is not what the product is
  // called, and a screen-reader user deserves the real name.
  const shared = {
    "aria-label": "Universal Asset Analyzer",
    className: `uaa-brand-lockup inline-flex items-center ${gap} outline-none focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:rounded-control ${className}`,
  };

  const lockup = href ? (
    <Link href={href} {...shared}>
      {inner}
    </Link>
  ) : (
    <span {...shared}>{inner}</span>
  );

  if (!tagline) return lockup;

  return (
    <span className="inline-flex flex-col gap-2">
      {lockup}
      <span className="text-caption text-muted">{tagline}</span>
    </span>
  );
}

/**
 * A brand moment: the mark, centred, over a message. For empty states, zero-data
 * panels and first-run surfaces — the places where a page has nothing of its own
 * to show, which are exactly the places that used to render as an anonymous grey
 * paragraph with no indication of what product you were looking at.
 *
 * `loading` is not cosmetic. The mark's terminus is a diamond when resolved and a
 * square while working, and that distinction is the only meaning the geometry
 * carries — so an "empty because we are still fetching" state showing the
 * resolved logo actively lies. Pass `loading` whenever the emptiness is
 * temporary and something is in flight (the screener's universe build is the
 * canonical case) and the mark animates instead.
 */
export function BrandEmptyState({
  title,
  detail,
  loading = false,
  children,
  className = "",
}: {
  title: string;
  detail?: string;
  loading?: boolean;
  /** Actions, badges, or anything else the surface wants under the message. */
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex flex-col items-center gap-3 px-6 py-12 text-center ${className}`}>
      {/* `text-muted`, not `text-faint`: the mark's own bars are already stepped
          down to 0.55-1.0 opacity, so faint ink on top of that put the top two
          bars under a 2:1 contrast ratio and the logo read as a stray blue
          diamond. Every tone choice for the mark has to account for the gradient
          being applied on top of it. */}
      {loading ? (
        <LoadingMark size={MARK_PX.xl} className="text-muted" label={title} />
      ) : (
        <BrandMark size="xl" className="text-muted" />
      )}
      <div className="flex flex-col gap-1.5">
        <p className="text-sm font-medium text-foreground">{title}</p>
        {detail && <p className="mx-auto max-w-md text-xs leading-5 text-muted">{detail}</p>}
      </div>
      {children}
    </div>
  );
}
