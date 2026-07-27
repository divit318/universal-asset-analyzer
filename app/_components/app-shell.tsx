"use client";

import { BootProvider } from "./boot-context";
import { BootSplash } from "./boot-splash";

/** Wraps the whole app once, from the root layout. The boot splash overlays
 * {children} — it never gates or replaces it, so the real page is always
 * already mounted underneath by the time the splash dissolves away. */
export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <BootProvider>
      <BootSplash />
      {children}
    </BootProvider>
  );
}
