/** The API serializes date columns as full ISO timestamps; render them as a plain date. */
export function formatProjectDate(value: string | null): string {
  if (!value) return '—';
  const parsed = new Date(value);
  if (isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}
