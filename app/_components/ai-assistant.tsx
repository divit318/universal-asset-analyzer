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

/** Event other components dispatch to open the assistant (e.g. the header button). */
export const OPEN_ASSISTANT_EVENT = "uaa:open-assistant";

interface Turn {
  role: "user" | "assistant";
  content: string;
  suggestions?: string[];
  action?: AppAssistantAction;
  failed?: boolean;
}

const STARTERS = [
  "What can I do on this page?",
  "Where's my portfolio?",
  "How do I run a DCF?",
  "What's the difference between the Screener and the Wire?",
];

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
  const [insight, setInsight] = useState<ProactiveInsight | null>(null);
  const [insightDismissed, setInsightDismissed] = useState(false);
  const [mounted, setMounted] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
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
  // back last time (no insight yet, not dismissed).
  useEffect(() => {
    if (!open || insight || insightDismissed) return;
    let cancelled = false;
    fetch("/api/ai/assistant/insights")
      .then((r) => r.json())
      .then((d: { insights?: ProactiveInsight[] }) => {
        if (!cancelled && d.insights && d.insights.length > 0) setInsight(d.insights[0]);
      })
      .catch(() => {
        // Quiet by design — a failed insights fetch is invisible, not an error.
      });
    return () => {
      cancelled = true;
    };
  }, [open, insight, insightDismissed]);

  const goTo = useCallback(
    (action: AppAssistantAction) => {
      if (navigateTimer.current) clearTimeout(navigateTimer.current);
      if (action.screenerHandoff) {
        try {
          sessionStorage.setItem(PENDING_SCREEN_KEY, JSON.stringify(action.screenerHandoff));
        } catch {
          // sessionStorage can throw in rare privacy-mode configs — navigate
          // anyway, just without the filters preapplied.
        }
      }
      // The mutation fires here — the same moment navigation would otherwise
      // just happen (the auto-fire beat, or a confirm-chip click) — never
      // earlier, so a medium/low-confidence guess never touches the database
      // before the user has actually seen and confirmed it.
      if (action.mutation?.kind === "watchlist_add") {
        const { symbol, name } = action.mutation;
        void fetch("/api/watchlist", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ symbol, name }),
        });
      }
      setOpen(false);
      router.push(action.href);
    },
    [router],
  );

  useEffect(() => {
    const onOpen = () => setOpen(true);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
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

  // A high-confidence action fires on its own after a short beat — long
  // enough to read "Opening Asset Comparison…", short enough to feel
  // instant. Medium/low confidence stays a chip the user has to click
  // (see the render below) rather than auto-navigating on a guess.
  useEffect(() => {
    const i = turns.length - 1;
    const action = turns[i]?.action;
    if (!action || action.confidence !== "high" || firedActions.current.has(i)) return;
    firedActions.current.add(i);
    navigateTimer.current = setTimeout(() => goTo(action), AUTO_NAVIGATE_DELAY_MS);
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
      const history: AppAssistantTurn[] = [];
      for (let i = 0; i + 1 < turns.length; i += 2) {
        if (turns[i].role === "user" && turns[i + 1]?.role === "assistant") {
          history.push({ question: turns[i].content, answer: turns[i + 1].content });
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
          { role: "assistant", content: err instanceof Error ? err.message : "Something went wrong. Please try again.", failed: true },
        ]);
      } finally {
        setLoading(false);
      }
    },
    [loading, turns, pathname, pageContext],
  );

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
      <aside
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
                Ask how to use UAA or where to find something. For research on a specific stock, use the Research Copilot instead — I don&apos;t have live market data.
              </p>
              <div className="flex flex-col gap-2">
                {STARTERS.map((s) => (
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
                  className={`max-w-[85%] rounded-lg px-3 py-2 text-xs leading-relaxed ${
                    t.role === "user"
                      ? "bg-brand text-background"
                      : t.failed
                        ? "border border-negative/40 bg-negative/10 text-negative"
                        : "border border-border bg-surface-2 text-foreground"
                  }`}
                >
                  {t.content}
                </div>
                {t.action && <DestinationChip action={t.action} onConfirm={goTo} />}
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
      </aside>
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
 */
function DestinationChip({ action, onConfirm }: { action: AppAssistantAction; onConfirm: (action: AppAssistantAction) => void }) {
  const Icon = DESTINATION_ICON[action.destination] ?? ArrowRight;
  const pending = action.confidence === "high";

  return (
    <button
      onClick={() => onConfirm(action)}
      className={`group flex items-center gap-2 self-start rounded-full border px-3 py-1.5 text-xs font-medium transition-[color,border-color,transform,box-shadow] duration-200 ease-out hover:-translate-y-0.5 hover:scale-[1.03] ${
        pending
          ? "animate-fade-rise border-brand/40 bg-brand-muted text-brand shadow-glow-brand"
          : "border-border bg-surface-2 text-foreground hover:border-brand hover:text-brand hover:shadow-card"
      }`}
    >
      <Icon className={`h-3.5 w-3.5 ${pending ? "animate-pulse" : ""}`} strokeWidth={2} />
      {pending ? action.label : `Open ${action.destinationLabel}`}
      <ArrowRight className="h-3 w-3 shrink-0 transition-transform duration-200 ease-out group-hover:translate-x-0.5" strokeWidth={2} />
    </button>
  );
}
