import { LoadingMark } from "./loading-mark";

/**
 * The standard "this block is still loading" placeholder: a panel of the right
 * height with the brand mark doing the loading, instead of a grey pulsing
 * rectangle pretending to be content. Fixed-height by design so mounting the
 * real component in doesn't shift layout or measure a 0-height chart container.
 */
export function LoadingPanel({
  height = "h-40",
  message,
  markSize = 22,
  className = "",
}: {
  /** Height utility matching the real component's rendered height. */
  height?: string;
  /** Optional caption — worth it when the wait is long enough to explain. */
  message?: string;
  markSize?: number;
  className?: string;
}) {
  return (
    <div
      className={`flex ${height} w-full flex-col items-center justify-center gap-3 rounded-card border border-border bg-surface ${className}`}
    >
      <LoadingMark size={markSize} label={message ?? "Loading"} />
      {message && <p className="px-6 text-center text-caption text-muted">{message}</p>}
    </div>
  );
}

/**
 * Inline variant for a single row of text — the mark plus a label, no panel.
 */
export function LoadingLine({ message, className = "" }: { message: string; className?: string }) {
  return (
    <div className={`flex items-center gap-2.5 text-sm text-muted ${className}`}>
      <LoadingMark size={16} className="shrink-0" label={message} />
      {message}
    </div>
  );
}
