import { scoreTone } from "@/lib/recommendation";

/** Color-coded 0-100 composite-score badge. `lg` for the headline Overall.
 *  Colored via the canonical recommendation bands so a given score reads the
 *  same on the Screener as it does on the research Score Card. */
export function ScoreChip({ value, lg }: { value: number | null; lg?: boolean }) {
  if (value == null) {
    return <span className="text-muted">—</span>;
  }
  const tone = scoreTone(value);
  return (
    <span
      className={`inline-flex items-center justify-center rounded-md border font-mono font-semibold ${tone} ${
        lg ? "h-8 w-10 text-sm" : "h-6 w-8 text-xs"
      }`}
    >
      {value}
    </span>
  );
}
