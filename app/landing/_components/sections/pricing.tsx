"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { Check, Clock } from "lucide-react";
import { Badge } from "@/app/_components/ui/badge";
import type { SectionProps } from "../section-registry";
import { Reveal } from "../reveal";
import { openAuthModal } from "../auth-modal";

/**
 * Pricing — two tiers, one of which exists.
 *
 * FREE is the full local product (nothing in it is a crippled teaser), and
 * every bullet is grounded in shipped code: the seven asset classes are
 * lib/assets/types.ts's ASSET_CLASS_IDS verbatim; engines/verification are
 * lib/composite + lib/valuation + lib/ai/grounding; auth is the optional
 * local account (proxy.ts gate, off by default); AI is BYO Anthropic key.
 *
 * PRO does not exist. The card says so unambiguously, its CTA captures
 * interest into the local SQLite (willingness-to-pay data), and there is no
 * purchase affordance anywhere — no billing exists behind this page.
 *
 * The BYOK cost line is derived, not asserted: input sizes measured from
 * recorded production prompts (bench-out/parity, 2026-08-02) and the real
 * prompt builders; output at each task's configured hard cap
 * (lib/ai/task-registry.ts); price = Anthropic's published $5/$25 per MTok
 * for claude-opus-5. Derivation in the migration session's report.
 */

/* ------------------------------- currency -------------------------------- */

type Currency = "USD" | "INR";
const CURRENCY_KEY = "uaa-currency";

/** Locale default: India → INR, everywhere else USD. Browser-only signals
 *  (navigator.language / the resolved timezone) — no IP lookups, no geo
 *  service, nothing that phones home. */
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

/* ----------------------------- copy (verified) ---------------------------- */

const FREE_INCLUDED = [
  "All seven asset classes — equities, ETFs, REITs, crypto, commodities, bonds, forex",
  "Deterministic engines compute every figure: screening, composite scoring, DCF valuation, portfolio analytics",
  "The verification layer — every AI-written figure traced back to its evidence",
  "US and Indian market data from public sources",
  "AI narration on Claude, with your own Anthropic API key — Anthropic bills you directly",
  "Your data in a local database you own, with an optional local account for shared machines",
];

const PRO_PLANNED = [
  "Managed AI — narration without bringing your own key",
  "Licensed real-time and market-depth data, beyond public sources",
  "Encrypted cross-device sync and backup",
  "Scheduled background refresh and alerts",
  "Shareable, verified report links",
];

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
        setError(data.error ?? "Could not save that — try again.");
        return;
      }
      setDone(true);
    } catch {
      setError("Could not save that — try again.");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <p aria-live="polite" className="mt-6 rounded-control border border-positive/30 bg-positive/10 px-3 py-2.5 text-sm text-positive">
        You’re on the list. We’ll email you if Pro ships — nothing else.
      </p>
    );
  }

  const prefName = "pricing-pref";
  const monthlyLabel = currency === "INR" ? "Monthly" : "Monthly ($19)";
  const annualLabel = currency === "INR" ? "Annual (₹4,999)" : "Annual ($180)";

  return (
    <form className="mt-6 flex flex-col gap-3 text-left" onSubmit={submit} noValidate>
      <div>
        <label htmlFor="pricing-interest-email" className="text-xs font-medium text-muted">
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
        <legend className="text-xs font-medium text-muted">Which price would you pay? (optional)</legend>
        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1.5">
          {(
            [
              ["monthly", monthlyLabel],
              ["annual", annualLabel],
              ["neither", "Neither"],
            ] as const
          ).map(([value, label]) => (
            <label key={value} className="flex items-center gap-1.5 text-sm text-foreground">
              <input
                type="radio"
                name={prefName}
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
        className="inline-flex h-10 items-center justify-center rounded-control border border-border bg-surface px-4 text-sm font-semibold text-foreground outline-none transition hover:border-border-strong hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-brand/40 disabled:opacity-60"
      >
        {busy ? "Saving…" : "Notify me"}
      </button>
    </form>
  );
}

/* --------------------------------- section -------------------------------- */

export function Pricing({ section, index }: SectionProps) {
  const headingId = `${section.id}-heading`;
  const banded = index % 2 === 1;
  const { currency, setCurrency } = useCurrency();

  return (
    <section
      id={section.id}
      aria-labelledby={headingId}
      className={`scroll-mt-20 border-b border-border ${banded ? "bg-surface" : "bg-background"}`}
    >
      <Reveal className="mx-auto flex w-full max-w-5xl flex-col items-center gap-8 px-6 py-24 text-center">
        <div className="flex max-w-2xl flex-col items-center gap-4">
          <p className="text-label font-semibold uppercase tracking-widest text-brand">{section.kicker}</p>
          <h2 id={headingId} className="text-balance text-2xl font-semibold tracking-tight text-foreground sm:text-4xl">
            Free to run. Pro when you want us to run it.
          </h2>
          <p className="text-pretty text-base leading-relaxed text-muted">
            The local product is free and complete — your machine, your database, your Anthropic key.
            A paid tier is planned for the things that genuinely need a server. It doesn’t exist yet,
            and nothing here is billable.
          </p>
        </div>

        {/* Currency — browser locale default, persisted like the theme toggle. */}
        <div role="group" aria-label="Currency" className="flex rounded-control border border-border bg-surface p-0.5">
          {(["USD", "INR"] as const).map((c) => (
            <button
              key={c}
              type="button"
              aria-pressed={currency === c}
              onClick={() => setCurrency(c)}
              className={`rounded-[inherit] px-3 py-1 text-xs font-semibold transition-colors ${
                currency === c ? "bg-brand text-background" : "text-muted hover:text-foreground"
              }`}
            >
              {c === "USD" ? "$ USD" : "₹ INR"}
            </button>
          ))}
        </div>

        <div className="grid w-full gap-4 text-left sm:grid-cols-2">
          {/* ------------------------------ FREE ------------------------------ */}
          <div data-testid="pricing-free" className="flex flex-col rounded-panel border border-border bg-surface p-8 shadow-card">
            <div className="flex items-center justify-between gap-2">
              <p className="text-caption uppercase tracking-widest text-faint">Free</p>
              <Badge variant="positive">Available now</Badge>
            </div>
            <div className="mt-2 flex items-baseline gap-2 tabular-nums">
              <span className="text-4xl font-semibold tracking-tight text-foreground">
                {currency === "INR" ? "₹0" : "$0"}
              </span>
            </div>
            <p className="mt-1 text-sm text-muted">The full local product. Nothing held back.</p>

            <ul className="mt-6 flex flex-1 flex-col gap-3">
              {FREE_INCLUDED.map((item) => (
                <li key={item} className="flex items-start gap-2.5 text-sm text-foreground">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-muted text-brand">
                    <Check className="h-3.5 w-3.5" strokeWidth={2.5} />
                  </span>
                  {item}
                </li>
              ))}
            </ul>

            <button
              type="button"
              onClick={() => openAuthModal("signup")}
              className="mt-8 inline-flex h-11 w-full items-center justify-center rounded-control bg-brand text-sm font-semibold text-background outline-none transition hover:-translate-y-0.5 hover:bg-brand-strong focus-visible:ring-2 focus-visible:ring-brand/40"
            >
              Get started free
            </button>
          </div>

          {/* ------------------------------- PRO ------------------------------- */}
          <div data-testid="pricing-pro" className="flex flex-col rounded-panel border border-dashed border-border bg-surface/60 p-8">
            <div className="flex items-center justify-between gap-2">
              <p className="text-caption uppercase tracking-widest text-faint">Pro</p>
              <Badge variant="warning">
                <Clock className="h-3 w-3" strokeWidth={2.5} />
                Planned — not yet available
              </Badge>
            </div>
            <div className="mt-2 flex items-baseline gap-2 tabular-nums">
              {currency === "INR" ? (
                <>
                  <span className="text-4xl font-semibold tracking-tight text-foreground">₹4,999</span>
                  <span className="text-sm text-muted">/ year</span>
                </>
              ) : (
                <>
                  <span className="text-4xl font-semibold tracking-tight text-foreground">$19</span>
                  <span className="text-sm text-muted">/ month, or $180 / year</span>
                </>
              )}
            </div>
            <p className="mt-1 text-sm text-muted">
              Intended pricing. Nothing is purchasable today — this card exists to ask, not to sell.
            </p>

            <ul className="mt-6 flex flex-1 flex-col gap-3">
              {PRO_PLANNED.map((item) => (
                <li key={item} className="flex items-start gap-2.5 text-sm text-muted">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-surface-3 text-faint">
                    <Clock className="h-3 w-3" strokeWidth={2} />
                  </span>
                  <span>
                    {item} <span className="text-caption uppercase tracking-wide text-faint">(planned)</span>
                  </span>
                </li>
              ))}
            </ul>

            <InterestForm currency={currency} />
          </div>
        </div>

        {/* The BYOK cost line — derived from measured prompts, hard output caps,
            and Anthropic's published claude-opus-5 price. See lib/ai/. */}
        <div className="max-w-3xl rounded-panel border border-border bg-surface-2/60 px-5 py-4 text-left">
          <p className="text-sm font-semibold text-foreground">What does “your own Anthropic key” cost?</p>
          <p className="mt-1.5 text-pretty text-sm leading-relaxed text-muted">
            Anthropic bills you directly at Claude Opus 5’s published rate ($5 per million input
            tokens, $25 per million output). Every UAA call has a hard output cap in code, so the
            worst case per analysis is knowable, not open-ended:{" "}
            <span className="tabular-nums text-foreground">≈ 2¢</span> for a quick parse or calendar
            brief (low effort), <span className="tabular-nums text-foreground">≈ 3¢</span> for a
            movement explainer or watchlist digest (medium), and{" "}
            <span className="tabular-nums text-foreground">≈ 5–6¢</span> for a full research verdict
            (high effort). Figures use production-recorded prompt sizes with output at each task’s
            configured cap; richer dossiers cost proportionally more input at $5 per million tokens.
            Every screen’s computed numbers are free — the engines run on your machine.
          </p>
        </div>
      </Reveal>
    </section>
  );
}
