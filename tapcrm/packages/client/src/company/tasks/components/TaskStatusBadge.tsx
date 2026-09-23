import type { TaskPriority, TaskStatus } from '../types/index.js';

interface StatusConfig {
  label: string;
  symbol: string;
  textColor: string;
  badgeBg: string;
}

const STATUS_CONFIGS: Record<TaskStatus, StatusConfig> = {
  pending: {
    label: 'Pending',
    symbol: '○',
    textColor: 'text-amber-700 dark:text-amber-300',
    badgeBg: 'bg-amber-500/10 border-amber-500/20',
  },
  in_progress: {
    label: 'In Progress',
    symbol: '●',
    textColor: 'text-sky-700 dark:text-sky-300',
    badgeBg: 'bg-sky-500/10 border-sky-500/20',
  },
  completed: {
    label: 'Completed',
    symbol: '✓',
    textColor: 'text-emerald-700 dark:text-emerald-300',
    badgeBg: 'bg-emerald-500/10 border-emerald-500/20',
  },
  cancelled: {
    label: 'Cancelled',
    symbol: '✕',
    textColor: 'text-neutral-500 dark:text-neutral-400',
    badgeBg: 'bg-neutral-500/10 border-neutral-500/20',
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
    symbol: '•',
    textColor: 'text-app-muted',
    badgeBg: 'bg-app-surface border-app-border',
  };

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded border px-2 py-0.5 text-xs font-medium ${config.badgeBg} ${config.textColor} ${className}`}
      role="status"
    >
      <span className="text-[11px] leading-none" aria-hidden="true">
        {config.symbol}
      </span>
      <span>{config.label}</span>
    </span>
  );
}

interface PriorityConfig {
  label: string;
  symbol: string;
  className: string;
}

const PRIORITY_CONFIGS: Record<TaskPriority, PriorityConfig> = {
  low: {
    label: 'Low',
    symbol: '↓',
    className: 'text-app-muted',
  },
  medium: {
    label: 'Medium',
    symbol: '—',
    className: 'text-app-foreground',
  },
  high: {
    label: 'High',
    symbol: '↑',
    className: 'text-amber-600 dark:text-amber-400 font-medium',
  },
  urgent: {
    label: 'Urgent',
    symbol: '↑↑',
    className: 'text-rose-600 dark:text-rose-400 font-semibold',
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
    symbol: '•',
    className: 'text-app-muted',
  };

  return (
    <span
      className={`inline-flex items-center gap-1 text-xs ${config.className} ${className}`}
      aria-label={`Priority: ${config.label}`}
    >
      <span className="font-mono text-xs leading-none" aria-hidden="true">
        {config.symbol}
      </span>
      <span>{config.label}</span>
    </span>
  );
}
