import type { Metadata } from "next";
import { PageShell } from "@/app/_components/ui";

export const metadata: Metadata = { title: "Design Tokens" };

/**
 * /dev/tokens — the design-token swatch page.
 *
 * A review surface, not a product surface: every color, type tier, radius and
 * shadow the system owns, rendered from the live tokens so what you approve is
 * what ships. Both themes are shown side by side by re-scoping `data-theme` on
 * a wrapper — the same attribute mechanism the app root uses, so each panel is
 * a faithful render of that theme, not a screenshot.
 *
 * The hex annotations are informative labels (kept in sync with
 * app/globals.css by eye); the swatch fill itself always reads the live token.
 */

interface SwatchDef {
  token: string;
  label: string;
  dark: string;
  light: string;
  note?: string;
}

const SURFACES: SwatchDef[] = [
  { token: "--background", label: "background", dark: "#0a0b0e", light: "#f7f8fa" },
  { token: "--surface", label: "surface", dark: "#131519", light: "#ffffff" },
  { token: "--surface-2", label: "surface-2", dark: "#1a1d23", light: "#f4f6f9" },
  { token: "--surface-3", label: "surface-3", dark: "#23272f", light: "#e9edf2" },
  { token: "--border", label: "border", dark: "#282d37", light: "#e2e6ec" },
  { token: "--border-strong", label: "border-strong", dark: "#384049", light: "#cdd4dd" },
  { token: "--foreground", label: "foreground (ink)", dark: "#edeff2", light: "#101722" },
  { token: "--muted", label: "muted", dark: "#99a3b2", light: "#4d5564" },
  { token: "--faint", label: "faint", dark: "#626c7a", light: "#656f7d" },
];

const BRAND: SwatchDef[] = [
  { token: "--brand", label: "brand (brass)", dark: "#c8a96e", light: "#7a5f33", note: "The one accent. Verdicts, primary actions, verified state, focus rings." },
  { token: "--brand-strong", label: "brand-strong (brass lit)", dark: "#e2c489", light: "#5f4a26", note: "Hover / lit brass." },
];

const SEMANTIC: SwatchDef[] = [
  { token: "--positive", label: "positive", dark: "#4ade80", light: "#15803d", note: "Gains. Data only, never chrome." },
  { token: "--negative", label: "negative", dark: "#f87171", light: "#b91c1c", note: "Losses. Data only, never chrome." },
  { token: "--warning", label: "warning (signal orange)", dark: "#fb923c", light: "#ad4a08", note: "Cautions. Orange, not amber — never confusable with a brass verdict." },
];

const CHARTS: SwatchDef[] = [
  { token: "--chart-1", label: "chart-1 violet", dark: "#a855f7", light: "#9333ea" },
  { token: "--chart-2", label: "chart-2 steel", dark: "#60a5fa", light: "#2563eb", note: "The retired brand sky-blue, returned to the data." },
  { token: "--chart-3", label: "chart-3 teal", dark: "#2dd4bf", light: "#0d9488" },
  { token: "--chart-4", label: "chart-4 pink", dark: "#f472b6", light: "#db2777" },
  { token: "--chart-5", label: "chart-5 slate", dark: "#64748b", light: "#64748b" },
];

function SwatchRow({ def, scheme }: { def: SwatchDef; scheme: "dark" | "light" }) {
  return (
    <div className="flex items-center gap-3">
      <span
        className="h-9 w-9 shrink-0 rounded-control border border-border"
        style={{ backgroundColor: `var(${def.token})` }}
        aria-hidden="true"
      />
      <div className="min-w-0">
        <p className="truncate text-sm text-foreground">
          {def.label}
          <code className="nums ml-2 font-mono text-caption text-faint">{scheme === "dark" ? def.dark : def.light}</code>
        </p>
        {def.note && <p className="text-caption text-muted">{def.note}</p>}
      </div>
    </div>
  );
}

function SwatchGroup({ title, defs, scheme }: { title: string; defs: SwatchDef[]; scheme: "dark" | "light" }) {
  return (
    <div>
      <h3 className="text-label font-semibold uppercase tracking-widest text-faint">{title}</h3>
      <div className="mt-3 flex flex-col gap-2.5">
        {defs.map((d) => <SwatchRow key={d.token} def={d} scheme={scheme} />)}
      </div>
    </div>
  );
}

function ThemePanel({ scheme }: { scheme: "dark" | "light" }) {
  return (
    <div
      data-theme={scheme}
      className="flex-1 rounded-panel border border-border bg-background p-6 text-foreground"
    >
      <h2 className="text-lg font-semibold tracking-tight">{scheme === "dark" ? "Dark (default)" : "Light"}</h2>

      <div className="mt-6 grid gap-8 sm:grid-cols-2">
        <SwatchGroup title="Surfaces & ink" defs={SURFACES} scheme={scheme} />
        <div className="flex flex-col gap-8">
          <SwatchGroup title="Brand — the one accent" defs={BRAND} scheme={scheme} />
          <SwatchGroup title="Financial semantics" defs={SEMANTIC} scheme={scheme} />
          <SwatchGroup title="Categorical charts" defs={CHARTS} scheme={scheme} />
        </div>
      </div>

      {/* Applied samples — tokens in their real roles */}
      <div className="mt-8 flex flex-col gap-3 rounded-card border border-border bg-surface p-4">
        <p className="font-serif text-2xl font-semibold tracking-tight">
          The judgment serif, <span className="text-brand">seen in brass.</span>
        </p>
        <p className="text-sm leading-relaxed text-muted">
          Interface prose is Geist. Numbers are Geist Mono with tabular figures:{" "}
          <span className="nums font-mono text-foreground">1,234.56 · +12.4% · 0.987</span>
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <button className="rounded-control bg-brand px-3.5 py-1.5 text-sm font-semibold text-background">Primary action</button>
          <button className="rounded-control border border-border bg-surface px-3.5 py-1.5 text-sm font-semibold text-foreground">Secondary</button>
          <span className="rounded-full bg-brand-muted px-2.5 py-0.5 text-caption font-semibold text-brand">Verified · traces to source</span>
          <span className="text-sm text-positive nums">+2.41%</span>
          <span className="text-sm text-negative nums">−1.08%</span>
          <span className="text-sm text-warning">Data aging</span>
        </div>
      </div>

      {/* Type scale */}
      <div className="mt-6 rounded-card border border-border bg-surface p-4">
        <h3 className="text-label font-semibold uppercase tracking-widest text-faint">Type scale</h3>
        <div className="mt-3 flex flex-col gap-1.5">
          <p className="text-micro uppercase tracking-widest text-muted">micro 9px — pill / badge labels</p>
          <p className="text-label uppercase tracking-widest text-muted">label 10px — micro-headers, tabular numerics</p>
          <p className="text-caption text-muted">caption 11px — secondary captions</p>
          <p className="text-sm text-foreground">sm 14px — body / UI default</p>
          <p className="text-base text-foreground">base 16px — long-form reading</p>
          <p className="text-2xl font-semibold tracking-tight text-foreground">2xl — section headings</p>
          <p className="font-serif text-4xl font-semibold tracking-tight text-foreground">4xl serif — hero only</p>
        </div>
      </div>
    </div>
  );
}

export default function TokensPage() {
  return (
    <PageShell>
      <div className="animate-page-enter py-8">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Design tokens</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          The committed palette (brand book Phase 1), rendered live from the CSS custom properties in{" "}
          <code className="font-mono text-caption">app/globals.css</code>. Each panel is scoped to its theme with the
          real <code className="font-mono text-caption">data-theme</code> mechanism.
        </p>
        <div className="mt-6 flex flex-col gap-6 lg:flex-row">
          <ThemePanel scheme="dark" />
          <ThemePanel scheme="light" />
        </div>
      </div>
    </PageShell>
  );
}
