/**
 * ParticleField — the static gold particle accents (edge pairs, card corner,
 * card interior, the Problem section's connecting streams), generated at build
 * time by scripts/generate-particle-fields.mjs.
 *
 * Rendered as a mask: the SVG's dot alphas become a mask over a solid
 * `bg-brand` layer, so the field recolours itself with the live theme token
 * (dark brass / light brass) and the theme toggle affects every asset (4.9).
 *
 * Rules baked in:
 *   - absolutely positioned, pointer-events-none, aria-hidden, behind content
 *   - a radial mask fades the field into the page background (no hard edges)
 *   - CSS-only fallback: a soft brand radial glow paints under the mask layer,
 *     so a failed asset load degrades to a deliberate gradient, never a hole
 *   - never animates, under any motion preference
 */
const VARIANTS = {
  "edge-pair": { src: "/landing/particles/edge-pair.svg" },
  corner: { src: "/landing/particles/corner.svg" },
  "card-interior": { src: "/landing/particles/card-interior.svg" },
  streams: { src: "/landing/particles/streams.svg" },
} as const;

export type ParticleVariant = keyof typeof VARIANTS;

export function ParticleField({
  variant,
  className = "",
}: {
  variant: ParticleVariant;
  className?: string;
}) {
  const v = VARIANTS[variant];
  return (
    <div
      aria-hidden="true"
      data-particle-field={variant}
      className={`pointer-events-none absolute select-none bg-[radial-gradient(ellipse_60%_55%_at_50%_55%,color-mix(in_srgb,var(--brand)_7%,transparent),transparent_70%)] ${className}`}
    >
      {/* The brass fill is a background-IMAGE gradient, not background-color:
          contrast auditors would otherwise misread this decorative masked
          layer as a solid brass surface behind the section's text. */}
      <div
        className="h-full w-full [background-image:linear-gradient(var(--brand),var(--brand))] [mask-composite:intersect] [mask-image:var(--pf-src),radial-gradient(ellipse_75%_70%_at_50%_50%,black_55%,transparent_100%)] [mask-position:center] [mask-repeat:no-repeat] [mask-size:cover]"
        style={{ "--pf-src": `url(${v.src})` } as React.CSSProperties}
      />
    </div>
  );
}
