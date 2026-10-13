import type { PayrollStatus, PenaltyStatus } from '../types/index.js';

export function PenaltyStatusBadge({
  status,
}: {
  status: PenaltyStatus;
}): React.JSX.Element {
  const classes =
    status === 'active'
      ? 'bg-amber-500/15 text-amber-800 dark:text-amber-200'
      : 'bg-app-surface-raised text-app-muted';
  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${classes}`}
    >
      {status}
    </span>
  );
}

export function PayrollStatusBadge({
  status,
}: {
  status: PayrollStatus;
}): React.JSX.Element {
  const classes =
    status === 'pending'
      ? 'bg-sky-500/15 text-sky-800 dark:text-sky-200'
      : status === 'processed'
        ? 'bg-violet-500/15 text-violet-800 dark:text-violet-200'
        : 'bg-emerald-500/15 text-emerald-800 dark:text-emerald-200';
  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${classes}`}
    >
      {status}
    </span>
  );
}
