/**
 * Formats a minute count as hours + minutes ("2h 5m", "2h", "45m") instead of
 * a raw minute total ("125 min"). Fractions are rounded; null/negative → "0m".
 */
export function formatMinutes(minutes: number | null | undefined): string {
  const total = Math.max(0, Math.round(minutes ?? 0));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}
