import type { LucideIcon } from "lucide-react";

/**
 * IconTile — the landing page's icon container. Two shapes: "circle" (48px)
 * and "square" (52px, 12px radius). Two tones: "brand" (brass glyph on a 10%
 * brass fill with an 18% brass border) and "neutral" (muted glyph on a muted
 * fill — the local-first comparison's lesser card).
 */
export function IconTile({
  icon: Icon,
  shape = "circle",
  tone = "brand",
  className = "",
}: {
  icon: LucideIcon;
  shape?: "circle" | "square";
  tone?: "brand" | "neutral";
  className?: string;
}) {
  const shapeClass = shape === "circle" ? "h-12 w-12 rounded-full" : "h-[52px] w-[52px] rounded-xl";
  const toneClass =
    tone === "brand" ? "border-brand/18 bg-brand/10 text-brand" : "border-border bg-surface-3 text-muted";
  return (
    <span
      aria-hidden="true"
      className={`flex shrink-0 items-center justify-center border ${shapeClass} ${toneClass} ${className}`}
    >
      <Icon className="h-5 w-5" strokeWidth={1.75} />
    </span>
  );
}
