"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { BootContext } from "./boot-messages";

/* Module state, not sessionStorage — a "use client" module's state survives
 * client-side <Link> navigation (the App Router keeps the root layout mounted
 * across route changes) and only resets on a true browser document reload.
 *
 * This flag is only meaningful in the browser, never during SSR: Next.js's
 * server keeps one long-lived Node process handling many requests, so on the
 * server this same module-level variable would stay latched `true` after the
 * very first request it ever handled — flipping `false` for every hard
 * refresh after that, while a fresh browser tab's own module instance still
 * starts at `false`. Deciding showBootSplash from this flag during the
 * initial render would therefore have the server and the client disagree and
 * fail hydration. So the decision is made in an effect (client-only, after
 * hydration already reconciled against the safe `false` SSR/first-paint
 * value), never in a useState initializer. */
let hasBootedThisDocument = false;

interface TaskSplashState {
  context: BootContext;
  ready: boolean;
}

interface BootState {
  /** Decided once, at BootProvider's first mount this document lifetime. */
  showBootSplash: boolean;
  bootContext: BootContext;
  bootReady: boolean;
  /** Non-null while an explicit long-running task (IC Report) has opted into
   * the same full-screen treatment outside the first-load flow. */
  taskSplash: TaskSplashState | null;
}

interface BootApi {
  state: BootState;
  reportBootReady: (ready: boolean, context: BootContext) => void;
  showTask: (context: BootContext) => void;
  reportTaskReady: () => void;
  hideTask: () => void;
}

const BootCtx = createContext<BootApi | null>(null);

export function BootProvider({ children }: { children: React.ReactNode }) {
  // Safe SSR/first-paint value on both sides of hydration; the real decision
  // is resolved client-only, one effect after mount (see comment above).
  const [showBootSplash, setShowBootSplash] = useState(false);
  useEffect(() => {
    if (!hasBootedThisDocument) {
      hasBootedThisDocument = true;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- whether this is truly the first document load can only be known client-side, after mount; the SSR/first-paint value must stay false on both sides of hydration (see comment above)
      setShowBootSplash(true);
    }
  }, []);
  const [bootContext, setBootContext] = useState<BootContext>("generic");
  const [bootReady, setBootReady] = useState(false);
  const [taskSplash, setTaskSplash] = useState<TaskSplashState | null>(null);

  const reportBootReady = useCallback((ready: boolean, context: BootContext) => {
    setBootContext(context);
    setBootReady(ready);
  }, []);

  const showTask = useCallback((context: BootContext) => {
    setTaskSplash({ context, ready: false });
  }, []);
  const reportTaskReady = useCallback(() => {
    setTaskSplash((cur) => (cur ? { ...cur, ready: true } : cur));
  }, []);
  const hideTask = useCallback(() => {
    setTaskSplash(null);
  }, []);

  const value = useMemo<BootApi>(
    () => ({
      state: { showBootSplash, bootContext, bootReady, taskSplash },
      reportBootReady,
      showTask,
      reportTaskReady,
      hideTask,
    }),
    [showBootSplash, bootContext, bootReady, taskSplash, reportBootReady, showTask, reportTaskReady, hideTask],
  );

  return <BootCtx.Provider value={value}>{children}</BootCtx.Provider>;
}

function useBootApi(): BootApi {
  const ctx = useContext(BootCtx);
  if (!ctx) throw new Error("useBootReady/useTaskSplash must be used within <BootProvider>");
  return ctx;
}

/** Called by whichever page happens to mount during the boot splash, with
 * whatever boolean already means "my primary data arrived" — e.g.
 * `!isInitialLoading` from useDataset, or `!streaming` from useResearchBundle.
 * Safe to call even when the splash isn't showing; the report is just unused. */
export function useBootReady(ready: boolean, context: BootContext) {
  const { reportBootReady } = useBootApi();
  useEffect(() => {
    reportBootReady(ready, context);
  }, [ready, context, reportBootReady]);
}

/** Imperative opt-in for a specific long-running task (the IC Report pipeline)
 * to borrow the same full-screen splash outside the first-load flow. */
export function useTaskSplash() {
  const { showTask, reportTaskReady, hideTask } = useBootApi();
  return { show: showTask, reportReady: reportTaskReady, hide: hideTask };
}

export function useBootState(): BootState {
  return useBootApi().state;
}
