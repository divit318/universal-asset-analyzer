/**
 * The Wire's one strength-meter color grammar (theme momentum, sector rotation
 * strength). These are 0-100 SIGNAL-STRENGTH meters, not asset scores — they
 * deliberately use the neutral accent for the middle band rather than the
 * warning color the canonical score meter (lib/recommendation.ts) uses,
 * because a moderate signal is not a caution.
 *
 * One definition, because the two wire cards previously banded at 70/45 and
 * 70/40 respectively — the same bar filling the same amount in two shades.
 */
export function strengthBarTone(value: number): string {
  if (value >= 70) return "bg-positive";
  if (value >= 45) return "bg-accent";
  return "bg-muted/40";
}
