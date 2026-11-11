import type { CallDirection, CallOutcome, ConnectionStatus, MatchMethod, SyncStatus, TelephonyProvider } from './api.js';

/** Pure display helpers for Call Analytics. No React, so they are unit-tested. */

export const PROVIDER_NAMES: Readonly<Record<TelephonyProvider, string>> = {
  justcall: 'JustCall',
  aircall: 'Aircall',
};

export const OUTCOME_LABELS: Readonly<Record<CallOutcome, string>> = {
  answered: 'Answered',
  missed: 'Missed',
  voicemail: 'Voicemail',
  abandoned: 'Abandoned',
  unanswered: 'Not answered',
  busy: 'Busy',
  failed: 'Failed',
  other: 'Other',
};

/** Tailwind classes for an outcome pill, using the app's semantic colours. */
export function outcomeTone(outcome: CallOutcome): string {
  switch (outcome) {
    case 'answered':
      return 'border-app-success/30 bg-app-success/10 text-app-success';
    case 'missed':
    case 'abandoned':
    case 'failed':
      return 'border-app-danger/30 bg-app-danger/10 text-app-danger';
    case 'voicemail':
      return 'border-app-accent/30 bg-app-accent/10 text-app-accent';
    default:
      return 'border-app-border bg-app-surface-raised text-app-muted';
  }
}

export function directionLabel(direction: CallDirection): string {
  return direction === 'inbound' ? 'Incoming' : 'Outgoing';
}

export const CONNECTION_STATUS_LABELS: Readonly<Record<ConnectionStatus, string>> = {
  active: 'Connected',
  paused: 'Paused',
  error: 'Needs attention',
  disconnected: 'Disconnected',
};

export function connectionTone(status: ConnectionStatus): string {
  if (status === 'active') return 'border-app-success/30 bg-app-success/10 text-app-success';
  if (status === 'error') return 'border-app-danger/30 bg-app-danger/10 text-app-danger';
  return 'border-app-border bg-app-surface-raised text-app-muted';
}

export const SYNC_STATUS_LABELS: Readonly<Record<SyncStatus, string>> = {
  running: 'Syncing…',
  succeeded: 'Up to date',
  partial: 'Partly synced',
  failed: 'Sync failed',
};

export const MATCH_LABELS: Readonly<Record<MatchMethod, string>> = {
  none: 'Not matched',
  email: 'Matched by email',
  manual: 'Mapped by hand',
  ignored: 'Not an employee',
};

/** "1h 02m", "4m 05s", "38s". */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds <= 0) return '0s';
  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, '0')}m`;
  if (minutes > 0) return `${minutes}m ${String(rest).padStart(2, '0')}s`;
  return `${rest}s`;
}

/** Talk time in hours for headline tiles: "12.4 h", or minutes below an hour. */
export function formatTalkTime(seconds: number): string {
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  return `${(seconds / 3600).toFixed(seconds < 36_000 ? 1 : 0)} h`;
}

export function percent(part: number, whole: number): string {
  if (!whole) return '—';
  return `${Math.round((part / whole) * 100)}%`;
}

/** "+91 98765 43210" stays readable; bare digits are grouped lightly. */
export function formatPhone(value: string | null | undefined): string {
  if (!value) return 'Unknown number';
  if (!value.startsWith('+')) return value;
  const digits = value.slice(1);
  if (digits.startsWith('91') && digits.length === 12) return `+91 ${digits.slice(2, 7)} ${digits.slice(7)}`;
  if (digits.startsWith('1') && digits.length === 11) return `+1 ${digits.slice(1, 4)} ${digits.slice(4, 7)} ${digits.slice(7)}`;
  if (digits.startsWith('4420') && digits.length === 12) return `+44 20 ${digits.slice(4, 8)} ${digits.slice(8)}`;
  if (digits.startsWith('44') && digits.length === 12) return `+44 ${digits.slice(2, 6)} ${digits.slice(6)}`;
  return `+${digits.replace(/(\d{1,3})(?=(\d{3})+(?!\d))/g, '$1 ')}`;
}

export function formatCallTime(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat(undefined, {
    timeZone,
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(iso));
}

export function formatDay(day: string): string {
  return new Intl.DateTimeFormat(undefined, { timeZone: 'UTC', day: 'numeric', month: 'short' }).format(new Date(`${day}T00:00:00Z`));
}

export function timeAgo(iso: string | null, now: Date = new Date()): string {
  if (!iso) return 'never';
  const seconds = Math.round((now.getTime() - new Date(iso).getTime()) / 1000);
  if (seconds < 45) return 'just now';
  if (seconds < 3600) return `${Math.round(seconds / 60)} min ago`;
  if (seconds < 86_400) return `${Math.round(seconds / 3600)} h ago`;
  const days = Math.round(seconds / 86_400);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}

/* ------------------------------------------------------------------ *
 * Date ranges — calendar days in the company's timezone.
 * ------------------------------------------------------------------ */

export type RangePreset = 'today' | '7d' | '30d' | 'month' | '90d' | 'custom';

export const RANGE_LABELS: Readonly<Record<RangePreset, string>> = {
  today: 'Today',
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
  month: 'This month',
  '90d': 'Last 90 days',
  custom: 'Custom',
};

export function localDate(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(instant);
}

export function shiftDay(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function presetRange(preset: Exclude<RangePreset, 'custom'>, timeZone: string, now: Date = new Date()): { from: string; to: string } {
  const today = localDate(now, timeZone);
  switch (preset) {
    case 'today':
      return { from: today, to: today };
    case '7d':
      return { from: shiftDay(today, -6), to: today };
    case 'month':
      return { from: `${today.slice(0, 8)}01`, to: today };
    case '90d':
      return { from: shiftDay(today, -89), to: today };
    default:
      return { from: shiftDay(today, -29), to: today };
  }
}

/** Compact day labels for a chart axis: every day for a week, fewer for longer spans. */
export function axisLabelEvery(days: number): number {
  if (days <= 10) return 1;
  if (days <= 31) return 5;
  if (days <= 92) return 14;
  return 30;
}
