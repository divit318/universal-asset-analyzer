import type { ButtonHTMLAttributes } from "react";

type ButtonVariant = "primary" | "secondary" | "ghost" | "destructive";
type ButtonSize = "xs" | "sm" | "md";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  children?: React.ReactNode;
}

const VARIANT: Record<ButtonVariant, string> = {
  primary:
    "bg-brand-strong text-background shadow-sm hover:brightness-110 disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-brand/50",
  secondary:
    "border border-border bg-surface text-foreground hover:border-border-strong hover:bg-surface-2 disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-brand/40",
  ghost:
    "text-muted hover:bg-surface-2 hover:text-foreground disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-brand/30",
  destructive:
    "border border-negative/30 bg-negative/10 text-negative hover:bg-negative/20 disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-negative/40",
};

const SIZE: Record<ButtonSize, string> = {
  xs: "rounded-control px-2.5 py-1 text-xs",
  sm: "rounded-control px-3 py-1.5 text-xs",
  md: "rounded-control px-4 py-2 text-sm",
};

export function Button({
  variant = "secondary",
  size = "md",
  className = "",
  disabled,
  children,
  ...props
}: ButtonProps) {
  const classes = [
    "inline-flex shrink-0 items-center justify-center gap-1.5 font-medium outline-none transition-[color,background-color,border-color,filter,box-shadow,transform] duration-150",
    !disabled && "active:scale-[0.97]",
    VARIANT[variant],
    SIZE[size],
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button className={classes} disabled={disabled} {...props}>
      {children}
    </button>
  );
}
