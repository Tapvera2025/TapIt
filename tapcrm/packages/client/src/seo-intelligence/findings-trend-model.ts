import type { SeoFindingsTrendPoint, SeoSeverity } from './types.js';

export const TREND_SEVERITIES: SeoSeverity[] = ['critical', 'high', 'moderate', 'low', 'informational'];

export interface FindingsTrendDay {
  day: string;
  counts: Record<SeoSeverity, number>;
  total: number;
}

/** Keep the API's UTC calendar day intact, independent of the browser timezone. */
export function findingsTrendRows(points: SeoFindingsTrendPoint[]): FindingsTrendDay[] {
  const rows = new Map<string, FindingsTrendDay>();
  for (const point of points) {
    const day = point.day;
    const row = rows.get(day) ?? {
      day,
      counts: { critical: 0, high: 0, moderate: 0, low: 0, informational: 0 },
      total: 0,
    };
    row.counts[point.severity] = point.openCount;
    rows.set(day, row);
  }
  return [...rows.values()]
    .sort((a, b) => a.day.localeCompare(b.day))
    .map(row => ({ ...row, total: TREND_SEVERITIES.reduce((sum, severity) => sum + row.counts[severity], 0) }));
}

export function formatTrendDay(day: string, long = false): string {
  return new Intl.DateTimeFormat(undefined, {
    timeZone: 'UTC',
    month: long ? 'long' : 'short',
    day: 'numeric',
    ...(long ? { year: 'numeric' } : {}),
  }).format(new Date(`${day}T00:00:00Z`));
}
