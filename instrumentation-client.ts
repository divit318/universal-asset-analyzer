// Client-side Sentry init (Next.js loads this file automatically in the
// browser bundle). No-op unless NEXT_PUBLIC_SENTRY_DSN is set — see
// sentry.server.config.ts for the rationale.
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 0,
  environment: process.env.NODE_ENV,
});

// Required export for App Router navigation instrumentation.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
