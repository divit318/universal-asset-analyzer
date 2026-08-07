"use client";

/**
 * Module 2 — AI Investment Brief.
 *
 * The long-form morning note. Same model call as Today's Brief (see
 * lib/home/brief.ts); this module renders the `note` section of it as a
 * structured card: a regime/opportunities hero band, a grid of bordered
 * section tiles, and a full-width recommendations row.
 *
 * Presentation and data-mapping only:
 *   - The regime word, its semantic colour (green risk-on / amber neutral /
 *     red risk-off) and the participation pill derive from the digest's
 *     `marketIntelligence.regime` — real engine fields, never hardcoded. The
 *     participation thresholds match the Market Pulse card's (≥55 broad,
 *     <45 narrow) so the two never disagree about the same breadth figure.
 *   - Body prose passes through `renderProse`, which strips em dashes (a
 *     comma reads better in a card that renders them as typography, not
 *     punctuation), wraps every numeric token in the mono/tabular face, and
 *     normalizes ASCII hyphen-minus to the true minus every other card's
 *     formatter (fmtSignedPct) already uses.
 *   - A section whose text says only that nothing happened ("No specific
 *     macro developments were provided…") is an empty state dressed as
 *     content; its tile is omitted and the grid reflows. Detection rule:
 *     first sentence starts with "No" AND contains an information-
 *     availability verb (provided/available/supplied/given/reported).
 *
 * When the AI is unavailable there is no long note — and this module says
 * exactly that rather than padding the space with the deterministic headline
 * the module above already shows.
 */

import { useEffect, useMemo, useRef, type ReactNode } from "react";
import {
  Binoculars,
  Briefcase,
  ChevronDown,
  Globe,
  Info,
  Lightbulb,
  RefreshCw,
  Scale,
  Shield,
  Sparkles,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";
import { Skeleton, SkeletonText } from "@/app/_components/ui";
import { usePersistedState } from "@/app/_components/use-persisted-state";
import { getHomeModule } from "@/lib/home/registry";
import type { HomeBrief } from "@/lib/home/contracts";
import { useHome, useHomeSlice } from "../home-provider";

const definition = getHomeModule("ai-investment-brief");

const BODY_ID = "ai-investment-brief-body";
const TITLE_ID = "ai-investment-brief-title";
const COLLAPSE_KEY = "home:ai-investment-brief:collapsed";

type Note = NonNullable<HomeBrief["note"]>;

/* ------------------------------------------------------------------ */
/* Prose rendering — em-dash removal + numeric tokens in mono          */
/* ------------------------------------------------------------------ */

/** Em dashes never render in this card; a comma carries the same pause. */
function stripEmDashes(text: string): string {
  return text.replace(/\s*—\s*/g, ", ");
}

/**
 * Numeric tokens: signed/currency numbers, percentages, and X/Y figures
 * ("73/100"). Not preceded by a letter/digit so "SMA200" isn't split.
 */
const NUMERIC_TOKEN = /(?<![A-Za-z0-9])([+\-−]?\$?\d[\d,]*(?:\.\d+)?(?:\/\d+)?%?)/g;

/**
 * Body prose formatter: strips em dashes, then wraps every numeric token in
 * the mono/tabular face so figures are visually distinct from prose. A
 * leading ASCII hyphen on a figure becomes the true minus (−), matching
 * fmtSignedPct — the same value must not render two different minus signs
 * on one page.
 */
function renderProse(text: string): ReactNode[] {
  const clean = stripEmDashes(text);
  const parts = clean.split(NUMERIC_TOKEN);
  return parts.map((part, i) =>
    i % 2 === 1 ? (
      <span key={i} className="font-mono tabular-nums">
        {part.replace(/^-/, "−")}
      </span>
    ) : (
      <span key={i}>{part}</span>
    ),
  );
}

/* ------------------------------------------------------------------ */
/* Empty-section detection                                             */
/* ------------------------------------------------------------------ */

/**
 * A section is empty-in-substance when its first sentence says only that no
 * information exists: it starts with "No" and contains an information-
 * availability verb. "No specific macro developments were provided for
 * today…" matches; "No trade is worth making" (a real engine finding) does
 * not, because "worth making" is a judgment, not an availability statement.
 */
function isEmptySection(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return true;
  const firstSentence = trimmed.split(/(?<=[.!?])\s/)[0] ?? trimmed;
  return /^no\b/i.test(firstSentence) && /\b(provided|available|supplied|given|reported)\b/i.test(firstSentence);
}

/* ------------------------------------------------------------------ */
/* Regime derivation — real fields only                                */
/* ------------------------------------------------------------------ */

interface RegimeVisual {
  word: string | null;
  label: string; // section-label colour class
  glyph: string; // glyph colour class
  tile: string; // icon-tile bg + border classes
}

/** trend → word + semantic colour. Green risk-on, amber neutral, red risk-off. */
function regimeVisual(trend: string | null | undefined): RegimeVisual {
  const t = (trend ?? "").toLowerCase();
  if (t === "risk-on" || t.includes("bull"))
    return { word: "Risk-On", label: "text-positive", glyph: "text-positive", tile: "bg-positive/10 border-positive/20" };
  if (t === "risk-off" || t.includes("bear"))
    return { word: "Risk-Off", label: "text-negative", glyph: "text-negative", tile: "bg-negative/10 border-negative/20" };
  if (t === "neutral")
    return { word: "Neutral", label: "text-brand", glyph: "text-brand", tile: "bg-brand/10 border-brand/20" };
  // Regime field unavailable — no word to show, and no colour to claim.
  return { word: null, label: "text-muted", glyph: "text-muted", tile: "bg-muted/10 border-muted/20" };
}

/**
 * Participation pill, derived from breadth. Thresholds match the Market
 * Pulse card's implication line (≥55 broad, <45 narrow) so both surfaces
 * read the same figure the same way.
 */
function participationLabel(breadthPct: number | null | undefined): string | null {
  if (breadthPct == null) return null;
  if (breadthPct >= 55) return "Broad participation";
  if (breadthPct < 45) return "Narrow participation";
  return "Mixed participation";
}

/* ------------------------------------------------------------------ */
/* Section tiles                                                       */
/* ------------------------------------------------------------------ */

/**
 * Colour roles (three, not six): amber for the one actionable section
 * (Recommendations) and the AI badge; red for risks; green for
 * opportunities; muted for the observational sections, which are not
 * directional and do not earn an accent.
 */
const GRID_SECTIONS: { key: keyof Omit<Note, "regime" | "opportunities" | "recommendations">; title: string; icon: LucideIcon; label: string; glyph: string; tile: string }[] = [
  { key: "risks", title: "Biggest risks", icon: Shield, label: "text-negative", glyph: "text-negative", tile: "bg-negative/10" },
  { key: "portfolio", title: "Portfolio observations", icon: Briefcase, label: "text-muted", glyph: "text-muted", tile: "bg-muted/10" },
  { key: "sectors", title: "Sectors to watch", icon: Binoculars, label: "text-muted", glyph: "text-muted", tile: "bg-muted/10" },
  { key: "macro", title: "Macro developments", icon: Globe, label: "text-muted", glyph: "text-muted", tile: "bg-muted/10" },
];

function QualifierPill({ children }: { children: ReactNode }) {
  return (
    <span className="w-fit rounded-md border border-foreground/14 px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-foreground/60">
      {children}
    </span>
  );
}

function SectionTile({
  title,
  icon: IconGlyph,
  label,
  glyph,
  tile,
  children,
  className = "",
}: {
  title: string;
  icon: LucideIcon;
  label: string;
  glyph: string;
  tile: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`flex flex-col gap-3 rounded-xl border border-foreground/7 bg-surface-2 p-5.5 ${className}`}>
      <div className="flex items-center gap-3">
        <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-[10px] ${tile}`} aria-hidden>
          <IconGlyph className={`h-5 w-5 ${glyph}`} strokeWidth={2} />
        </span>
        <h3 className={`text-[11px] font-semibold uppercase tracking-[0.09em] ${label}`}>{title}</h3>
      </div>
      {children}
    </section>
  );
}

const BODY_TEXT = "max-w-[62ch] text-sm leading-[1.6] text-foreground/72 md:text-[15px]";

/* ------------------------------------------------------------------ */
/* Loading / error / empty states                                      */
/* ------------------------------------------------------------------ */

function TileSkeleton({ className = "" }: { className?: string }) {
  return (
    <div className={`flex flex-col gap-3 rounded-xl border border-foreground/7 bg-surface-2 p-5.5 ${className}`} aria-hidden>
      <div className="flex items-center gap-3">
        <Skeleton height="h-11" width="w-11" radius="rounded-[10px]" />
        <Skeleton height="h-3" width="w-32" />
      </div>
      <SkeletonText lines={3} />
    </div>
  );
}

function BriefSkeleton() {
  return (
    <div role="status" aria-label="Loading AI Investment Brief">
      <div className="grid grid-cols-1 gap-7 rounded-xl border border-foreground/7 bg-surface-2 p-6 lg:grid-cols-[55fr_1px_45fr]" aria-hidden>
        <div className="flex gap-5">
          <Skeleton height="h-14" width="w-14" radius="rounded-full" className="shrink-0" />
          <div className="flex w-full flex-col gap-2">
            <Skeleton height="h-3" width="w-28" />
            <SkeletonText lines={3} />
          </div>
        </div>
        <div className="h-px w-full bg-foreground/7 lg:h-auto lg:w-px" />
        <div className="flex gap-5">
          <Skeleton height="h-14" width="w-14" radius="rounded-full" className="shrink-0" />
          <div className="flex w-full flex-col gap-2">
            <Skeleton height="h-3" width="w-40" />
            <SkeletonText lines={3} />
          </div>
        </div>
      </div>
      <div className="mt-6 grid grid-cols-1 gap-5 lg:grid-cols-2">
        <TileSkeleton />
        <TileSkeleton />
        <TileSkeleton />
        <TileSkeleton />
        <TileSkeleton className="lg:col-span-2" />
      </div>
    </div>
  );
}

function BriefError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex min-h-40 flex-col items-center justify-center gap-3 py-8" role="status">
      <p className="text-sm text-muted">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="rounded-control border border-border px-3 py-1.5 text-xs font-medium text-muted outline-none transition-colors hover:border-border-strong hover:text-foreground focus-visible:ring-2 focus-visible:ring-brand/40"
      >
        Retry
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* The module                                                          */
/* ------------------------------------------------------------------ */

const isBoolean = (v: unknown): v is boolean => typeof v === "boolean";

export function AiInvestmentBriefModule({
  collapsible,
  defaultCollapsed,
}: {
  collapsible?: boolean;
  defaultCollapsed?: boolean;
}) {
  const { brief, refreshBrief, emit } = useHome();
  const market = useHomeSlice("marketIntelligence");
  const [collapsed, setCollapsed] = usePersistedState<boolean>(
    COLLAPSE_KEY,
    (collapsible && defaultCollapsed) ?? false,
    isBoolean,
  );

  // Lifecycle emission — the seam ModuleShell provided; a bespoke surface
  // still reports mount/status/refresh so Phase 2 motion can find it.
  useEffect(() => {
    emit("mount", definition.id);
    return () => emit("unmount", definition.id);
  }, [emit]);

  const lastStatus = useRef<string | null>(null);
  useEffect(() => {
    if (lastStatus.current === brief.status) return;
    lastStatus.current = brief.status;
    if (brief.status === "loading") emit("loading", definition.id);
    else if (brief.status === "success") emit("success", definition.id);
    else if (brief.status === "error") emit("error", definition.id);
  }, [brief.status, emit]);

  useEffect(() => {
    if (brief.revalidating) emit("refresh", definition.id);
  }, [brief.revalidating, emit]);

  // Polite completion announcement for the refresh button: when a refresh
  // finishes, the live region below reads one sentence to screen readers.
  const wasRevalidating = useRef(false);
  const announceRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (wasRevalidating.current && !brief.revalidating && announceRef.current) {
      announceRef.current.textContent = "AI Investment Brief refreshed.";
    }
    wasRevalidating.current = brief.revalidating;
  }, [brief.revalidating]);

  const note = brief.data?.note ?? null;
  const regime = regimeVisual(market.data?.regime?.trend);
  const participation = participationLabel(market.data?.regime?.breadthPct ?? market.data?.breadthPct);

  const toggle = () => {
    emit(collapsed ? "expand" : "collapse", definition.id);
    setCollapsed(!collapsed);
  };

  const showOpportunities = useMemo(() => (note ? !isEmptySection(note.opportunities) : false), [note]);
  const gridSections = useMemo(
    () => (note ? GRID_SECTIONS.filter((s) => !isEmptySection(note[s.key])) : []),
    [note],
  );
  const recommendations = useMemo(
    () => (note?.recommendations ?? []).filter((r) => !isEmptySection(r)),
    [note],
  );

  const body = (() => {
    if (brief.status === "error" && !note) {
      return <BriefError message={brief.error ?? "Brief unavailable."} onRetry={refreshBrief} />;
    }
    if ((brief.status === "loading" || brief.status === "idle") && !note) {
      return <BriefSkeleton />;
    }
    if (!note) {
      return (
        <div className="flex min-h-40 items-center justify-center py-8">
          <p className="text-sm text-faint">
            The long-form note needs a reachable AI provider. Connect one and refresh.
          </p>
        </div>
      );
    }

    return (
      <>
        {/* Hero band — market regime + biggest opportunities. */}
        <div className="rounded-xl border border-foreground/7 bg-surface-2 p-6">
          <div className={`grid grid-cols-1 gap-7 ${showOpportunities ? "lg:grid-cols-[55fr_1px_45fr]" : ""}`}>
            <section className="flex gap-5">
              <span
                className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-full border ${regime.tile}`}
                aria-hidden
              >
                <Scale className={`h-6 w-6 ${regime.glyph}`} strokeWidth={2} />
              </span>
              <div className="flex min-w-0 flex-col gap-2">
                <h3 className={`text-[11px] font-semibold uppercase tracking-[0.09em] ${regime.label}`}>
                  Market regime
                </h3>
                {regime.word ? (
                  <p className="text-[26px] font-semibold leading-none text-foreground">{regime.word}</p>
                ) : null}
                <p className={BODY_TEXT}>{renderProse(note.regime)}</p>
                {participation ? <QualifierPill>{participation}</QualifierPill> : null}
              </div>
            </section>

            {showOpportunities ? (
              <>
                <div className="h-px w-full bg-foreground/7 lg:h-auto lg:w-px" aria-hidden />
                <section className="flex gap-5">
                  <span
                    className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full border border-positive/20 bg-positive/10"
                    aria-hidden
                  >
                    <TrendingUp className="h-6 w-6 text-positive" strokeWidth={2} />
                  </span>
                  <div className="flex min-w-0 flex-col gap-2">
                    <h3 className="text-[11px] font-semibold uppercase tracking-[0.09em] text-positive">
                      Biggest opportunities
                    </h3>
                    <p className={BODY_TEXT}>{renderProse(note.opportunities)}</p>
                  </div>
                </section>
              </>
            ) : null}
          </div>
        </div>

        {/* Section grid — one container idiom: every section is a bordered tile. */}
        {gridSections.length > 0 || recommendations.length > 0 ? (
          <div className="mt-6 grid grid-cols-1 gap-5 lg:grid-cols-2">
            {gridSections.map((s, i) => (
              <SectionTile
                key={s.key}
                title={s.title}
                icon={s.icon}
                label={s.label}
                glyph={s.glyph}
                tile={s.tile}
                // An omitted section can leave an odd count; the last tile
                // widens so the grid reflows without a dead region.
                className={gridSections.length % 2 === 1 && i === gridSections.length - 1 ? "lg:col-span-2" : ""}
              >
                <p className={BODY_TEXT}>{renderProse(note[s.key])}</p>
              </SectionTile>
            ))}

            {/* Recommendations — the one actionable section, full-width and last. */}
            {recommendations.length > 0 ? (
              <SectionTile
                title="Recommendations"
                icon={Lightbulb}
                label="text-brand"
                glyph="text-brand"
                tile="bg-brand/10"
                className="lg:col-span-2"
              >
                <ul className="xl:columns-2 xl:gap-7">
                  {recommendations.map((r, i) => (
                    <li key={i} className="mb-2.5 flex gap-2.5 break-inside-avoid last:mb-0">
                      <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-brand" aria-hidden />
                      <span className="max-w-[62ch] text-sm leading-normal text-foreground/72 md:text-[15px]">
                        {renderProse(r)}
                      </span>
                    </li>
                  ))}
                </ul>
              </SectionTile>
            ) : null}
          </div>
        ) : null}
      </>
    );
  })();

  return (
    <article
      aria-labelledby={TITLE_ID}
      className="rounded-card border border-foreground/8 bg-surface p-5 md:p-7"
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          {collapsible ? (
            <button
              type="button"
              onClick={toggle}
              aria-expanded={!collapsed}
              aria-controls={BODY_ID}
              aria-label={collapsed ? "Expand AI Investment Brief" : "Collapse AI Investment Brief"}
              className="mt-1 rounded-control outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-brand/40"
            >
              <ChevronDown
                className={`h-[18px] w-[18px] text-foreground/45 transition-transform ${collapsed ? "rotate-180" : ""}`}
                strokeWidth={2}
              />
            </button>
          ) : null}
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex flex-wrap items-center gap-3">
              <h2 id={TITLE_ID} className="text-[22px] font-semibold leading-7 text-foreground">
                {definition.title}
              </h2>
              <span className="inline-flex items-center gap-1 rounded-md bg-brand/12 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-brand">
                <Sparkles className="h-3 w-3" strokeWidth={2.5} aria-hidden /> AI generated
              </span>
            </div>
            <p className="text-sm text-foreground/55">{definition.description}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={refreshBrief}
          aria-label="Refresh AI Investment Brief"
          className="mt-1 shrink-0 rounded-control p-1.5 text-foreground/40 outline-none transition-colors hover:text-foreground/70 focus-visible:ring-2 focus-visible:ring-brand/40"
        >
          <RefreshCw className={`h-4 w-4 ${brief.revalidating ? "animate-spin" : ""}`} strokeWidth={2} />
        </button>
        <span ref={announceRef} role="status" aria-live="polite" className="sr-only" />
      </div>

      {collapsed ? null : (
        <div id={BODY_ID}>
          {/* Full-bleed divider between header and body. */}
          <div className="-mx-5 mb-6 mt-4 border-t border-foreground/8 md:-mx-7" aria-hidden />

          {body}

          {/* Disclaimer footer — inset top divider. */}
          <div className="mt-5 flex items-start gap-2 border-t border-foreground/8 py-4">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-foreground/35" strokeWidth={2} aria-hidden />
            <p className="text-[13px] leading-5 text-foreground/45">
              AI-generated from the engine outputs shown elsewhere on this page. Verify independently. Not
              investment advice.
            </p>
          </div>
        </div>
      )}
    </article>
  );
}
