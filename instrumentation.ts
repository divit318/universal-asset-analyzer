export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // Dynamic import AFTER the runtime check: lib/monitor.ts transitively reaches
  // lib/db.ts (node:sqlite), which must never be bundled for the edge runtime.
  const { startMonitorScheduler } = await import("@/lib/monitor");
  startMonitorScheduler();
}
