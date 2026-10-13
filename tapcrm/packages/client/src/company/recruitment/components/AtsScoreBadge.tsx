import { atsScoreBand, type AtsScanSummary, type AtsScoreTone } from '@tapcrm/contracts';

export type AtsTone = AtsScoreTone | 'review' | 'none';

/** Badge colours per score band; same palette family as the recruitment status badges. */
export const ATS_TONE_CLASSES: Readonly<Record<AtsTone, string>> = {
  strong: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  good: 'border-teal-500/25 bg-teal-500/10 text-teal-700 dark:text-teal-300',
  partial: 'border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300',
  low: 'border-rose-500/25 bg-rose-500/10 text-rose-700 dark:text-rose-300',
  review: 'border-sky-500/25 bg-sky-500/10 text-sky-700 dark:text-sky-300',
  none: 'border-app-border bg-app-surface-raised text-app-muted',
};

/** Ring and bar colours that read in both themes. */
export const ATS_TONE_STROKE: Readonly<Record<AtsTone, string>> = {
  strong: '#10b981',
  good: '#14b8a6',
  partial: '#f59e0b',
  low: '#f43f5e',
  review: '#0ea5e9',
  none: 'var(--app-border)',
};

export function atsTone(status: 'completed' | 'needs_review', score: number | null, missingRequired = 0): AtsTone {
  if (status === 'needs_review' || score === null) return 'review';
  return atsScoreBand(score, missingRequired).tone;
}

export function atsLabel(status: 'completed' | 'needs_review', score: number | null, missingRequired = 0): string {
  if (status === 'needs_review' || score === null) return 'Needs review';
  return atsScoreBand(score, missingRequired).label;
}

/** Latest ATS result for a Resume Inbox row. */
export function AtsScoreBadge({
  summary,
}: {
  readonly summary: AtsScanSummary | null | undefined;
}): React.JSX.Element {
  if (!summary) {
    return (
      <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${ATS_TONE_CLASSES.none}`}>
        Not scanned
      </span>
    );
  }

  const tone = atsTone(summary.status, summary.score, summary.missingRequired);
  const label = atsLabel(summary.status, summary.score, summary.missingRequired);
  const details = [
    summary.missingRequired > 0 ? `${summary.missingRequired} must-have${summary.missingRequired === 1 ? '' : 's'} missing` : null,
    summary.stale ? 'Criteria changed' : null,
  ].filter(Boolean);

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <span
        className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-semibold ${ATS_TONE_CLASSES[tone]}`}
        title={`ATS ${summary.score === null ? 'needs manual review' : `score ${summary.score}/100`} · scanned ${new Date(summary.scannedAt).toLocaleString()}`}
      >
        {summary.score !== null && <span className="tabular-nums">{summary.score}</span>}
        <span>{label}</span>
      </span>
      {details.length > 0 && (
        <span className={`text-[11px] ${summary.stale ? 'text-amber-700 dark:text-amber-300' : 'text-app-muted'}`}>
          {details.join(' · ')}
        </span>
      )}
    </span>
  );
}
