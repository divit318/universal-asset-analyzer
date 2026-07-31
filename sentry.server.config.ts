// Server-side Sentry init, loaded from instrumentation.ts (nodejs runtime
// only — this app has no middleware and no edge routes, so there is no
// sentry.edge.config.ts on purpose).
//
// Without SENTRY_DSN this is a no-op: the SDK disables itself when dsn is
// undefined, preserving the repo rule that every env var has a safe default.
// Error tracking only — tracing is off to stay inside Sentry's free tier and
// because errors, not performance, are what the Devin triage loop consumes
// (docs/devin-integration.md).
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 0,
  environment: process.env.NODE_ENV,
});
