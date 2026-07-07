interface PageShellProps {
  children: React.ReactNode;
  /** Tailwind gap utility for the top-level stack. Default matches most pages. */
  gap?: string;
  /** Tailwind vertical padding utility. Home uses a taller "py-16" hero pass. */
  py?: string;
  className?: string;
}

/** Shared page container — max-w-7xl, consistent gutters, used by every top-level route. */
export function PageShell({ children, gap = "gap-8", py = "py-8", className = "" }: PageShellProps) {
  return (
    <div className={`mx-auto flex w-full max-w-7xl flex-1 flex-col ${gap} px-6 ${py} ${className}`}>
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
