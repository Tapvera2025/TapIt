import { useId } from 'react';
import { Button, Card } from '../../../ui/components.js';
import { Icon } from '../../../ui/Icon.js';

export interface TodoProgressProps {
  readonly totalCount: number;
  readonly completedCount: number;
  readonly className?: string;
  readonly onAddTodo?: (() => void) | undefined;
}

export function TodoProgress({
  totalCount,
  completedCount,
  className = '',
  onAddTodo,
}: TodoProgressProps): React.JSX.Element {
  const svgId = useId().replace(/:/g, '');
  const liquidGradientId = `todo-liquid-${svgId}`;
  const rimGradientId = `todo-rim-${svgId}`;
  const safeTotalCount = Math.max(0, Number.isFinite(totalCount) ? totalCount : 0);
  const safeCompletedCount = Math.max(
    0,
    Number.isFinite(completedCount) ? completedCount : 0,
  );
  const percentage =
    safeTotalCount === 0
      ? 0
      : Math.min(
          100,
          Math.max(0, Math.round((safeCompletedCount / safeTotalCount) * 100)),
        );
  const ringCircumference = 2 * Math.PI * 68;
  const ringOffset = ringCircumference * (1 - percentage / 100);

  const remainingCount = safeTotalCount - safeCompletedCount;

  return (
    <Card
      className={`flex h-full min-h-[9.5rem] w-full flex-col justify-center p-2.5 sm:p-3 transition hover:border-app-accent/40 ${className}`}
    >
      <div className="flex items-center gap-3 sm:gap-4 w-full">
        {/* Left: Compact liquid glass progress ring */}
        <div
          className="relative size-24 sm:size-28 shrink-0"
          role="progressbar"
          aria-label="Todo completion"
          aria-valuenow={percentage}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <svg
            className="relative z-10 size-full overflow-visible"
            viewBox="0 0 160 160"
            aria-hidden="true"
          >
            <defs>
              <linearGradient id={liquidGradientId} x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="var(--app-accent)" />
                <stop offset="48%" stopColor="var(--theme-primary)" />
                <stop offset="100%" stopColor="var(--app-accent)" />
              </linearGradient>
              <linearGradient id={rimGradientId} x1="0" y1="0" x2="0.8" y2="1">
                <stop offset="0%" stopColor="white" stopOpacity="0.88" />
                <stop offset="45%" stopColor="white" stopOpacity="0.18" />
                <stop offset="72%" stopColor="var(--app-accent)" stopOpacity="0.28" />
                <stop offset="100%" stopColor="white" stopOpacity="0.65" />
              </linearGradient>
              <filter
                id={`${liquidGradientId}-glow`}
                x="-50%"
                y="-50%"
                width="200%"
                height="200%"
              >
                <feGaussianBlur stdDeviation="2.8" />
              </filter>
            </defs>

            {/* Soft cast glow beneath the liquid, then the translucent tube track */}
            <circle
              cx="80"
              cy="80"
              r="68"
              fill="none"
              stroke="var(--app-accent)"
              strokeOpacity="0.22"
              strokeWidth="18"
              filter={`url(#${liquidGradientId}-glow)`}
            />
            <circle
              cx="80"
              cy="80"
              r="68"
              fill="none"
              stroke="var(--app-border)"
              strokeOpacity="0.3"
              strokeWidth="15"
            />
            <circle
              cx="80"
              cy="80"
              r="68"
              fill="none"
              stroke={`url(#${rimGradientId})`}
              strokeWidth="1.5"
              className="opacity-70 dark:opacity-15"
            />

            {/* Glossy liquid fill arc */}
            <circle
              cx="80"
              cy="80"
              r="68"
              fill="none"
              stroke={`url(#${liquidGradientId})`}
              strokeWidth="11"
              strokeLinecap={percentage === 100 ? 'butt' : 'round'}
              strokeDasharray={ringCircumference}
              strokeDashoffset={ringOffset}
              transform="rotate(-90 80 80)"
              className="transition-[stroke-dashoffset] duration-700 ease-out"
            />
          </svg>

          {/* Center frosted glass lens */}
          <div className="pointer-events-none absolute inset-[12px] sm:inset-[14px] overflow-hidden rounded-full border border-white/70 bg-gradient-to-br from-white/55 via-app-surface/30 to-app-accent/5 shadow-[inset_0_2px_10px_rgba(255,255,255,0.55),inset_0_-6px_16px_rgba(15,23,42,0.06),0_4px_14px_rgba(15,23,42,0.06)] backdrop-blur-md dark:border-white/15 dark:from-white/10 dark:via-app-surface/55 dark:to-app-accent/10 dark:shadow-[inset_0_-6px_16px_rgba(0,0,0,0.18)]">
            <span className="absolute inset-x-[18%] top-[7%] h-[24%] rounded-full bg-gradient-to-b from-white/70 to-transparent blur-xs dark:from-transparent" />
            <span className="absolute inset-0 grid place-items-center text-lg sm:text-xl font-bold tracking-tight tabular-nums text-app-foreground">
              {percentage}%
            </span>
          </div>
        </div>

        {/* Right: Progress status & breakdown */}
        <div className="flex min-w-0 flex-1 flex-col justify-center">
          <div className="flex items-center justify-between gap-1.5">
            <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-app-muted">
              Progress
            </span>
            <span
              className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold transition ${
                percentage === 100
                  ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                  : 'bg-app-accent/10 text-app-accent'
              }`}
            >
              {percentage === 100 ? 'Complete' : `${percentage}% Done`}
            </span>
          </div>

          <p className="mt-1 text-xs font-semibold text-app-foreground sm:text-sm">
            {safeCompletedCount}{' '}
            <span className="font-normal text-app-muted">of</span>{' '}
            {safeTotalCount} todos completed
          </p>

          {/* Thin progress bar */}
          <div className="mt-2">
            <div
              role="progressbar"
              aria-label="Overall completion"
              aria-valuenow={percentage}
              aria-valuemin={0}
              aria-valuemax={100}
              className="h-1.5 w-full overflow-hidden rounded-full bg-app-border/60"
            >
              <div
                className="h-full rounded-full bg-gradient-to-r from-app-accent to-sky-400 transition-all duration-500"
                style={{ width: `${percentage}%` }}
              />
            </div>
          </div>

          <p className="mt-1.5 truncate text-[11px] text-app-muted">
            {remainingCount === 0 && safeTotalCount > 0
              ? 'All caught up for today!'
              : remainingCount === 0
                ? 'No todos scheduled'
                : `${remainingCount} task${remainingCount === 1 ? '' : 's'} remaining`}
          </p>
        </div>
      </div>

      <span className="sr-only">
        Overall completion - {safeCompletedCount} of {safeTotalCount} tasks completed
      </span>
    </Card>
  );
}
