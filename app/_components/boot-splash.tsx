"use client";

import { useEffect, useRef, useState } from "react";
import { LoadingMark } from "./loading-mark";
import { useBootState, useTaskSplash } from "./boot-context";
import { BOOT_MESSAGES, type BootContext } from "./boot-messages";
import { MARK_DONE_SEQUENCE_MS, prefersReducedMotion } from "./motion";

const WAVE_CYCLE_MS = 2000; // matches mark-bar-wave / mark-terminus-wave in globals.css
const MESSAGE_INTERVAL_MS = 2400;
const SAFETY_TIMEOUT_MS = 20_000; // never wait forever on a stalled fetch
const EXIT_DURATION_MS = 640; // boot-overlay-dissolve: 260ms delay + 380ms animation, globals.css

type Phase = "loading" | "done" | "exiting" | "hidden";

function useSplashSequence(ready: boolean, onHidden?: () => void) {
  const [phase, setPhase] = useState<Phase>("loading");
  // Set only inside the mount effect below — Date.now() during render is impure.
  const mountedAt = useRef<number | null>(null);
  const scheduled = useRef(false);

  useEffect(() => {
    mountedAt.current = Date.now();
  }, []);

  // loading -> done, aligned to the wave's own cycle boundary so it never cuts
  // a bar mid-fade — unless reduced motion, where there's nothing to align to.
  //
  // `ready` genuinely flickers true -> false -> true on real pages: every
  // loading boolean we're handed (useDataset's isInitialLoading, a stream's
  // `streaming`) starts from an "idle, fetch not even started yet" state that
  // reads as "ready" for one tick, before the fetch effect flips it to a real
  // loading state and back to true once the data actually arrives. `scheduled`
  // must un-arm on that false in between, or the first (false-positive) ready
  // schedules the done transition, gets cancelled when ready flips false, and
  // then never reschedules — the splash stalls forever on the last message.
  useEffect(() => {
    if (phase !== "loading") return;
    const reduced = prefersReducedMotion();

    if (!ready && !reduced) {
      scheduled.current = false;
      return;
    }
    if (scheduled.current) return;
    scheduled.current = true;
    const elapsed = Date.now() - (mountedAt.current ?? Date.now());
    const wait = reduced ? 0 : WAVE_CYCLE_MS - (elapsed % WAVE_CYCLE_MS);
    const t = setTimeout(() => setPhase("done"), wait);
    return () => clearTimeout(t);
  }, [phase, ready]);

  // Independent safety net: force completion if `ready` never arrives (a
  // stalled fetch), so the splash can never wait forever.
  useEffect(() => {
    const t = setTimeout(() => setPhase((p) => (p === "loading" ? "done" : p)), SAFETY_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, []);

  // done -> exiting, after the shipped bar1->bar4->terminus resolve sequence.
  useEffect(() => {
    if (phase !== "done") return;
    const reduced = prefersReducedMotion();
    const t = setTimeout(() => setPhase("exiting"), reduced ? 0 : MARK_DONE_SEQUENCE_MS);
    return () => clearTimeout(t);
  }, [phase]);

  // exiting -> hidden, scheduled rather than driven by the CSS animationend
  // event — reduced motion sets `animation: none` on the exit keyframes (by
  // design, so nothing spins/dissolves for those users), which means the
  // event would simply never fire and permanently strand the splash on
  // screen. A JS timeout, like the other two transitions above, works
  // identically whether or not the CSS animation actually runs.
  useEffect(() => {
    if (phase !== "exiting") return;
    const reduced = prefersReducedMotion();
    const t = setTimeout(() => {
      setPhase("hidden");
      onHidden?.();
    }, reduced ? 0 : EXIT_DURATION_MS);
    return () => clearTimeout(t);
  }, [phase, onHidden]);

  return { phase };
}

function useMessageIndex(messages: string[], holdAtEnd: boolean) {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    if (holdAtEnd && index >= messages.length - 1) return;
    const t = setInterval(() => {
      setIndex((i) => Math.min(i + 1, messages.length - 1));
    }, MESSAGE_INTERVAL_MS);
    return () => clearInterval(t);
  }, [messages, holdAtEnd, index]);
  return messages[Math.min(index, messages.length - 1)] ?? "";
}

function SplashMark({
  context,
  ready,
  onHidden,
}: {
  context: BootContext;
  ready: boolean;
  onHidden?: () => void;
}) {
  const { phase } = useSplashSequence(ready, onHidden);
  const messages = BOOT_MESSAGES[context] ?? BOOT_MESSAGES.generic;
  const message = useMessageIndex(messages, !ready);

  if (phase === "hidden") return null;

  return (
    <div
      className={`uaa-boot-splash${phase === "exiting" ? " is-exiting" : ""}`}
      aria-live="polite"
      aria-busy={phase !== "exiting"}
    >
      <LoadingMark state={phase === "loading" ? "loading" : "done"} size={96} label="Loading Universal Asset Analyzer" />
      <div className="boot-message-line">
        <span key={message} className="boot-message-text">{message}</span>
      </div>
    </div>
  );
}

/** Mounted once from AppShell. Renders the first-load boot splash, the
 * opt-in task splash (IC Report's long AI run), or nothing — never both. */
export function BootSplash() {
  const { showBootSplash, bootContext, bootReady, taskSplash } = useBootState();
  const { hide } = useTaskSplash();

  if (taskSplash) {
    return (
      <SplashMark
        key="task"
        context={taskSplash.context}
        ready={taskSplash.ready}
        onHidden={hide}
      />
    );
  }

  if (!showBootSplash) return null;

  return <SplashMark key="boot" context={bootContext} ready={bootReady} />;
}
