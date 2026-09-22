import type { TaskPriority, TaskStatus } from '../types/index.js';

interface StatusConfig {
  label: string;
  className: string;
  dotColor: string;
}

const STATUS_CONFIGS: Record<TaskStatus, StatusConfig> = {
  pending: {
    label: 'Pending',
    className:
      'border border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300',
    dotColor: 'bg-amber-500',
  },
  in_progress: {
    label: 'In Progress',
    className:
      'border border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300',
    dotColor: 'bg-blue-500',
  },
  completed: {
    label: 'Completed',
    className:
      'border border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
    dotColor: 'bg-emerald-500',
  },
  cancelled: {
    label: 'Cancelled',
    className:
      'border border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300',
    dotColor: 'bg-rose-500',
  },
};

export function TaskStatusBadge({
  status,
  className = '',
}: {
  status: TaskStatus;
  className?: string;
}): React.JSX.Element {
  const config = STATUS_CONFIGS[status] ?? {
    label: status,
    className: 'border border-app-border bg-app-surface text-app-muted',
    dotColor: 'bg-app-muted',
  };

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold tracking-wide ${config.className} ${className}`}
      role="status"
    >
      <span
        className={`size-1.5 rounded-full ${config.dotColor}`}
        aria-hidden="true"
      />
      {config.label}
    </span>
  );
}

interface PriorityConfig {
  label: string;
  className: string;
}

const PRIORITY_CONFIGS: Record<TaskPriority, PriorityConfig> = {
  low: {
    label: 'Low',
    className:
      'border border-app-border/70 bg-app-surface text-app-muted dark:border-app-border',
  },
  medium: {
    label: 'Medium',
    className:
      'border border-app-border bg-app-surface text-app-foreground dark:border-app-border',
  },
  high: {
    label: 'High',
    className:
      'border border-orange-500/40 bg-orange-500/10 text-orange-700 dark:text-orange-300 font-bold',
  },
  urgent: {
    label: 'Urgent',
    className:
      'border border-app-danger/40 bg-app-danger/10 text-app-danger font-bold',
  },
};

export function TaskPriorityBadge({
  priority,
  className = '',
}: {
  priority: TaskPriority;
  className?: string;
}): React.JSX.Element {
  const config = PRIORITY_CONFIGS[priority] ?? {
    label: priority,
    className: 'border border-app-border bg-app-surface text-app-muted',
  };

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs uppercase tracking-wider ${config.className} ${className}`}
      aria-label={`Priority: ${config.label}`}
    >
      {config.label}
    </span>
  );
}
