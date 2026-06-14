/** Color-coded 0-100 composite-score badge. `lg` for the headline Overall. */
export function ScoreChip({ value, lg }: { value: number | null; lg?: boolean }) {
  if (value == null) {
    return <span className="text-muted">—</span>;
  }
  const tone =
    value >= 75
      ? "bg-positive/15 text-positive border-positive/30"
      : value >= 55
        ? "bg-accent/15 text-accent border-accent/30"
        : value >= 40
          ? "bg-amber-400/10 text-amber-400 border-amber-400/30"
          : "bg-negative/10 text-negative border-negative/30";
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
