import { aiAttribution } from "@/lib/ai/availability";

/**
 * The one AI-attribution chip.
 *
 * Every surface that renders model-written text shows this instead of a
 * hand-written "Local AI" pill: given the model id that actually produced the
 * output it says "Local AI · mistral" or "Hosted AI · claude-opus-5-low", and
 * "AI" when the model is unknown. The tooltip states exactly where the
 * generation ran and what left the machine — see lib/ai/availability.ts for
 * why a static "local" label is not allowed to exist anymore.
 */
export function AiBadge({ model, className }: { model?: string | null; className?: string }) {
  const a = aiAttribution(model);
  return (
    <span
      className={
        className ??
        "rounded-full border border-brand/30 bg-brand/10 px-2 py-0.5 text-label font-semibold uppercase tracking-widest text-brand"
      }
      title={a.title}
    >
      {a.badge}
    </span>
  );
}
