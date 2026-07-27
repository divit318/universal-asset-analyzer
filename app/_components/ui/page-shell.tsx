/**
 * How wide a page is allowed to get.
 *
 * `reading` (max-w-7xl, 1280px) is the right measure for prose and for report
 * surfaces — an IC memo or an AI brief set 1900px wide is unreadable.
 *
 * `wide` (max-w-[1920px]) is for surfaces whose job is to show a lot of aligned
 * numbers at once: the screener, a watchlist, a holdings table, a comparison, a
 * graph canvas. Capping those at 1280px left roughly a third of a 2000px display
 * as permanent dead margin while the table it contained was horizontally
 * scrolling — the single most "not a professional tool" thing about the layout.
 *
 * Two deliberate widths, chosen per surface. Not one compromise for both.
 */
export type ShellWidth = "reading" | "wide";

const WIDTH_CLASS: Record<ShellWidth, string> = {
  reading: "max-w-7xl",
  // Beyond ~1920px, line lengths and pointer travel stop paying for themselves
  // even in a data grid, so this is a real cap rather than `max-w-none`.
  wide: "max-w-[1920px]",
};

interface PageShellProps {
  children: React.ReactNode;
  /** Tailwind gap utility for the top-level stack. Default matches most pages. */
  gap?: string;
  /** Tailwind vertical padding utility. Home uses a taller "py-16" hero pass. */
  py?: string;
  /** Reading measure (default) or a wide data grid. See {@link ShellWidth}. */
  width?: ShellWidth;
  className?: string;
}

/** Shared page container — consistent gutters, used by every top-level route. */
export function PageShell({
  children,
  gap = "gap-8",
  py = "py-8",
  width = "reading",
  className = "",
}: PageShellProps) {
  return (
    <div
      className={`mx-auto flex w-full ${WIDTH_CLASS[width]} flex-1 flex-col ${gap} px-6 ${py} ${className}`}
    >
      {children}
    </div>
  );
}

interface PageHeaderProps {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}

/** Title + description + right-aligned action row, used at the top of every page. */
export function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

interface SectionHeaderProps {
  label: string;
  description?: string;
  actions?: React.ReactNode;
}

/** Uppercase label + hairline rule used to separate stacked sections on a page. */
export function SectionHeader({ label, description, actions }: SectionHeaderProps) {
  return (
    <div className="flex items-end gap-4">
      <div className="flex flex-col gap-0.5">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-muted/60">{label}</h2>
        {description && <p className="text-sm text-muted">{description}</p>}
      </div>
      <div className="mb-1 h-px flex-1 bg-border" />
      {actions}
    </div>
  );
}
