"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  Sparkles, X, Send, ArrowRight,
  Search, GitCompare, Calculator, FileText, Briefcase, Bookmark,
  ListFilter, Radar, CalendarDays, Cog, Network, NotebookPen,
  type LucideIcon,
} from "lucide-react";
import type { AppAssistantAction, AppAssistantPageContext, AppAssistantTurn } from "@/lib/ai-app-assistant";
import type { ProactiveInsight } from "@/lib/ai-proactive-insights";
import { describeMutationResults, executeWatchlistAdds } from "./assistant-actions";
import { BrandMark } from "./brand";
import { LoadingMark } from "./loading-mark";
import { PENDING_SCREEN_KEY } from "./screener-handoff";

const DESTINATION_ICON: Record<string, LucideIcon> = {
  research: Search,
  compare: GitCompare,
  dcf: Calculator,
  "ic-report": FileText,
  portfolio: Briefcase,
  watchlist: Bookmark,
  screener: ListFilter,
  calendar: CalendarDays,
  engine: Cog,
  thematic: Network,
  journal: NotebookPen,
  wire: Radar, // matches nav-config's icon for "The Wire" (absorbed the old Scanner)
};

/** How long the "Opening X…" chip holds before a high-confidence action fires —
 * long enough to read, short enough to feel instant rather than laggy. */
const AUTO_NAVIGATE_DELAY_MS = 650;

/** Event other components dispatch to open the assistant (e.g. the header button).
 *  Optionally carries `detail: { question }` — the intel rail uses this to hand
 *  over a fully-formed question so the user never re-explains their context. */
export const OPEN_ASSISTANT_EVENT = "uaa:open-assistant";

interface Turn {
  role: "user" | "assistant";
  content: string;
  suggestions?: string[];
  action?: AppAssistantAction;
  failed?: boolean;
  /** Verified outcome of an executed mutation — rendered as a receipt, and
   * excluded from the Q/A history resent to the model. */
  result?: boolean;
}

/**
 * Empty-state starter questions, keyed by where the user actually is — the
 * panel's first suggestion should read like it noticed the page. Every set
 * mixes one portfolio question (the assistant's newest capability, and
 * otherwise invisible), one page-relevant ask, and one capability probe.
 */
const STARTERS_BY_PREFIX: [prefix: string, starters: string[]][] = [
  ["/portfolio", [
    "How diversified am I?",
    "What are my biggest positions?",
    "What am I most exposed to?",
    "How is my portfolio doing?",
  ]],
  ["/watchlist", [
    "Add a stock to my watchlist",
    "Do I already own anything on my watchlist?",
    "What's the difference between the Watchlist and the Portfolio?",
  ]],
  ["/screener", [
    "Find dividend stocks with a P/E under 15",
    "Screen for something safer than what I own",
    "What can I filter on here?",
  ]],
  ["/research", [
    "Add this stock to my watchlist",
    "Do I already own this stock?",
    "How do I run a valuation on this?",
  ]],
  ["/compare", [
    "Add another company to this comparison",
    "Which of these do I already own?",
  ]],
];

const DEFAULT_STARTERS = [
  "What do I own?",
  "How is my portfolio doing?",
  "What can I do on this page?",
  "What's the difference between the Screener and the Wire?",
];

function startersFor(pathname: string): string[] {
  const match = STARTERS_BY_PREFIX.find(([prefix]) => pathname === prefix || pathname.startsWith(`${prefix}/`));
  return match ? match[1] : DEFAULT_STARTERS;
}

/**
 * Global "how do I…" helper — page-aware, not stock-aware. Deliberately
 * separate from the Research Copilot (deep, symbol-grounded, session-persisted)
 * and the chart workspace's AIDock (chart-selection-scoped): this one only
 * ever knows the current route, via lib/ai-app-assistant.ts.
 */
export function AppAssistant() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  // A mutation is in flight — blocks a second click/auto-fire from writing twice.
  const [executing, setExecuting] = useState(false);
  const [insight, setInsight] = useState<ProactiveInsight | null>(null);
  const [insightDismissed, setInsightDismissed] = useState(false);
  // A question handed over by OPEN_ASSISTANT_EVENT detail (e.g. from an intel
  // card) — asked automatically once the panel is open, so the user arrives
  // mid-conversation instead of at a blank composer.
  const [pendingQuestion, setPendingQuestion] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  /** Whatever had focus before the panel opened — restored on close, so a
   * keyboard user isn't dumped back at the top of the document. */
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const navigateTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firedActions = useRef<Set<number>>(new Set());

  // useLayoutEffect is client-only — avoids SSR issues with createPortal
  useLayoutEffect(() => { setMounted(true); }, []);

  // What's actually loaded on the current page, not just its route — lets
  // "run a DCF on this" or "add TSLA to this comparison" work without the
  // user re-stating a symbol already in view.
  const pageContext = useMemo<AppAssistantPageContext>(() => {
    const symbol = searchParams.get("symbol");
    const symbolsParam = searchParams.get("symbols");
    const tab = searchParams.get("tab");
    const ctx: AppAssistantPageContext = {};
    if (symbol) ctx.symbol = symbol;
    if (symbolsParam) ctx.symbols = symbolsParam.split(",").map((s) => s.trim()).filter(Boolean);
    if (tab) ctx.tab = tab;
    return ctx;
  }, [searchParams]);

  // Fetched once per opening (not polled in the background) — deterministic
  // and cheap, but there's no reason to compute it before the user has
  // actually opened the panel. Re-fires on a later open only if nothing came
  // back last time (no insight yet, not dismissed). A `warming` response
  // means the server is still computing cold caches in the background — one
  // delayed retry picks the result up; the panel never waits on it.
  useEffect(() => {
    if (!open || insight || insightDismissed) return;
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    const load = (attempt: number) => {
      fetch("/api/ai/assistant/insights")
        .then((r) => r.json())
        .then((d: { insights?: ProactiveInsight[]; warming?: boolean }) => {
          if (cancelled) return;
          if (d.insights && d.insights.length > 0) setInsight(d.insights[0]);
          else if (d.warming && attempt < 2) retryTimer = setTimeout(() => load(attempt + 1), 4000);
        })
        .catch(() => {
          // Quiet by design — a failed insights fetch is invisible, not an error.
        });
    };
    load(0);
    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [open, insight, insightDismissed]);

  const goTo = useCallback(
    async (action: AppAssistantAction, turnIndex?: number) => {
      if (navigateTimer.current) clearTimeout(navigateTimer.current);
      if (action.screenerHandoff) {
        try {
          sessionStorage.setItem(PENDING_SCREEN_KEY, JSON.stringify(action.screenerHandoff));
        } catch {
          // sessionStorage can throw in rare privacy-mode configs — navigate
          // anyway, just without the filters preapplied.
        }
      }
      // The mutation executes here — the same moment navigation would
      // otherwise just happen (the auto-fire beat, or a confirm-chip click) —
      // never earlier, so a guessed action never touches the database before
      // the user has actually seen and confirmed it. Every write is awaited
      // and verified; the receipt turn reports what ACTUALLY happened, and
      // navigation only follows a write that landed. The panel stays open so
      // the receipt is readable — closing it would discard the one message
      // that distinguishes "added" from "tried to add".
      if (action.mutation?.kind === "watchlist_add") {
        if (executing) return;
        setExecuting(true);
        try {
          const results = await executeWatchlistAdds(action.mutation.items);
          const { text, allFailed } = describeMutationResults(results);
          // The receipt replaces the offer: the chip that fired is removed so
          // it can't be pressed into a second, identical write.
          setTurns((t) => [
            ...t.map((turn, i) => (i === turnIndex ? { ...turn, action: undefined } : turn)),
            { role: "assistant" as const, content: text, result: true, failed: allFailed },
          ]);
          const firstOk = results.find((r) => r.ok);
          if (firstOk) router.push(`/watchlist?highlight=${encodeURIComponent(firstOk.symbol)}`);
        } finally {
          setExecuting(false);
        }
        return;
      }
      setOpen(false);
      router.push(action.href);
    },
    [router, executing],
  );

  useEffect(() => {
    const onOpen = (e: Event) => {
      const question = (e as CustomEvent<{ question?: string }>).detail?.question;
      if (typeof question === "string" && question.trim()) setPendingQuestion(question.trim());
      setOpen(true);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
      // ⌘J / Ctrl+J — the assistant's keyboard entry point, mirroring the
      // palette's ⌘K. Without it, keyboard users could only reach the panel
      // by tabbing to the header button.
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "j") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener(OPEN_ASSISTANT_EVENT, onOpen);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener(OPEN_ASSISTANT_EVENT, onOpen);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [turns]);

  // Focus follows the panel: opening (button, ⌘J, or a contextual handoff)
  // moves focus into the composer so the user can just type — previously it
  // stayed on <body> and a keyboard user had to tab through the page into the
  // portal. Closing restores focus to wherever it came from. The delay lets
  // the open transition (240ms) start before focus scrolls the panel in.
  useEffect(() => {
    if (open) {
      restoreFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      const t = setTimeout(() => inputRef.current?.focus(), 120);
      return () => clearTimeout(t);
    }
    restoreFocusRef.current?.focus?.();
    restoreFocusRef.current = null;
  }, [open]);

  // A high-confidence action fires on its own after a short beat — long
  // enough to read "Opening Asset Comparison…", short enough to feel
  // instant. Medium/low confidence stays a chip the user has to click
  // (see the render below) rather than auto-navigating on a guess.
  useEffect(() => {
    const i = turns.length - 1;
    const action = turns[i]?.action;
    if (!action || action.confidence !== "high" || firedActions.current.has(i)) return;
    firedActions.current.add(i);
    navigateTimer.current = setTimeout(() => void goTo(action, i), AUTO_NAVIGATE_DELAY_MS);
    return () => {
      if (navigateTimer.current) clearTimeout(navigateTimer.current);
    };
  }, [turns, goTo]);

  const ask = useCallback(
    async (question: string) => {
      const q = question.trim();
      if (!q || loading) return;
      setInput("");
      setLoading(true);
      // Pair each user turn with the assistant ANSWER that followed it,
      // skipping receipts and failures — a "✓ Added…" receipt or an error
      // banner replayed as a model answer misleads the next turn.
      const history: AppAssistantTurn[] = [];
      const conversational = turns.filter((t) => !t.result && !t.failed);
      for (let i = 0; i < conversational.length - 1; i++) {
        if (conversational[i].role === "user" && conversational[i + 1].role === "assistant") {
          history.push({ question: conversational[i].content, answer: conversational[i + 1].content });
          i++;
        }
      }
      setTurns((t) => [...t, { role: "user", content: q }]);
      try {
        const res = await fetch("/api/ai/assistant", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pathname, question: q, history, pageContext }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "Request failed");
        setTurns((t) => [
          ...t,
          { role: "assistant", content: json.answer, suggestions: json.suggestions, action: json.action, failed: json.model === "unavailable" },
        ]);
      } catch (err) {
        setTurns((t) => [
          ...t,
          { role: "assistant", content: err instanceof Error ? err.message : "The assistant request failed — ask again.", failed: true },
        ]);
      } finally {
        setLoading(false);
      }
    },
    [loading, turns, pathname, pageContext],
  );

  // Fire the handed-over question once the panel is open and idle. Runs after
  // `ask` exists; guarded so a re-render mid-request doesn't double-send.
  useEffect(() => {
    if (!open || !pendingQuestion || loading) return;
    const q = pendingQuestion;
    setPendingQuestion(null);
    void ask(q);
  }, [open, pendingQuestion, loading, ask]);

  // The marketing site ships its own chrome and must not inherit the
  // authenticated app's assistant — the same seam SiteHeader applies, kept
  // deliberately identical so both move together when /landing becomes /.
  // Without it the assistant's launcher and its "Assistant" heading rendered
  // on top of the landing page.
  if (pathname === "/landing" || pathname.startsWith("/landing/")) return null;

  // Gate on `mounted`, not on `typeof document`: the latter is false on the
  // client's FIRST render too, so the server emitted nothing while hydration
  // emitted the whole portal — a guaranteed mismatch on every page load, which
  // React resolves by throwing away and re-rendering the tree.
  if (!mounted) return null;

  return createPortal(
    <>
      <div
        className={`fixed inset-0 z-[200] bg-black/40 backdrop-blur-[1px] transition-opacity duration-200 ease-out ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
        onClick={() => setOpen(false)}
        aria-hidden="true"
      />
      <section
        role="dialog"
        aria-modal="true"
        aria-label="AI Assistant"
        // Unfolds from the header trigger's corner rather than sliding in from
        // off-screen — origin-top-right + a small scale/opacity move reads as
        // the panel growing out of the button that opened it.
        className={`fixed inset-y-0 right-0 z-[201] flex w-full max-w-sm origin-top-right flex-col border-l border-border bg-surface shadow-popover transition-[opacity,transform] duration-[240ms] ${
          open ? "translate-y-0 scale-100 opacity-100" : "pointer-events-none -translate-y-2 scale-95 opacity-0"
        }`}
        style={{ transitionTimingFunction: "var(--ease-precise)" }}
      >
        <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-brand" strokeWidth={2} />
            <h2 className="text-sm font-semibold text-foreground">Assistant</h2>
          </div>
          <button
            onClick={() => setOpen(false)}
            aria-label="Close assistant"
            className="rounded-control p-1 text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div ref={scrollRef} className="flex flex-1 flex-col gap-4 overflow-y-auto px-4 py-4">
          {turns.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
              {/* The assistant answers questions *about UAA*, so its resting
                  state is the one place in the panel that should say so. */}
              <BrandMark size="xl" className="text-muted" />
              <p className="max-w-xs text-xs text-muted">
                Ask about your portfolio, jump anywhere in UAA, or manage your watchlist. For deep research on one stock, I&apos;ll hand you to the Research Copilot.
              </p>
              <div className="flex flex-col gap-2">
                {startersFor(pathname).map((s) => (
                  <button
                    key={s}
                    onClick={() => void ask(s)}
                    className="rounded-full border border-border bg-surface-2 px-3 py-1.5 text-xs text-foreground transition-[color,border-color,transform,box-shadow] duration-200 ease-out hover:-translate-y-0.5 hover:scale-[1.03] hover:border-brand hover:text-brand hover:shadow-card"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            turns.map((t, i) => (
              <div
                key={i}
                className={`flex animate-fade-rise flex-col gap-1.5 ${t.role === "user" ? "items-end" : "items-start"}`}
              >
                <div
                  className={`max-w-[85%] rounded-lg px-3 py-2 text-xs leading-relaxed ${t.result ? "whitespace-pre-line" : ""} ${
                    t.role === "user"
                      ? "bg-brand text-background"
                      : t.failed
                        ? "border border-negative/40 bg-negative/10 text-negative"
                        : t.result
                          ? "border border-positive/40 bg-positive/10 text-foreground"
                          : "border border-border bg-surface-2 text-foreground"
                  }`}
                >
                  {t.content}
                </div>
                {t.action && (
                  <DestinationChip action={t.action} onConfirm={(a) => goTo(a, i)} executing={executing} />
                )}
                {t.suggestions && t.suggestions.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {t.suggestions.map((s) => (
                      <button
                        key={s}
                        onClick={() => void ask(s)}
                        className="rounded-full border border-border px-2 py-0.5 text-micro text-muted transition-[color,border-color,transform,box-shadow] duration-200 ease-out hover:-translate-y-0.5 hover:scale-[1.03] hover:border-brand hover:text-brand hover:shadow-card"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))
          )}
          {loading && (
            <div className="flex animate-fade-rise items-center gap-2 self-start rounded-lg border border-border bg-surface-2 px-3 py-2 text-brand">
              <LoadingMark size={16} label="Thinking" />
            </div>
          )}
        </div>

        {/* Quiet, unprompted observation — never a popup, never more than
            one at a time. Sits above the composer so it reads as ambient
            awareness, not a chat message the user has to respond to. */}
        {insight && !insightDismissed && (
          <div className="flex animate-fade-rise items-center gap-2 border-t border-border bg-surface-2/60 px-4 py-2">
            <Sparkles className="h-3 w-3 shrink-0 text-brand" strokeWidth={2} />
            <span className="min-w-0 flex-1 truncate text-xs text-muted" title={insight.text}>
              {insight.text}
            </span>
            <button
              onClick={() => {
                setOpen(false);
                router.push(insight.href);
              }}
              className="shrink-0 text-xs font-medium text-brand transition-opacity hover:opacity-80"
            >
              {insight.linkLabel}
            </button>
            <button
              onClick={() => setInsightDismissed(true)}
              aria-label="Dismiss"
              className="shrink-0 text-muted transition-colors hover:text-foreground"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        )}

        <div className="border-t border-border p-3">
          <div className="flex items-end gap-2 rounded-lg border border-border bg-surface-2 px-3 py-2 focus-within:border-brand">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void ask(input);
                }
              }}
              rows={1}
              disabled={loading}
              placeholder="Ask how to use UAA…"
              className="max-h-24 flex-1 resize-none bg-transparent text-sm text-foreground placeholder:text-muted focus:outline-none disabled:opacity-60"
            />
            <button
              onClick={() => void ask(input)}
              disabled={!input.trim() || loading}
              aria-label="Send"
              className="rounded-md bg-brand p-1.5 text-background transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              <Send className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </section>
    </>,
    document.body,
  );
}

/**
 * The action the assistant is taking (or offering to take). High confidence
 * renders "about to happen" — glowing border, pulsing icon — since
 * AppAssistant's auto-navigate effect will fire it shortly; clicking jumps
 * immediately instead of waiting out the beat. Medium/low confidence looks
 * like an ordinary chip the user has to choose to press — no auto-navigate,
 * no glow, since the destination is a guess.
 *
 * Every confidence tier shows `action.label`, which for a mutation names the
 * exact instrument(s) ("Add Tesla, Inc. (TSLA) to Watchlist"). The old chip
 * collapsed non-high confidence to a bare "Open Watchlist" — which is exactly
 * the case where the resolution is least certain, so clicking what looked
 * like plain navigation silently wrote the least-trustworthy guess.
 */
function DestinationChip({
  action,
  onConfirm,
  executing,
}: {
  action: AppAssistantAction;
  onConfirm: (action: AppAssistantAction) => void | Promise<void>;
  executing: boolean;
}) {
  const Icon = DESTINATION_ICON[action.destination] ?? ArrowRight;
  const pending = action.confidence === "high";
  const disabled = executing && !!action.mutation;

  return (
    <button
      onClick={() => void onConfirm(action)}
      disabled={disabled}
      className={`group flex items-center gap-2 self-start rounded-full border px-3 py-1.5 text-xs font-medium transition-[color,border-color,transform,box-shadow] duration-200 ease-out hover:-translate-y-0.5 hover:scale-[1.03] disabled:pointer-events-none disabled:opacity-60 ${
        pending
          ? "animate-fade-rise border-brand/40 bg-brand-muted text-brand shadow-glow-brand"
          : "border-border bg-surface-2 text-foreground hover:border-brand hover:text-brand hover:shadow-card"
      }`}
    >
      <Icon className={`h-3.5 w-3.5 ${pending || disabled ? "animate-pulse" : ""}`} strokeWidth={2} />
      {disabled ? "Adding…" : action.label}
      <ArrowRight className="h-3 w-3 shrink-0 transition-transform duration-200 ease-out group-hover:translate-x-0.5" strokeWidth={2} />
    </button>
  );
}
