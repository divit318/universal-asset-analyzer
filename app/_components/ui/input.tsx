interface FieldProps {
  label: string;
  hint?: string;
  children: React.ReactNode;
}

/** Consistent focus/border treatment for all text inputs. */
export function Input({ className = "", ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full rounded-control border border-border bg-surface-2 px-3 py-2 text-sm outline-none transition-[border-color,box-shadow] placeholder:text-faint focus:border-brand focus:ring-2 focus:ring-brand/25 disabled:opacity-60 ${className}`}
    />
  );
}

/** Label + hint wrapper around a single form field. */
export function Field({ label, hint, children }: FieldProps) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-muted">{label}</span>
      {children}
      {hint && <span className="text-xs text-muted">{hint}</span>}
    </label>
  );
}
