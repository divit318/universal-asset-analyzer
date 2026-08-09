import type { ReactNode } from "react";

/**
 * OrnamentalEyebrow — the small uppercase brass label that opens every landing
 * section, flanked by thin brass hairlines that fade at their far ends, with a
 * diamond node between rule and text.
 *
 * Variants: "centered" (rules both sides) and "left" (rule on the right only —
 * the Solution section's left-aligned column). EyebrowRule renders the longer
 * decorative rule with a centre node BELOW a headline (Problem).
 */

function Hairline({ direction }: { direction: "toward-text" | "away" }) {
  return (
    <span
      aria-hidden="true"
      className={`h-px w-12 sm:w-16 ${
        direction === "toward-text"
          ? "bg-gradient-to-r from-transparent to-brand"
          : "bg-gradient-to-r from-brand to-transparent"
      }`}
    />
  );
}

function Diamond() {
  return <span aria-hidden="true" className="h-1 w-1 rotate-45 bg-brand" />;
}

export function OrnamentalEyebrow({
  children,
  variant = "centered",
  className = "",
}: {
  children: ReactNode;
  variant?: "centered" | "left";
  className?: string;
}) {
  return (
    <p
      className={`flex items-center gap-2.5 text-mk-eyebrow uppercase text-brand ${
        variant === "centered" ? "justify-center" : "justify-start"
      } ${className}`}
    >
      {variant === "centered" && (
        <>
          <Hairline direction="toward-text" />
          <Diamond />
        </>
      )}
      <span>{children}</span>
      <Diamond />
      <Hairline direction="away" />
    </p>
  );
}

/** The longer decorative rule with a centre node, placed below a headline. */
export function EyebrowRule({ className = "" }: { className?: string }) {
  return (
    <div aria-hidden="true" className={`flex items-center justify-center gap-2 ${className}`}>
      <span className="h-px w-24 bg-gradient-to-r from-transparent to-brand sm:w-40" />
      <span className="h-1.5 w-1.5 rotate-45 border border-brand" />
      <span className="h-px w-24 bg-gradient-to-r from-brand to-transparent sm:w-40" />
    </div>
  );
}
