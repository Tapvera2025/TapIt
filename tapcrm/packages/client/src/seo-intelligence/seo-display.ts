import type { SeoSeverity } from './types.js';

export const SEVERITY_COLORS: Record<SeoSeverity, string> = {
  critical: 'text-red-600 bg-red-50 dark:bg-red-950 dark:text-red-300',
  high: 'text-orange-600 bg-orange-50 dark:bg-orange-950 dark:text-orange-300',
  moderate: 'text-yellow-600 bg-yellow-50 dark:bg-yellow-950 dark:text-yellow-300',
  low: 'text-blue-600 bg-blue-50 dark:bg-blue-950 dark:text-blue-300',
  informational: 'text-gray-500 bg-gray-50 dark:bg-gray-800 dark:text-gray-300',
};

export const IN_FLIGHT_STATUSES: ReadonlySet<string> = new Set([
  'queued',
  'discovering',
  'fetching',
  'rendering',
  'evaluating',
  'aggregating',
]);

export function isScanInFlight(status: string): boolean {
  return IN_FLIGHT_STATUSES.has(status);
}

export function formatElapsed(
  startedAt: Date | string,
  endedAt?: Date | string | null,
): string {
  const start = new Date(startedAt).getTime();
  const end = endedAt ? new Date(endedAt).getTime() : Date.now();
  const seconds = Math.max(0, Math.floor((end - start) / 1000));
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes === 0) return `${remainingSeconds}s`;
  return `${minutes}m ${remainingSeconds}s`;
}

export const STATUS_LABEL: Record<string, string> = {
  queued: 'Queued',
  discovering: 'Discovering URLs',
  fetching: 'Fetching pages',
  rendering: 'Rendering pages',
  evaluating: 'Evaluating rules',
  aggregating: 'Aggregating findings',
};
