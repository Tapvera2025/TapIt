import type { ReactNode } from 'react';

/**
 * A thin progress ring drawn around an avatar, with the percentage in a small
 * badge. Used on the account button while an employee's profile is incomplete.
 */
export function ProfileCompletionRing({
  percent,
  size = 40,
  children,
}: {
  percent: number;
  size?: number;
  children: ReactNode;
}): React.JSX.Element {
  const stroke = 3;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(100, percent));
  const offset = circumference * (1 - clamped / 100);
  const tone = clamped >= 80 ? 'text-emerald-500' : clamped >= 40 ? 'text-amber-500' : 'text-rose-500';

  return (
    <span className="relative inline-grid place-items-center" style={{ width: size, height: size }}>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="pointer-events-none absolute inset-0 -rotate-90"
        aria-hidden="true"
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          stroke="currentColor"
          className="text-app-border"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          stroke="currentColor"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className={`${tone} transition-[stroke-dashoffset] duration-500`}
        />
      </svg>
      {children}
      <span
        className={`pointer-events-none absolute -bottom-1 -right-1.5 rounded-full border border-app-surface bg-app-surface px-1 text-[9px] font-bold leading-[14px] ${tone}`}
      >
        {clamped}%
      </span>
    </span>
  );
}

/** A horizontal bar with the same colouring, for pages and lists. */
export function ProfileCompletionBar({ percent }: { percent: number }): React.JSX.Element {
  const clamped = Math.max(0, Math.min(100, percent));
  const tone = clamped >= 80 ? 'bg-emerald-500' : clamped >= 40 ? 'bg-amber-500' : 'bg-rose-500';
  return (
    <div
      className="h-2 w-full overflow-hidden rounded-full bg-app-border/60"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={clamped}
    >
      <div className={`h-full rounded-full ${tone} transition-all duration-500`} style={{ width: `${clamped}%` }} />
    </div>
  );
}

/** The colour class for a percentage chip. */
export function completionToneClass(percent: number): string {
  if (percent >= 100) return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400';
  if (percent >= 80) return 'border-emerald-500/30 bg-emerald-500/5 text-emerald-600 dark:text-emerald-400';
  if (percent >= 40) return 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300';
  return 'border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-400';
}
