import type { GroundingReport } from "@/lib/ai/types";

/**
 * Honest, verified signal of how well an AI answer's figures trace back to the
 * evidence it was given — a shared replacement for self-asserted "confidence".
 *
 * Rendered by every AI feature that produces prose over company data (copilot,
 * verdict, compare, IC agents) so the same signal reads the same way platform
 * wide. Presentational only; it takes the report the server already computed.
 */
export function GroundingBadge({
  grounding,
  className = "",
  label = "Grounding",
}: {
  grounding: GroundingReport;
  className?: string;
  label?: string;
}) {
  const { level, numbersChecked, unsupportedNumbers, flags } = grounding;

  // Nothing quantitative was claimed — there is nothing to attest to.
  if (numbersChecked === 0) return null;

  const grounded = numbersChecked - unsupportedNumbers.length;
  const tone =
    level === "high" ? "text-positive" : level === "medium" ? "text-warning" : "text-negative";
  const text =
    unsupportedNumbers.length === 0
      ? `All ${numbersChecked} figures trace to sources`
      : `${grounded}/${numbersChecked} figures trace to sources`;
  const title = flags.length ? flags.join("\n") : "Every figure was matched to the source data.";

  return (
    <div className={`flex items-center gap-1.5 text-xs ${className}`} title={title}>
      <span className={tone} aria-hidden>
        {level === "high" ? "●" : "▲"}
      </span>
      <span className="text-muted">{label}:</span>
      <span className={tone}>{text}</span>
    </div>
  );
}
