import type { ReactNode, CSSProperties } from "react";

interface RevealProps {
  /** Position in the sequence — each step adds another 60ms of delay. */
  index: number;
  className?: string;
  children: ReactNode;
}

/**
 * Shared stagger primitive for progressive reveal: wraps the shipped
 * `.animate-fade-rise` (app/globals.css) with a computed delay so a page's
 * sections/cards/rows arrive in order as their data lands, instead of
 * popping in together or waiting behind a full-page skeleton. Governed by
 * the same reduced-motion rule the rest of the app's animations use.
 */
export function Reveal({ index, className = "", children }: RevealProps) {
  return (
    <div
      className={`animate-fade-rise ${className}`}
      style={{ animationDelay: `${index * 60}ms` } as CSSProperties}
    >
      {children}
    </div>
  );
}
