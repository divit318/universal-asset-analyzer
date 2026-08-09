"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { Check, Clock, KeyRound } from "lucide-react";
import type { SectionProps } from "../section-registry";
import { Reveal } from "../motion/reveal";
import { SectionShell } from "../primitives/section-shell";
import { SectionHeader } from "../primitives/section-header";
import { Odometer } from "../primitives/odometer";
import { openAuthModal } from "../auth-modal";
import { PRIMARY_ACTION } from "../../landing-config";

/**
 * Pricing — two tiers, one of which exists.
 *
 * FREE is the full local product (nothing in it is a crippled teaser), and
 * every bullet is grounded in shipped code: the seven asset classes are
 * lib/assets/types.ts's ASSET_CLASS_IDS verbatim; engines/verification are
 * lib/composite + lib/valuation + lib/ai/grounding; auth is the optional
 * local account (proxy.ts gate, off by default); AI is BYO key.
 *
 * PRO does not exist. The badge says so at full prominence, the CTA captures
 * interest into local SQLite (willingness-to-pay data), and there is no
 * purchase affordance anywhere: no billing exists behind this page.
 *
 * This section carries NO canvas ink (Movement IV's Silence): the aurora
 * arcs are two slow CSS radial gradients on a 12s breath, and the cost-tier
 * condensation is a tiny local dot cluster per card.
 *
 * The BYOK cost tiers are derived, not asserted: input sizes measured from
 * recorded production prompts (bench-out/parity, 2026-08-02), output at each
 * task's configured hard cap (lib/ai/task-registry.ts), priced at Anthropic's
 * published $5/$25 per MTok for claude-opus-5. INR figures convert those
 * amounts at prevailing rates and are approximate.
 */

/* ------------------------------- currency -------------------------------- */

type Currency = "USD" | "INR";
const CURRENCY_KEY = "uaa-currency";

/** Locale default: India → INR, everywhere else USD. Browser-only signals. */
function localeDefault(): Currency {
  try {
    if (navigator.language?.toLowerCase().endsWith("-in")) return "INR";
    if (Intl.DateTimeFormat().resolvedOptions().timeZone === "Asia/Kolkata") return "INR";
  } catch {
    /* fall through */
  }
  return "USD";
}

function currencySnapshot(): Currency {
  try {
    const stored = localStorage.getItem(CURRENCY_KEY);
    if (stored === "USD" || stored === "INR") return stored;
  } catch {
    /* private mode */
  }
  return "USD"; // SSR-safe placeholder; effect below applies the locale default
}

function subscribeCurrency(cb: () => void) {
  window.addEventListener("uaa-currencychange", cb);
  return () => window.removeEventListener("uaa-currencychange", cb);
}

/** Same persistence pattern as the theme toggle: localStorage + an event. */
function useCurrency() {
  const currency = useSyncExternalStore(subscribeCurrency, currencySnapshot, () => "USD" as Currency);

  const setCurrency = useCallback((next: Currency) => {
    try {
      localStorage.setItem(CURRENCY_KEY, next);
    } catch {
      /* still applies for the session via the event */
    }
    window.dispatchEvent(new Event("uaa-currencychange"));
  }, []);

  // First visit only: apply the locale default (stored choice always wins).
  useEffect(() => {
    try {
      if (!localStorage.getItem(CURRENCY_KEY)) setCurrency(localeDefault());
    } catch {
      /* ignore */
    }
  }, [setCurrency]);

  return { currency, setCurrency };
}

/* --------------------------- copy & figures (verified) --------------------- */

const FREE_INCLUDED = [
  "All seven asset classes: equities, ETFs, REITs, crypto, commodities, bonds, forex",
  "Deterministic engines compute every figure: screening, composite scoring, DCF valuation, portfolio analytics",
  "The verification layer: every AI-written figure traced back to its evidence",
  "US and Indian market data from public sources",
  "AI narration on your own provider: Devin CLI login (no API key) or your own Anthropic, OpenAI, Gemini, or OpenRouter key. The provider bills you directly",
  "Your data in a local database you own, with an optional local account for shared machines",
];

const PRO_PLANNED = [
  "Managed AI: narration without bringing your own key",
  "Licensed real-time and market-depth data, beyond public sources",
  "Encrypted cross-device sync and backup",
  "Scheduled background refresh and alerts",
  "Shareable, verified report links",
];

/** Every displayed figure, per currency, so the toggle converts everything.
 *  Rates from the repo source (claude-opus-5, $5/$25 per MTok); INR converted
 *  at prevailing rates and marked approximate. */
const FIGURES = {
  USD: {
    freePrice: "$0",
    proPrice: "$180",
    proSuffix: "/ year",
    proNote: "$19 / month",
    inputRate: "$5",
    outputRate: "$25",
    tierLow: "≈ 2¢",
    tierMedium: "≈ 3¢",
    tierHigh: "≈ 5–6¢",
    monthlyLabel: "Monthly ($19)",
    annualLabel: "Annual ($180)",
  },
  INR: {
    freePrice: "₹0",
    proPrice: "₹4,999",
    proSuffix: "/ year",
    proNote: "annual only",
    inputRate: "≈ ₹420",
    outputRate: "≈ ₹2,100",
    tierLow: "≈ ₹2",
    tierMedium: "≈ ₹3",
    tierHigh: "≈ ₹4–5",
    monthlyLabel: "Monthly",
    annualLabel: "Annual (₹4,999)",
  },
} as const;

/* ------------------------------ interest form ----------------------------- */

type PricePref = "monthly" | "annual" | "neither";

function InterestForm({ currency }: { currency: Currency }) {
  const [email, setEmail] = useState("");
  const [pref, setPref] = useState<PricePref | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const trimmed = email.trim();
    if (!trimmed) {
      setError("Enter an email address.");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setError("That doesn't look like an email address.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/pricing-interest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: trimmed, pricePreference: pref, currency }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? "Could not save that. Try again.");
        return;
      }
      setDone(true);
    } catch {
      setError("Could not save that. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <p aria-live="polite" className="mt-auto rounded-control border border-positive/30 bg-positive/10 px-3 py-2.5 text-mk-small text-positive">
        You&apos;re on the list. We&apos;ll email you if Pro ships, nothing else.
      </p>
    );
  }

  const figures = FIGURES[currency];

  return (
    <form className="mt-auto flex flex-col gap-3 pt-6 text-left" onSubmit={submit} noValidate>
      <div>
        <label htmlFor="pricing-interest-email" className="text-mk-small font-medium text-muted">
          Email me when Pro exists
        </label>
        <input
          id="pricing-interest-email"
          type="email"
          autoComplete="email"
          inputMode="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={busy}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "pricing-interest-error" : undefined}
          className={`mt-1 h-10 w-full rounded-control border bg-surface-2 px-3 text-sm outline-none transition-colors placeholder:text-faint focus:ring-2 disabled:opacity-60 ${
            error ? "border-negative focus:border-negative focus:ring-negative/25" : "border-border focus:border-brand focus:ring-brand/25"
          }`}
        />
        <p id="pricing-interest-error" aria-live="polite" className="mt-1.5 min-h-4 text-caption text-negative">
          {error ?? ""}
        </p>
      </div>

      <fieldset className="flex flex-col gap-1.5">
        <legend className="text-mk-small font-medium text-muted">Which price would you pay? (optional)</legend>
        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1.5">
          {(
            [
              ["monthly", figures.monthlyLabel],
              ["annual", figures.annualLabel],
              ["neither", "Neither"],
            ] as const
          ).map(([value, label]) => (
            <label key={value} className="flex items-center gap-1.5 text-sm text-foreground">
              <input
                type="radio"
                name="pricing-pref"
                value={value}
                checked={pref === value}
                onChange={() => setPref(value)}
                disabled={busy}
                className="accent-[var(--brand)]"
              />
              {label}
            </label>
          ))}
        </div>
      </fieldset>

      <button
        type="submit"
        disabled={busy}
        className="inline-flex h-11 items-center justify-center rounded-control border border-brand/40 bg-surface px-4 text-sm font-semibold text-brand outline-none transition hover:border-brand hover:bg-brand-muted focus-visible:ring-2 focus-visible:ring-brand/40 disabled:opacity-60"
      >
        {busy ? "Saving…" : "Notify me"}
      </button>
    </form>
  );
}

/* --------------------------------- section -------------------------------- */

/** Dots per cost tier: low, medium, high. Countable, roughly proportional. */
const TIER_DOTS = [2, 3, 6];

export function Pricing({ section, index }: SectionProps) {
  const headingId = `${section.id}-heading`;
  const { currency, setCurrency } = useCurrency();
  const figures = FIGURES[currency];

  const tiers = [
    { effort: "Low effort", desc: "quick parse, calendar brief", cost: figures.tierLow },
    { effort: "Medium effort", desc: "movement explainer, watchlist digest", cost: figures.tierMedium },
    { effort: "High effort", desc: "full research verdict", cost: figures.tierHigh },
  ];

  return (
    <SectionShell
      id={section.id}
      headingId={headingId}
      band={index % 2 === 1}
      className="overflow-hidden"
      containerClassName="flex flex-col items-center"
      breakout={
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute left-[8%] top-24 h-[420px] w-[46%] animate-mk-aurora rounded-full bg-[radial-gradient(ellipse_at_center,color-mix(in_srgb,var(--brand)_9%,transparent),transparent_70%)] motion-reduce:animate-none" />
          <div className="absolute right-[6%] top-64 h-[460px] w-[42%] animate-mk-aurora-alt rounded-full bg-[radial-gradient(ellipse_at_center,color-mix(in_srgb,var(--brand)_7%,transparent),transparent_70%)] motion-reduce:animate-none" />
        </div>
      }
    >
        <div className="flex flex-col items-center">
          <SectionHeader
            eyebrow="Pricing"
            headingId={headingId}
            segments={[
              { text: "Free to run. Pro when", block: true },
              { text: "you want us to run it.", tone: "accent", block: true },
            ]}
            lead={
              <>
                The local product is free and complete: your machine, your database, your Anthropic
                key. A paid tier is planned for the things that genuinely need a server. It
                doesn&apos;t exist yet, and nothing here is billable.
              </>
            }
          />

          {/* Currency toggle — persisted; converts every figure on the page. */}
          <Reveal delay={230}>
          <div role="group" aria-label="Currency" className="mt-mk-group flex rounded-full border border-border bg-surface p-1">
            {(["USD", "INR"] as const).map((c) => (
              <button
                key={c}
                type="button"
                aria-pressed={currency === c}
                onClick={() => setCurrency(c)}
                className={`rounded-full px-4 py-1.5 text-mk-small font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-brand/40 ${
                  currency === c ? "bg-brand text-background" : "text-muted hover:text-foreground"
                }`}
              >
                {c === "USD" ? "$ USD" : "₹ INR"}
              </button>
            ))}
          </div>
          </Reveal>
        </div>

        <Reveal delay={280} className="mt-mk-lead grid w-full gap-5 text-left lg:grid-cols-2">
          {/* ------------------------------ FREE ------------------------------ */}
            <div data-testid="pricing-free" className="flex h-full flex-col rounded-[20px] border border-border bg-surface p-8 shadow-card">
              <div className="flex items-center justify-between gap-2">
                <p className="text-mk-eyebrow uppercase text-muted">Free</p>
                <span className="rounded-full border border-positive/30 bg-positive/10 px-2.5 py-1 text-micro font-semibold uppercase tracking-widest text-positive">
                  Available now
                </span>
              </div>
              <p className="mt-3 font-mono text-5xl font-semibold tabular-nums tracking-tight text-foreground">
                <Odometer value={figures.freePrice} />
              </p>
              <p className="mt-2 text-mk-body text-muted">The full local product. Nothing held back.</p>

              <ul className="mt-6 mb-8 flex flex-1 flex-col gap-3">
                {FREE_INCLUDED.map((item) => (
                  <li key={item} className="flex items-start gap-2.5 text-mk-body text-foreground">
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-muted text-brand">
                      <Check className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden="true" />
                    </span>
                    {item}
                  </li>
                ))}
              </ul>

              <button
                type="button"
                onClick={() => openAuthModal("signup")}
                className="group mt-auto inline-flex h-12 w-full items-center justify-center gap-2 rounded-control bg-brand text-sm font-semibold text-background outline-none transition-[background-color,border-color,transform] duration-[120ms] hover:-translate-y-px hover:bg-brand-strong focus-visible:ring-2 focus-visible:ring-brand/40"
              >
                {PRIMARY_ACTION}
                <span aria-hidden="true" className="transition-transform duration-[200ms] group-hover:translate-x-0.5">
                  →
                </span>
              </button>
            </div>

          {/* ------------------------------- PRO ------------------------------- */}
            <div data-testid="pricing-pro" className="flex h-full flex-col rounded-[20px] border border-brand/50 bg-surface/70 p-8">
              {/* The card's most important element: this does not exist yet. */}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-mk-eyebrow uppercase text-muted">Pro</p>
                <p className="flex items-center gap-2 rounded-full border border-brand/50 bg-brand/12 px-3.5 py-1.5 text-mk-small font-bold uppercase tracking-widest text-brand [[data-reveal=shown]_&]:animate-mk-soft-pulse motion-reduce:animate-none">
                  <Clock className="h-4 w-4" strokeWidth={2.5} aria-hidden="true" />
                  Planned, not yet available
                </p>
              </div>
              <p className="mt-3 flex items-baseline gap-2">
                <span className="font-mono text-5xl font-semibold tabular-nums tracking-tight text-foreground">
                  <Odometer value={figures.proPrice} />
                </span>
                <span className="text-mk-body text-muted">{figures.proSuffix}</span>
                <span className="text-mk-small text-muted">({figures.proNote})</span>
              </p>
              <p className="mt-2 text-mk-body text-muted">
                Intended pricing. Nothing is purchasable today; this card exists to ask, not to sell.
              </p>

              <ul className="mt-6 flex flex-1 flex-col gap-3">
                {PRO_PLANNED.map((item) => (
                  <li key={item} className="flex items-start gap-2.5 text-mk-body text-muted">
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-muted text-brand">
                      <Clock className="h-3 w-3" strokeWidth={2} aria-hidden="true" />
                    </span>
                    <span>
                      {item} <span className="text-caption uppercase tracking-wide text-muted">(planned)</span>
                    </span>
                  </li>
                ))}
              </ul>

              <InterestForm currency={currency} />
            </div>
        </Reveal>

        {/* The BYOK cost explainer: two-sentence lead, then the three cost
            tiers as a labelled strip. Rates verified against the repo source
            (claude-opus-5 at $5/$25 per MTok, hard output caps in code). */}
        <Reveal delay={0} className="mt-mk-lead w-full">
          <div className="flex flex-col gap-5 rounded-[20px] border border-border bg-surface/70 p-7 text-left sm:flex-row sm:items-start sm:gap-6">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-brand/18 bg-brand/10 text-brand" aria-hidden="true">
              <KeyRound className="h-5 w-5" strokeWidth={1.75} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-mk-body font-semibold text-foreground">
                What does &ldquo;your own Anthropic key&rdquo; cost?
              </p>
              <p className="mt-2 text-pretty text-mk-body text-muted">
                Anthropic bills you directly at Claude Opus 5&apos;s published rate:{" "}
                <span className="font-mono tabular-nums text-foreground">{figures.inputRate}</span> per million input
                tokens, <span className="font-mono tabular-nums text-foreground">{figures.outputRate}</span> per million
                output. Every UAA call has a hard output cap in code, so the worst case per analysis is knowable, not
                open-ended.
              </p>

              <Reveal delay={280} stagger={80} className="mt-5 grid gap-3 sm:grid-cols-3">
                {tiers.map((t, ti) => (
                  <div
                    key={t.effort}
                    className="group relative rounded-card border border-hairline bg-surface-2/60 px-4 py-3 transition-colors hover:border-brand/30"
                  >
                    <p className="text-micro uppercase tracking-widest text-muted">{t.effort}</p>
                    <p className="mt-1 font-mono text-mk-lead font-semibold tabular-nums text-foreground">{t.cost}</p>
                    <p className="mt-0.5 text-caption text-muted">{t.desc}</p>
                    {/* The cost, condensed: hovering settles a countable
                        cluster of brass dots, proportional to the tier.
                        Unlabelled, unexplained: let it be noticed. */}
                    <span aria-hidden="true" className="absolute right-3 top-2.5 flex gap-1">
                      {Array.from({ length: TIER_DOTS[ti] }).map((_, di) => (
                        <span
                          key={di}
                          style={{ transitionDelay: `${di * 70}ms` }}
                          className="h-1.5 w-1.5 scale-50 rounded-full bg-brand opacity-0 transition-[opacity,transform] duration-300 ease-out group-hover:scale-100 group-hover:opacity-80 motion-reduce:transition-none"
                        />
                      ))}
                    </span>
                  </div>
                ))}
              </Reveal>

              <p className="mt-4 text-mk-small text-muted">
                Figures use production-recorded prompt sizes with output at each task&apos;s configured cap; richer
                dossiers cost proportionally more input at {figures.inputRate} per million tokens.
                {currency === "INR" ? " INR figures are approximate at prevailing exchange rates. " : " "}
                Every screen&apos;s computed numbers are free: the engines run on your machine.
              </p>
            </div>
          </div>
        </Reveal>
    </SectionShell>
  );
}
