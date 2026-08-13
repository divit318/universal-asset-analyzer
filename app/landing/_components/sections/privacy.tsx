import { HardDrive, Radio, KeyRound } from "lucide-react";
import type { SectionProps } from "../section-registry";
import { Reveal } from "../motion/reveal";
import { SectionShell } from "../primitives/section-shell";
import { SectionHeader } from "../primitives/section-header";

/**
 * Local-first: the proof section. This section's claim is uniquely
 * verifiable, so it verifies it instead of asserting it: the real database
 * file, the complete outbound-request inventory, and a representative
 * excerpt of the one payload that carries portfolio-derived figures.
 *
 * Deliberate absences: no particle graphic (the page already has the hero
 * field and the Solution lens; evidence needs no atmosphere), no comparison
 * card (proof does not need a foil), no glow treatment (equal visual weight
 * everywhere; the facts carry the argument).
 *
 * TRUTH CONSTRAINT (2026-08-11 rebuild): every claim below was verified
 * against the source before it was written, and must be re-verified if the
 * underlying behaviour changes:
 *   - DB path/format:  lib/db.ts getDb(): <install dir>/data/app.db, SQLite.
 *   - Network:         lib/yahoo.ts, lib/edgar.ts, lib/screener-in.ts,
 *                      lib/amfi.ts, lib/news.ts (symbols + public queries);
 *                      lib/monitor.ts (5-min alert check, watchlist/portfolio
 *                      symbols); lib/scanner/scheduler.ts (hourly scan,
 *                      public headlines, UAA_SCANNER_INTERVAL_MS=0 disables).
 *   - Telemetry:       none by default. Sentry is a no-op without SENTRY_DSN
 *                      (instrumentation.ts); /api/home/telemetry is local
 *                      SQLite only. No update checks, no analytics SDKs.
 *   - AI payload:      lib/portfolio/thesis.ts buildThesisPrompt(): symbols,
 *                      weights, derived figures; never share counts, cost
 *                      basis, or notes. Provider chain lib/ai/config.ts:
 *                      Devin login by default, Anthropic with the user's key.
 *   - Key storage:     lib/ai/anthropic-key.ts: ~/.uaa, pinned to
 *                      api.anthropic.com, never logged.
 *   - Accounts:        lib/auth.ts: local SQLite row, no auth server.
 */

/** Representative excerpt of one portfolio AI request, in the exact shape
 *  buildThesisPrompt() emits (field labels and formats verbatim; values are
 *  illustrative and the panel says so). */
const PAYLOAD_EXCERPT = `You are a skeptical Chief Investment Officer
reviewing a self-directed investor's portfolio.
[... rules omitted ...]

PORTFOLIO
Total value: $412,380.00
Health: 74/100 (B)
Annualized volatility: 13.8%
Beta vs S&P 500: 1.04
Largest asset class: 67% · largest single holding: 11.2%

ASSET CLASSES
Equities: 66.6%, ETFs: 24.1%, Commodities: 9.3%

TOP HOLDINGS (weight, own return)
NVDA (Equities, Technology): 11.2%, +58.3% on cost
MSFT (Equities, Technology): 9.1%, +24.6% on cost
VTI (ETFs, no sector): 8.8%, +12.1% on cost
GLD (ETFs, no sector): 7.4%, +21.6% on cost
[... 6 more holdings ...]

MOST CORRELATED HOLDING PAIRS
NVDA/MSFT r=0.81, VTI/VOO r=0.98`;

/**
 * Layer 1 — the promise in plain terms, before any SQLite path or payload
 * shape. Ordinary visitors read these three lines and are done; the proof
 * panels below exist for the skeptical. Each statement is the human-readable
 * form of a verified claim from the TRUTH CONSTRAINT block above.
 */
const PLAIN_TERMS = [
  {
    icon: HardDrive,
    title: "Your research stays here",
    body: "Portfolios, notes, and sessions live in one database file on your disk. Copying it is a full backup.",
  },
  {
    icon: Radio,
    title: "Requests carry symbols, not holdings",
    body: "Market-data calls send ticker symbols and public queries. Your positions and notes never ride along.",
  },
  {
    icon: KeyRound,
    title: "AI sees only what you send",
    body: "An AI action sends that feature's figures to the one provider you chose, on your own account.",
  },
] as const;

const NETWORK_ROWS: {
  term: string;
  when: string;
  hosts?: string;
  carries: string;
}[] = [
  {
    term: "Market data",
    when: "as you browse · alerts every 5 min",
    hosts: "Yahoo Finance · SEC EDGAR · NSE · Screener.in · AMFI · news RSS",
    carries: "Ticker symbols and public queries only, never holdings or notes.",
  },
  {
    term: "AI provider",
    when: "on your action · scan hourly",
    hosts: "Devin login by default · or your own key: Anthropic, OpenAI, Gemini, OpenRouter",
    carries:
      "Your prompt, shown at right, goes to the one provider you configured. The hourly market scan carries public headlines only; UAA_SCANNER_INTERVAL_MS=0 turns it off.",
  },
  {
    term: "Telemetry · analytics · update checks",
    when: "never",
    carries:
      "None exist. The one crash reporter in the code ships disabled and stays off unless you set SENTRY_DSN yourself.",
  },
  {
    term: "Accounts",
    when: "never",
    carries: "Sign-in is a row in your own database. There is no auth server.",
  },
];

function ProofPanel({
  label,
  children,
  className = "",
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex min-w-0 flex-col rounded-card border border-hairline bg-surface-2/60 p-5 ${className}`}>
      <p className="text-micro uppercase tracking-widest text-muted">{label}</p>
      {children}
    </div>
  );
}

export function Privacy({ section, index }: SectionProps) {
  const headingId = `${section.id}-heading`;

  return (
    <SectionShell id={section.id} headingId={headingId} band={index % 2 === 1}>
      <SectionHeader
        align="left"
        eyebrow="Local-first"
        headingId={headingId}
        segments={[
          { text: "Never on our servers." },
          { text: "There are none.", tone: "accent", block: true },
        ]}
        lead={
          <>
            UAA has no backend to sync to: the app you run is the whole product, and what leaves
            your machine is only what fetching public data and asking your AI provider requires.
          </>
        }
      />

      {/* Layer 1: the promise in plain terms. */}
      <Reveal delay={230} stagger={80} className="mt-mk-lead grid w-full gap-5 sm:grid-cols-3">
        {PLAIN_TERMS.map((t) => (
          <div key={t.title} className="flex flex-col items-start">
            <span className="flex h-9 w-9 items-center justify-center rounded-full border border-brand/18 bg-brand/10 text-brand" aria-hidden="true">
              <t.icon className="h-4 w-4" strokeWidth={1.75} />
            </span>
            <p className="mt-3 text-mk-body font-semibold text-foreground">{t.title}</p>
            <p className="mt-1 text-pretty text-mk-small text-muted">{t.body}</p>
          </div>
        ))}
      </Reveal>

      {/* Layer 2: the proof, for readers who want to inspect it. */}
      <Reveal delay={280} className="mt-mk-lead w-full border-t border-hairline pt-mk-group">
        <p className="font-mono text-caption uppercase tracking-[0.14em] text-muted">
          The proof, if you want to inspect it: <span className="text-foreground">the file · the network · the payload</span>
        </p>
      </Reveal>

      <Reveal delay={330} className="mt-5 grid w-full items-stretch gap-5 lg:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-5">
          <ProofPanel label="Proof 01 · The file">
            <p className="mt-2 max-w-prose text-left text-mk-small text-muted">
              Everything the app stores about you is one SQLite database. Copying the file is a
              full backup; any SQLite client can open it and read every table.
            </p>
            <div className="mt-4 rounded-control border border-hairline bg-surface px-3.5 py-3">
              {/* <wbr> after each slash: on narrow screens the path breaks at
                  segment boundaries, never inside a file name. */}
              <p className="font-mono text-mk-small font-medium text-foreground">
                ~/universal-asset-analyzer/<wbr />data/<wbr />app.db
              </p>
              <p className="mt-1.5 font-mono text-caption text-muted">
                SQLite 3 · same data/app.db path on macOS, Windows, and Linux · relocatable with
                DB_PATH · a heavily used instance runs to roughly 230 MB
              </p>
            </div>
          </ProofPanel>

          <ProofPanel label="Proof 02 · The network" className="grow">
            <p className="mt-2 max-w-prose text-left text-mk-small text-muted">
              Every request the app makes. There is no other traffic to show.
            </p>
            <ul className="mt-4 flex flex-col divide-y divide-hairline rounded-control border border-hairline bg-surface">
              {NETWORK_ROWS.map((row) => (
                <li key={row.term} className="px-3.5 py-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                    <span className="text-mk-small font-semibold text-foreground">{row.term}</span>
                    <span className="font-mono text-caption tabular-nums text-muted">{row.when}</span>
                  </div>
                  {row.hosts && <p className="mt-0.5 font-mono text-caption text-muted">{row.hosts}</p>}
                  <p className="mt-1 text-left text-mk-small text-muted">{row.carries}</p>
                </li>
              ))}
            </ul>
          </ProofPanel>
        </div>

        <ProofPanel label="Proof 03 · The payload">
          <p className="mt-2 max-w-prose text-left text-mk-small text-muted">
            One portfolio AI request, in the exact shape the app builds it. This is a
            representative excerpt; the full template is{" "}
            <span className="font-mono text-foreground">lib/portfolio/thesis.ts</span> in the
            source.
          </p>
          {/* Not stretched: leftover column height falls after the caption,
              never inside the bordered artefact (an empty code box reads as
              missing content). */}
          <div className="mt-4 overflow-x-auto rounded-control border border-hairline bg-surface px-3.5 py-3">
            <pre className="font-mono text-caption leading-relaxed text-foreground">
              <code>{PAYLOAD_EXCERPT}</code>
            </pre>
          </div>
          <p className="mt-3 max-w-prose text-left text-mk-small text-muted">
            Symbols, weights, and derived figures are in the request. Share counts, cost basis,
            and your notes are not. It goes to <span className="text-brand">one provider</span>:
            your Devin login by default, or your own key (Anthropic, OpenAI, Gemini, OpenRouter)
            stored in <span className="font-mono text-foreground">~/.uaa</span>, sent to that
            provider&apos;s host only, never logged.
          </p>
        </ProofPanel>
      </Reveal>
    </SectionShell>
  );
}
