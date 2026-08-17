/**
 * The investment verdict, streamed — client side.
 *
 * ## What this replaces
 *
 * The research page used to drive the verdict with a hand-rolled
 * `useEffect` + `fetch("/api/ai/verdict")` + two `useState` slots. Measured on a
 * single load of `/research?symbol=NVDA`, that produced:
 *
 *   - **three concurrent `/api/ai/verdict` requests**, because the effect keyed
 *     on a portfolio-fit value that transitions `null → score` as the IOS
 *     profile loads, and nothing aborted the superseded requests;
 *   - **three full inferences**, because the then-local backend serialized
 *     generations, so the duplicates did not race — they queued, and the total
 *     wait became the sum of all three (~4 minutes to first content);
 *   - a 210px shimmer in the most valuable position on the page for that entire
 *     time, with no partial output.
 *
 * ## What this does instead
 *
 * 1. **Fires once.** The request waits until the portfolio profile has settled
 *    (`enabled`), so the personalized verdict is the *only* verdict generated.
 *    The old "generic first, personalized second" progressive enhancement cost a
 *    whole extra inference on a serialized single-model backend to show a
 *    verdict that was about to be replaced.
 * 2. **Aborts.** Switching symbols aborts the in-flight stream, so a slow
 *    response for the previous symbol can never land on the new one.
 * 3. **Deduplicates.** A re-render with an unchanged key does not restart the
 *    stream; the key is compared against the one already running.
 * 4. **Renders progressively.** Fields are surfaced the instant they close, so
 *    the headline appears in ~4s instead of everything appearing in ~40s.
 *
 * The object it exposes is shaped like a complete `InvestmentVerdict` from the
 * first field onward (missing fields carry empty defaults), so components that
 * only want the finished thing keep working unchanged, while components that
 * want to shimmer the not-yet-arrived parts can consult `received`.
 */

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { InvestmentVerdict } from "../verdict";
import type { ReportSectionId } from "../report-sections";

export type VerdictStatus = "idle" | "waiting" | "connecting" | "streaming" | "done" | "error";

export interface VerdictStreamState {
  /**
   * The verdict so far — non-null from the first arrived field onward. Fields
   * that have not streamed yet hold empty defaults (never fabricated content),
   * so `.catalysts.map()` is always safe.
   */
  verdict: InvestmentVerdict | null;
  /** Which sections have arrived. Drives per-section shimmering. */
  received: ReadonlySet<ReportSectionId>;
  status: VerdictStatus;
  /** Wall-clock ms since the request started; 0 before it starts. */
  elapsedMs: number;
  /**
   * Epoch ms when work on the CURRENT symbol's verdict began — set the moment
   * the hook starts waiting on it (gate included), not when the first stream
   * event happens to arrive. Drives a self-ticking elapsed clock in the UI:
   * the old event-driven `elapsedMs` froze at 0:00 for the entire silent
   * phase (gate + context assembly + time-to-first-token), which is exactly
   * the wait it existed to describe. Null when nothing is pending.
   */
  startedAt: number | null;
  /** True until the `done` event lands — i.e. more fields are still coming. */
  streaming: boolean;
  error: string | null;
  /** Re-run the generation, bypassing the "already ran this key" guard. */
  retry: () => void;
}

const EMPTY_VERDICT: Omit<InvestmentVerdict, "model" | "generatedAt"> = {
  verdict: "neutral",
  headline: "",
  tension: "",
  thesis: "",
  catalysts: [],
  risks: [],
  triggers: [],
  confidence: "low",
  timeHorizon: "medium-term",
  keyMetrics: [],
};

interface ManifestEvent {
  type: "manifest";
  symbol: string;
  name: string;
  assetClass: string;
  warnings: string[];
  sections: { id: ReportSectionId; title: string; order: number }[];
}
interface SectionEvent {
  type: "section";
  id: ReportSectionId;
  title: string;
  order: number;
  data: unknown;
  elapsedMs: number;
}
interface DoneEvent {
  type: "done";
  verdict: InvestmentVerdict;
  model: string;
  durationMs: number;
}
interface ErrorEvent {
  type: "error";
  error: string;
  completed: string[];
  fallback?: InvestmentVerdict;
}
type StreamEvent = ManifestEvent | SectionEvent | DoneEvent | ErrorEvent;

export interface UseVerdictStreamOptions {
  /**
   * Gate the request. Keep this false until every input that belongs in the
   * prompt is known — a verdict generated from half the context costs exactly
   * as much as the right one and has to be thrown away.
   */
  enabled?: boolean;
}

/**
 * The client-side mirror of the server's STABLE verdict identity
 * (lib/ai/verdict-params.ts stableVerdictIdentity — server-only, it reads the
 * AI-mode file, so it cannot be imported here). Same rule, same reason: the
 * request key keeps every dimension that MATERIALLY changes the verdict and
 * drops the volatile details (fitScore drifts a point on any market tick,
 * `reasons`/`actionReason` are free text quoting live scores). Keying the
 * request on the RAW params meant a background portfolio-report revalidation
 * landing mid-generation re-keyed the stream, ABORTED the in-flight model call
 * seconds from finishing, and started a second full generation of the same
 * thesis — measured live on 2026-08-12 (first generation killed 6.3s in).
 *
 * The volatile params still reach the prompt: the fetch sends the full param
 * set as of the moment the key first fired. Only the RE-KEY decision ignores
 * them, exactly like the server's cache identity.
 */
export function stableRequestIdentity(params: Record<string, string> | null): string {
  if (!params) return "";
  const parts: string[] = [];
  for (const k of ["fitTier", "action", "isInPortfolio", "objective"]) {
    if (params[k]) parts.push(`${k}=${params[k]}`);
  }
  if (params.missingSectors) {
    const sectors = params.missingSectors.split(",").map((s) => s.trim()).filter(Boolean).sort().join(",");
    if (sectors) parts.push(`missingSectors=${sectors}`);
  }
  if (params.suggestedPct) {
    const pct = Number(params.suggestedPct);
    if (Number.isFinite(pct)) parts.push(`suggestedPct=${Math.round(pct)}`);
  }
  return parts.join("&");
}

/**
 * Stream the verdict for `symbol`.
 *
 * `params` carries the portfolio personalization (fitScore, fitTier, …). Its
 * STABLE identity ({@link stableRequestIdentity}) is the request key, so a
 * material change in personalization starts a new generation, while re-renders
 * — or live-data drift in the volatile params — do not.
 */
export function useVerdictStream(
  symbol: string | null,
  params: Record<string, string> | null,
  opts: UseVerdictStreamOptions = {},
): VerdictStreamState {
  const { enabled = true } = opts;

  const [state, setState] = useState<{
    fields: Partial<InvestmentVerdict>;
    received: Set<ReportSectionId>;
    status: VerdictStatus;
    elapsedMs: number;
    startedAt: number | null;
    model: string | null;
    error: string | null;
  }>({ fields: {}, received: new Set(), status: "idle", elapsedMs: 0, startedAt: null, model: null, error: null });

  const abortRef = useRef<AbortController | null>(null);
  /** The key currently running or already completed — the dedupe guard. */
  const ranKeyRef = useRef<string | null>(null);
  /** The symbol the current on-screen fields belong to. Decides whether a key
   *  change is a new SUBJECT (wipe everything) or a params upgrade for the same
   *  subject (keep the rendered content — see below). */
  const shownSymbolRef = useRef<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  const query = symbol
    ? new URLSearchParams({ symbol, ...(params ?? {}) }).toString()
    : null;
  // Keyed on the STABLE identity, not the raw query — see stableRequestIdentity.
  // The fetch itself sends `query`, so the prompt still gets the live numbers.
  const key =
    symbol != null && enabled ? `${symbol}::${stableRequestIdentity(params)}#${attempt}` : null;

  useEffect(() => {
    if (!key || !query) {
      // Not ready yet (the gate is holding). Show "waiting" rather than a
      // spinner that implies work is happening. The clock starts HERE — the
      // gate is part of the wait the user experiences.
      if (symbol && shownSymbolRef.current !== symbol) {
        // The SUBJECT changed while gated: the on-screen verdict belongs to the
        // previous symbol and must not linger under the new one. Abort anything
        // still in flight for it and clear the dedupe guard so a quick
        // A → B → A round trip re-runs A rather than matching its stale key.
        shownSymbolRef.current = symbol;
        ranKeyRef.current = null;
        abortRef.current?.abort();
        setState({ fields: {}, received: new Set(), status: "waiting", elapsedMs: 0, startedAt: Date.now(), model: null, error: null });
      } else if (symbol) {
        setState((s) =>
          s.status === "idle" ? { ...s, status: "waiting", startedAt: s.startedAt ?? Date.now() } : s,
        );
      }
      return;
    }

    // Identical work already running or finished for this exact key.
    if (ranKeyRef.current === key) return;
    ranKeyRef.current = key;

    // Supersede any in-flight generation for a PREVIOUS key. Aborting matters
    // here beyond tidiness: the route forwards the signal into the orchestrator,
    // so this actually stops the inference instead of leaving it to run to
    // completion unobserved while the new one queues behind it.
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const startedAt = Date.now();
    // Same symbol, new params (e.g. the user's portfolio changed under an open
    // page): the sections on screen are still this company's verdict — keep
    // them rendered while the replacement streams in, exactly like a
    // background refresh. Wiping them re-showed a skeleton over content the
    // user was reading and reset the elapsed clock, making one visit look
    // like two failed ones. A NEW symbol is a new subject: everything resets.
    const sameSubject = shownSymbolRef.current === symbol;
    shownSymbolRef.current = symbol;
    setState((s) =>
      sameSubject && Object.keys(s.fields).length > 0
        ? { ...s, status: "connecting", elapsedMs: 0, startedAt, error: null }
        : { fields: {}, received: new Set(), status: "connecting", elapsedMs: 0, startedAt, model: null, error: null },
    );

    void (async () => {
      try {
        const res = await fetch(`/api/ai/report?${query}`, { signal: controller.signal });
        if (!res.ok || !res.body) {
          const detail = await res
            .json()
            .then((j: { error?: string }) => j.error)
            .catch(() => null);
          throw new Error(detail ?? `Report unavailable (${res.status})`);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          // NDJSON: complete lines only. A partial trailing line stays buffered.
          let nl: number;
          while ((nl = buffer.indexOf("\n")) !== -1) {
            const line = buffer.slice(0, nl).trim();
            buffer = buffer.slice(nl + 1);
            if (!line) continue;

            let event: StreamEvent;
            try {
              event = JSON.parse(line) as StreamEvent;
            } catch {
              continue; // never let one malformed frame kill a good stream
            }
            applyEvent(event, setState, startedAt);
          }
        }
      } catch (err) {
        if (controller.signal.aborted) return; // superseded — the new run owns the state
        setState((s) => ({
          ...s,
          status: "error",
          error: err instanceof Error ? err.message : "Could not generate the verdict",
          elapsedMs: Date.now() - startedAt,
        }));
      }
    })();

    // NOTE: deliberately no cleanup-abort here.
    //
    // React StrictMode (on by default in the App Router in dev) mounts, runs the
    // effect, runs cleanup, then runs the effect again. Aborting in cleanup would
    // kill the request started by the first pass, and the `ranKeyRef` guard would
    // then make the second pass a no-op — leaving the UI stuck on its skeleton
    // forever while the server had happily produced a report. Superseded requests
    // are aborted above, when a genuinely new key arrives, and the unmount effect
    // below handles leaving the page.
    // `query` is deliberately NOT a dependency: volatile params (fitScore,
    // reasons) drift with live data without changing the stable key, and the
    // stream must not restart when they do. The fetch reads the query of the
    // render in which the key changed — the live numbers as of first fire.
    // `symbol` IS listed: while the gate holds, key stays null across a symbol
    // change, and the waiting branch must still run to clear the previous
    // subject's verdict.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, symbol]);

  // Abort on unmount so navigating away stops the inference — and CLEAR THE
  // DEDUPE GUARD, because this cleanup also runs during StrictMode's simulated
  // unmount at mount (mount → effects → cleanup → effects again). Aborting
  // without clearing `ranKeyRef` killed the first pass's fetch while the guard
  // made the second pass a no-op: the request was never re-issued and the
  // skeleton sat on screen forever. That was exactly the failure the fetch
  // effect's "no cleanup-abort" note guards against — reintroduced here by the
  // unmount abort until the guard reset below. It only bit once the readiness
  // gate became fast enough (persisted portfolio report) to be OPEN at mount:
  // a held gate kept `key` null through the StrictMode cycle and masked it.
  // Measured in a real browser (2026-08-12): fetch started at 512ms, aborted
  // at 513ms, never retried — verdict never rendered.
  //
  // With the reset, StrictMode's second pass restarts the stream cleanly (the
  // server's broker coalesces the overlap into one generation), and a real
  // unmount still aborts the inference with nothing left behind to re-run.
  useEffect(
    () => () => {
      ranKeyRef.current = null;
      abortRef.current?.abort();
    },
    [],
  );

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  const hasAnyField = Object.keys(state.fields).length > 0;
  const pending =
    state.status === "waiting" || state.status === "connecting" || state.status === "streaming";

  // The model is only reported by the `done` frame (or by the offline fallback
  // itself, which carries `model: "unavailable"` inside its fields). While the
  // stream is LIVE the model is simply not known yet — and that placeholder
  // must not be the sentinel "unavailable": the hero reads that sentinel as
  // "the AI is offline" and suppresses every streamed section, which silently
  // turned the progressive stream back into wait-for-the-done-frame (measured:
  // thesis streamed at 3.1s, first prose rendered at 5.6s).
  const verdict: InvestmentVerdict | null = hasAnyField
    ? {
        ...EMPTY_VERDICT,
        ...state.fields,
        model: state.fields.model ?? state.model ?? (pending ? "streaming" : "unavailable"),
        generatedAt: state.fields.generatedAt ?? new Date(0).toISOString(),
      }
    : null;

  return {
    verdict,
    received: state.received,
    status: state.status,
    elapsedMs: state.elapsedMs,
    startedAt: pending ? state.startedAt : null,
    streaming: state.status === "connecting" || state.status === "streaming",
    error: state.error,
    retry,
  };
}

type Setter = React.Dispatch<
  React.SetStateAction<{
    fields: Partial<InvestmentVerdict>;
    received: Set<ReportSectionId>;
    status: VerdictStatus;
    elapsedMs: number;
    startedAt: number | null;
    model: string | null;
    error: string | null;
  }>
>;

function applyEvent(event: StreamEvent, setState: Setter, startedAt: number): void {
  switch (event.type) {
    case "manifest":
      setState((s) => ({ ...s, status: "streaming", elapsedMs: Date.now() - startedAt }));
      return;

    case "section":
      setState((s) => {
        const received = new Set(s.received);
        received.add(event.id);
        return {
          ...s,
          status: "streaming",
          received,
          elapsedMs: event.elapsedMs,
          fields: { ...s.fields, [event.id]: event.data },
        };
      });
      return;

    case "done":
      // The assembled verdict replaces the accumulated fields wholesale: it is
      // the coerced + grounded object, which the raw streamed fields are not.
      setState((s) => ({
        ...s,
        status: "done",
        fields: event.verdict,
        received: new Set(Object.keys(event.verdict) as ReportSectionId[]),
        model: event.model,
        elapsedMs: event.durationMs,
        error: null,
      }));
      return;

    case "error":
      setState((s) => ({
        ...s,
        status: "error",
        // A partial report is worth more than a wiped one: keep whatever
        // streamed, and only substitute the offline verdict if nothing did.
        fields: event.fallback && Object.keys(s.fields).length === 0 ? event.fallback : s.fields,
        error: event.error,
        elapsedMs: Date.now() - startedAt,
      }));
      return;
  }
}
