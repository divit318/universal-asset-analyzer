import type { HTMLAttributes } from "react";

type CardVariant = "default" | "highlight" | "flat";
type CardPadding = "none" | "sm" | "md" | "lg";

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: CardVariant;
  padding?: CardPadding;
  interactive?: boolean;
  /** Animate in with the shared fade+rise reveal (opt-in; lists should stagger via the parent instead). */
  animate?: boolean;
  children?: React.ReactNode;
}

const PADDING: Record<CardPadding, string> = {
  none: "",
  sm: "p-4",
  md: "p-5",
  lg: "p-6",
};

const VARIANT: Record<CardVariant, string> = {
  default: "border-border",
  highlight: "border-brand/30",
  flat: "border-border shadow-none",
};

export function Card({
  variant = "default",
  padding = "lg",
  interactive = false,
  animate = false,
  className = "",
  children,
  ...props
}: CardProps) {
  const classes = [
    "relative overflow-hidden rounded-card border bg-surface shadow-card",
    VARIANT[variant],
    PADDING[padding],
    interactive
      ? "cursor-pointer transition-[transform,border-color,background-color,box-shadow] duration-200 hover:-translate-y-0.5 hover:border-border-strong hover:bg-surface-2 hover:shadow-popover"
      : "",
    animate ? "animate-fade-rise" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={classes} {...props}>
      {children}
    </div>
  );
}
