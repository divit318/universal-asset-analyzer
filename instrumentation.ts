import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // Server-side error tracking (no-op without SENTRY_DSN). nodejs-only is
  // intentional: the app has no middleware or edge routes, so there is no
  // edge config to load.
  await import("./sentry.server.config");

  // Dynamic import AFTER the runtime check: lib/monitor.ts transitively reaches
  // lib/db.ts (node:sqlite), which must never be bundled for the edge runtime.
  const { startMonitorScheduler } = await import("@/lib/monitor");
  startMonitorScheduler();

  const { startScannerScheduler } = await import("@/lib/scanner/scheduler");
  startScannerScheduler();
}

// Captures errors from Server Components, route handlers, and streaming
// renders — the paths a per-route try/catch can't see.
export const onRequestError = Sentry.captureRequestError;
