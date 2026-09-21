import { useId, type CSSProperties } from 'react';

/** Accessible, dependency-free charts. Values are always shown as text. */
export function RingChart({
  value,
  max,
  label,
}: {
  value: number;
  max: number;
  label: string;
}): React.JSX.Element {
  const id = useId();
  const percent =
    max > 0 ? Math.round(Math.max(0, Math.min(value / max, 1)) * 100) : 0;
  return (
    <div
      className="relative mx-auto size-44"
      role="img"
      aria-label={`${label}: ${value} of ${max}${max ? `, ${percent}%` : ''}`}
    >
      <svg viewBox="0 0 180 180" className="size-full -rotate-90" aria-hidden="true">
        <defs>
          <linearGradient id={id}>
            <stop stopColor="#ee8235" />
            <stop offset="1" stopColor="#ffbe70" />
          </linearGradient>
        </defs>
        <circle
          cx="90"
          cy="90"
          r="72"
          fill="none"
          stroke="var(--app-border)"
          strokeWidth="14"
        />
        <circle
          className="chart-ring"
          cx="90"
          cy="90"
          r="72"
          fill="none"
          stroke={`url(#${id})`}
          strokeWidth="14"
          strokeLinecap="round"
          pathLength="100"
          strokeDasharray={`${percent} 100`}
          style={{ '--ring-value': percent } as CSSProperties}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-4xl font-semibold tracking-tight tabular-nums">
          {max ? `${percent}%` : '—'}
        </span>
        <span className="mt-1 text-xs text-app-muted">
          {max ? 'Assigned' : 'No data'}
        </span>
      </div>
    </div>
  );
}

export function BarChart({
  data,
  label,
}: {
  data: Array<{ label: string; value: number }>;
  label: string;
}): React.JSX.Element {
  const maximum = Math.max(1, ...data.map((item) => item.value));
  if (!data.length)
    return (
      <div className="grid min-h-48 place-items-center rounded-xl border border-dashed border-app-border p-6 text-center text-sm text-app-muted">
        No employee data available to chart.
      </div>
    );
  return (
    <div role="group" aria-label={label} className="relative">
      <div
        className="pointer-events-none absolute inset-x-0 top-5 bottom-10 flex flex-col justify-between"
        aria-hidden="true"
      >
        {[0, 1, 2, 3].map((line) => (
          <div key={line} className="border-t border-dashed border-app-border" />
        ))}
      </div>
      <div className="relative flex h-60 items-end gap-3 px-2 pt-5 sm:gap-5">
        {data.map((item, index) => (
          <div
            key={item.label}
            className="group flex h-full min-w-0 flex-1 flex-col items-center justify-end"
            title={`${item.label}: ${item.value}`}
          >
            <span className="mb-2 text-xs font-semibold tabular-nums text-app-muted group-hover:text-app-accent">
              {item.value}
            </span>
            <div
              className="chart-bar w-full max-w-14 rounded-t-lg"
              style={
                {
                  height: `${(item.value / maximum) * 72}%`,
                  '--chart-delay': `${index * 65}ms`,
                } as CSSProperties
              }
            />
            <span className="mt-3 w-full truncate text-center text-[11px] text-app-muted">
              {item.label}
            </span>
          </div>
        ))}
      </div>
      <ul className="sr-only">
        {data.map((item) => (
          <li key={item.label}>
            {item.label}: {item.value}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Progress({
  label,
  value,
  max,
}: {
  label: string;
  value: number;
  max: number;
}): React.JSX.Element {
  const percent = max ? Math.max(0, Math.min((value / max) * 100, 100)) : 0;
  return (
    <div>
      <div className="mb-2 flex justify-between gap-3 text-sm">
        <span>{label}</span>
        <span className="tabular-nums text-app-muted">
          {value} / {max}
        </span>
      </div>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={Math.max(max, 1)}
        className="h-2 overflow-hidden rounded-full bg-app-border"
      >
        <div
          className="chart-progress h-full rounded-full bg-app-accent"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
