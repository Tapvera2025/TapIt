import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

export function Page({
  eyebrow,
  title,
  description,
  action,
  children,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <div className="p-5 md:p-8">
      <div className="mx-auto max-w-7xl">
        <div className="page-heading flex flex-wrap items-center justify-between gap-4">
          <div>
            {eyebrow && (
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-app-accent">
                {eyebrow}
              </p>
            )}
            <h1 className="mt-2 font-display text-3xl font-bold tracking-[-0.05em]">
              {title}
            </h1>
            {description && (
              <p className="mt-2 max-w-3xl text-sm text-app-muted">{description}</p>
            )}
          </div>
          {action}
        </div>
        <div className="mt-8">{children}</div>
      </div>
    </div>
  );
}

export function Card({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}): React.JSX.Element {
  return <section className={`ui-card p-5 ${className}`}>{children}</section>;
}

export function Skeleton({ className = '' }: { className?: string }): React.JSX.Element {
  return <span aria-hidden="true" className={`skeleton block rounded-lg ${className}`} />;
}

export function SkeletonText({
  lines = 2,
  className = '',
}: {
  lines?: number;
  className?: string;
}): React.JSX.Element {
  return (
    <span className={`block space-y-2 ${className}`} aria-hidden="true">
      {Array.from({ length: lines }, (_, index) => (
        <Skeleton key={index} className={`h-3 ${index === lines - 1 ? 'w-2/3' : 'w-full'}`} />
      ))}
    </span>
  );
}

export function SkeletonAvatar({ className = 'size-11' }: { className?: string }): React.JSX.Element {
  return <Skeleton className={`rounded-full ${className}`} />;
}

export function SkeletonMetric({ className = '' }: { className?: string }): React.JSX.Element {
  return (
    <div className={`rounded-xl border border-app-border bg-app-surface-raised p-4 ${className}`}>
      <Skeleton className="size-8 rounded-lg" />
      <Skeleton className="mt-4 h-3 w-2/3" />
      <Skeleton className="mt-2 h-7 w-1/2" />
    </div>
  );
}

export function SkeletonListItem({ className = '' }: { className?: string }): React.JSX.Element {
  return (
    <div className={`flex items-center gap-3 border-b border-app-border px-4 py-3 last:border-b-0 ${className}`}>
      <SkeletonAvatar className="size-9 shrink-0" />
      <div className="min-w-0 flex-1">
        <Skeleton className="h-3.5 w-2/5" />
        <Skeleton className="mt-2 h-3 w-3/5" />
      </div>
      <Skeleton className="h-7 w-16 shrink-0 rounded-full" />
    </div>
  );
}

export function SkeletonProfile({ className = '' }: { className?: string }): React.JSX.Element {
  return (
    <div className={`rounded-2xl border border-app-border bg-app-surface p-5 ${className}`} role="status" aria-label="Loading profile">
      <div className="flex items-center gap-4">
        <SkeletonAvatar className="size-16 shrink-0" />
        <div className="min-w-0 flex-1">
          <Skeleton className="h-5 w-2/5" />
          <Skeleton className="mt-2 h-3 w-3/5" />
        </div>
      </div>
      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        {Array.from({ length: 4 }, (_, index) => <SkeletonText key={index} lines={2} />)}
      </div>
    </div>
  );
}

export function SkeletonMessageThread(): React.JSX.Element {
  return (
    <div className="space-y-3" role="status" aria-label="Loading messages">
      {['w-2/3', 'ml-auto w-1/2', 'w-3/5', 'ml-auto w-3/4'].map((width, index) => (
        <Skeleton key={index} className={`h-12 max-w-[80%] rounded-xl ${width}`} />
      ))}
    </div>
  );
}

/** Matches the authenticated workspace chrome while identity and permissions load. */
function WorkspaceContentSkeleton({ pathname }: { pathname: string }): React.JSX.Element {
  if (pathname === '/company/dashboard') {
    return <div className="space-y-4"><div className="grid gap-4 sm:grid-cols-3"><SkeletonCard className="h-36" /><SkeletonCard className="h-36" /><SkeletonCard className="h-36" /></div><div className="grid gap-4 lg:grid-cols-2"><SkeletonCard className="h-56" /><SkeletonCard className="h-56" /></div><SkeletonTable columns={4} rows={5} /></div>;
  }
  if (pathname.includes('/attendance/today')) {
    return <SkeletonTodayPage />;
  }
  if (pathname.includes('/messages')) {
    return <div className="grid h-[min(70vh,42rem)] min-h-96 gap-0 overflow-hidden rounded-2xl border border-app-border bg-app-surface md:grid-cols-[18rem_minmax(0,1fr)]"><div className="border-b border-app-border p-4 md:border-b-0 md:border-r"><Skeleton className="h-10 w-full rounded-xl" /><div className="mt-5 space-y-3">{Array.from({ length: 6 }, (_, index) => <SkeletonListItem key={index} />)}</div></div><div className="flex flex-col p-5"><div className="flex items-center gap-3 border-b border-app-border pb-4"><SkeletonAvatar /><SkeletonText lines={2} /></div><div className="flex-1 space-y-3 py-5"><SkeletonMessageThread /></div><Skeleton className="h-12 w-full rounded-xl" /></div></div>;
  }
  if (pathname.includes('/employees')) {
    return <div className="space-y-4"><div className="flex flex-wrap gap-3"><Skeleton className="h-11 flex-1 rounded-xl" /><Skeleton className="h-11 w-32 rounded-xl" /></div><SkeletonTable columns={4} rows={7} /></div>;
  }
  if (pathname.includes('/recruitment')) {
    return <div className="space-y-4"><SkeletonMetrics count={4} /><div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]"><SkeletonCard className="h-64" /><SkeletonCard className="h-64" /></div><SkeletonTable columns={5} rows={5} /></div>;
  }
  if (pathname.includes('/payroll')) {
    return <div className="space-y-4"><SkeletonMetrics count={3} /><SkeletonTable columns={6} rows={6} /></div>;
  }
  if (pathname.includes('/organization')) {
    return <div className="grid gap-4 lg:grid-cols-[0.8fr_1.2fr]"><SkeletonCard className="h-[28rem]" /><SkeletonCard className="h-[28rem]" /></div>;
  }
  if (pathname.includes('/projects')) {
    return <div className="space-y-4"><SkeletonTable columns={4} rows={5} /><div className="grid gap-4 lg:grid-cols-2"><SkeletonCard className="h-52" /><SkeletonCard className="h-52" /></div></div>;
  }
  if (pathname.includes('/attendance/my')) {
    return <div className="space-y-4"><SkeletonCalendar /><div className="rounded-2xl border border-app-border bg-app-surface p-4 sm:p-5"><div className="mb-3 flex items-center justify-between"><Skeleton className="h-3 w-24" /><Skeleton className="h-8 w-32 rounded-lg" /></div><SkeletonMetrics count={4} /><SkeletonCard className="mt-4 h-32" /></div></div>;
  }
  if (pathname.includes('/attendance/live')) {
    return <div className="space-y-4"><div className="flex flex-wrap gap-3"><Skeleton className="h-10 min-w-48 flex-1 rounded-xl" /><Skeleton className="h-10 w-36 rounded-xl" /><Skeleton className="h-10 w-36 rounded-xl" /></div><SkeletonCard className="h-24" /><SkeletonTable columns={7} rows={7} /></div>;
  }
  if (pathname.includes('/attendance/corrections')) {
    return <div className="space-y-4"><div className="flex flex-wrap gap-3"><Skeleton className="h-10 w-32 rounded-lg" /><Skeleton className="h-10 w-32 rounded-lg" /><Skeleton className="h-10 w-28 rounded-lg" /></div><SkeletonTable columns={6} rows={6} /></div>;
  }
  if (pathname.includes('/breaks') || pathname.includes('/leave')) {
    return <div className="space-y-4"><SkeletonMetrics count={4} /><SkeletonTable columns={5} rows={6} /></div>;
  }
  if (pathname.includes('/settings') || pathname.includes('/access') || pathname.includes('/geofencing')) {
    return <div className="grid gap-4 lg:grid-cols-[15rem_minmax(0,1fr)]"><SkeletonCard className="h-96" /><SkeletonForm fields={6} /></div>;
  }
  if (pathname.includes('/tasks') || pathname.includes('/todo') || pathname.includes('/notepad')) {
    if (pathname.includes('/notepad')) {
      return <SkeletonNotepadPage />;
    }
    if (pathname.includes('/todo')) {
      return <div className="mx-auto max-w-5xl space-y-4"><div className="flex items-center justify-between"><div><Skeleton className="h-7 w-36" /><Skeleton className="mt-2 h-3 w-52" /></div><Skeleton className="h-10 w-28 rounded-xl" /></div><div className="grid grid-cols-2 gap-2 sm:grid-cols-5">{Array.from({ length: 5 }, (_, index) => <SkeletonMetric key={index} className="p-3" />)}</div><div className="rounded-2xl border border-app-border bg-app-surface p-3"><div className="flex flex-wrap gap-2"><Skeleton className="h-10 min-w-40 flex-1 rounded-lg" /><Skeleton className="h-10 w-28 rounded-lg" /><Skeleton className="h-10 w-28 rounded-lg" /></div></div><div className="space-y-3"><Skeleton className="h-5 w-24" />{Array.from({ length: 4 }, (_, index) => <SkeletonCard key={index} className="h-20" />)}</div></div>;
    }
    return <div className="space-y-5"><div className="flex items-center justify-between"><div><Skeleton className="h-2.5 w-20" /><Skeleton className="mt-3 h-8 w-32" /><Skeleton className="mt-3 h-3 w-80 max-w-full" /></div><Skeleton className="h-10 w-28 rounded-lg" /></div><div className="rounded-2xl border border-app-border bg-app-surface p-4"><div className="flex flex-wrap gap-3"><Skeleton className="h-10 min-w-48 flex-1 rounded-lg" /><Skeleton className="h-10 w-36 rounded-lg" /><Skeleton className="h-10 w-28 rounded-lg" /></div></div><SkeletonTable columns={5} rows={7} /><div className="flex justify-between"><Skeleton className="h-3 w-36" /><Skeleton className="h-9 w-28 rounded-lg" /></div></div>;
  }
  return <SkeletonDetail sections={2} />;
}

export function WorkspaceSkeleton({ pathname = '/company/dashboard' }: { pathname?: string }): React.JSX.Element {
  const normalizedPathname = (pathname.split('?')[0] ?? pathname).replace(/\/+$/, '') || '/';
  const usesOwnPageHeader = ['/company/messages', '/company/my-notepad', '/company/notepad', '/company/todo', '/company/my-todo', '/company/attendance/today', '/company/employees'].includes(normalizedPathname);
  return (
    <div className="flex h-dvh overflow-hidden bg-app-background text-app-foreground" role="status" aria-label="Loading workspace">
      <aside className="hidden w-72 shrink-0 border-r border-app-border bg-app-surface p-5 md:block">
        <div className="flex items-center gap-3 border-b border-app-border pb-5">
          <Skeleton className="size-10 rounded-xl" />
          <div className="min-w-0 flex-1"><Skeleton className="h-4 w-3/5" /><Skeleton className="mt-2 h-3 w-2/5" /></div>
        </div>
        <div className="mt-7 space-y-7">
          {Array.from({ length: 4 }, (_, group) => (
            <div key={group} className="space-y-2">
              <Skeleton className="ml-2 h-2.5 w-1/3" />
              {Array.from({ length: group === 0 ? 4 : 3 }, (_, item) => (
                <div key={item} className="flex items-center gap-3 rounded-xl px-3 py-2.5"><Skeleton className="size-4 rounded" /><Skeleton className="h-3 w-2/3" /></div>
              ))}
            </div>
          ))}
        </div>
        <div className="mt-8 border-t border-app-border pt-5"><Skeleton className="h-11 w-full rounded-xl" /></div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="flex h-16 shrink-0 items-center justify-between border-b border-app-border bg-app-surface px-4 sm:px-6">
          <div className="flex items-center gap-3"><Skeleton className="size-9 rounded-lg md:hidden" /><div><Skeleton className="h-4 w-32" /><Skeleton className="mt-2 h-2.5 w-20" /></div></div>
          <div className="flex items-center gap-2"><Skeleton className="size-9 rounded-full" /><Skeleton className="hidden h-9 w-28 rounded-lg sm:block" /></div>
        </header>
        <main className="min-h-0 flex-1 overflow-hidden p-5 md:p-8">
          <div className="mx-auto max-w-7xl">
            {!usesOwnPageHeader && <div className="flex items-center justify-between gap-4"><div><Skeleton className="h-2.5 w-20" /><Skeleton className="mt-3 h-8 w-52" /><Skeleton className="mt-3 h-3 w-80 max-w-full" /></div><Skeleton className="h-10 w-28 rounded-lg" /></div>}
            <div className={usesOwnPageHeader ? '' : 'mt-8'}><WorkspaceContentSkeleton pathname={normalizedPathname} /></div>
          </div>
        </main>
      </div>
    </div>
  );
}

export function SkeletonPage({
  cards = 3,
  rows = 0,
  className = '',
}: {
  cards?: number;
  rows?: number;
  className?: string;
}): React.JSX.Element {
  return (
    <div className={`space-y-5 ${className}`} role="status" aria-label="Loading page content">
      <div className="rounded-2xl border border-app-border bg-app-surface p-5">
        <Skeleton className="h-5 w-1/4" />
        <Skeleton className="mt-3 h-3 w-2/5" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: cards }, (_, index) => <SkeletonCard key={index} className="h-32" />)}
      </div>
      {rows > 0 && (
        <div className="overflow-hidden rounded-2xl border border-app-border bg-app-surface">
          {Array.from({ length: rows }, (_, index) => <SkeletonListItem key={index} />)}
        </div>
      )}
    </div>
  );
}

export function SkeletonTable({ columns = 5, rows = 6 }: { columns?: number; rows?: number }): React.JSX.Element {
  return (
    <div className="overflow-hidden rounded-2xl border border-app-border bg-app-surface" role="status" aria-label="Loading table">
      <div className="grid gap-4 border-b border-app-border bg-app-surface-raised px-5 py-4" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
        {Array.from({ length: columns }, (_, index) => <Skeleton key={index} className="h-3 w-3/4" />)}
      </div>
      {Array.from({ length: rows }, (_, row) => (
        <div key={row} className="grid items-center gap-4 border-b border-app-border px-5 py-4 last:border-b-0" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
          {Array.from({ length: columns }, (_, column) => <Skeleton key={column} className={`h-3 ${column === 0 ? 'w-4/5' : 'w-3/5'}`} />)}
        </div>
      ))}
    </div>
  );
}

export function SkeletonMetrics({ count = 4 }: { count?: number }): React.JSX.Element {
  return <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" role="status" aria-label="Loading metrics">{Array.from({ length: count }, (_, index) => <SkeletonMetric key={index} />)}</div>;
}

export function SkeletonDetail({ sections = 3 }: { sections?: number }): React.JSX.Element {
  return (
    <div className="space-y-4" role="status" aria-label="Loading details">
      <SkeletonProfile />
      {Array.from({ length: sections }, (_, index) => <SkeletonCard key={index} className="h-28" />)}
    </div>
  );
}

export function SkeletonForm({ fields = 6 }: { fields?: number }): React.JSX.Element {
  return (
    <div className="rounded-2xl border border-app-border bg-app-surface p-5" role="status" aria-label="Loading form">
      <Skeleton className="h-5 w-1/3" />
      <div className="mt-6 grid gap-4 sm:grid-cols-2">{Array.from({ length: fields }, (_, index) => <SkeletonText key={index} lines={2} />)}</div>
      <div className="mt-6 flex justify-end gap-2"><Skeleton className="h-10 w-24 rounded-lg" /><Skeleton className="h-10 w-28 rounded-lg" /></div>
    </div>
  );
}

export function SkeletonCalendar(): React.JSX.Element {
  return (
    <div className="rounded-2xl border border-app-border bg-app-surface p-5" role="status" aria-label="Loading calendar">
      <div className="flex items-center justify-between"><Skeleton className="h-5 w-36" /><Skeleton className="h-9 w-24 rounded-lg" /></div>
      <div className="mt-5 grid grid-cols-7 gap-2">{Array.from({ length: 35 }, (_, index) => <Skeleton key={index} className="aspect-square rounded-lg" />)}</div>
    </div>
  );
}

export function SkeletonNotepadPage(): React.JSX.Element {
  return <div className="skeleton mx-auto min-h-[620px] w-full max-w-5xl rounded-2xl border border-app-border bg-app-surface sm:min-h-[680px] md:min-h-[560px]" role="status" aria-label="Loading notepad" />;
}

export function SkeletonTodayPage(): React.JSX.Element {
  return (
    <div className="space-y-4" role="status" aria-label="Loading today's attendance">
      <div className="grid min-h-0 grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)] lg:items-stretch"><SkeletonCard className="h-64" /><SkeletonCard className="h-64" /></div>
      <div className="grid min-h-0 grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)] lg:items-stretch"><SkeletonCard className="h-80" /><div className="rounded-2xl border border-app-border bg-app-surface p-4 sm:p-5"><Skeleton className="h-5 w-32" /><div className="mt-4 grid grid-cols-2 gap-3">{Array.from({ length: 4 }, (_, index) => <SkeletonMetric key={index} className="p-3" />)}</div></div></div>
    </div>
  );
}

export function SkeletonCard({ className = '' }: { className?: string }): React.JSX.Element {
  return (
    <div className={`skeleton-card rounded-2xl border border-app-border bg-app-surface p-5 ${className}`} role="status" aria-label="Loading content">
      <Skeleton className="h-4 w-1/3" />
      <SkeletonText lines={2} className="mt-4" />
    </div>
  );
}

export function SkeletonTableRows({ count = 5 }: { count?: number }): React.JSX.Element {
  return (
    <div className="overflow-hidden rounded-2xl border border-app-border bg-app-surface" role="status" aria-label="Loading list">
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="flex items-center gap-4 border-b border-app-border px-5 py-4 last:border-b-0">
          <Skeleton className="size-11 shrink-0 rounded-xl" />
          <div className="min-w-0 flex-1"><SkeletonText lines={2} /></div>
          <Skeleton className="hidden h-7 w-28 shrink-0 rounded-lg sm:block" />
        </div>
      ))}
    </div>
  );
}
export function Button({
  children,
  kind = 'primary',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  kind?: 'primary' | 'secondary' | 'danger';
}): React.JSX.Element {
  const styles =
    kind === 'primary'
      ? 'ui-primary'
      : kind === 'danger'
        ? 'border border-[#d86b6b]/40 text-app-danger hover:bg-[#d86b6b]/10'
        : 'border border-app-border text-app-foreground hover:border-app-accent';
  return (
    <button
      type="button"
      {...props}
      className={`rounded-lg px-4 py-2.5 text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-50 ${styles} ${props.className ?? ''}`}
    >
      {children}
    </button>
  );
}
export function Field({
  label,
  value,
  onChange,
  type = 'text',
  required = false,
  placeholder,
  disabled = false,
  error,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  required?: boolean;
  placeholder?: string;
  disabled?: boolean;
  error?: string | undefined;
}): React.JSX.Element {
  return (
    <label className="text-xs font-semibold text-app-muted">
      <span className="mb-2 block">{label}</span>
      <input
        required={required}
        disabled={disabled}
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-lg border border-app-border bg-app-background px-3 py-2.5 text-sm text-app-foreground outline-none focus:border-app-accent"
      />
      {error && <span className="mt-1 block font-normal text-app-danger" role="alert">{error}</span>}
    </label>
  );
}
export function Select({
  label,
  value,
  onChange,
  options,
  required = false,
  disabled = false,
  error,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  required?: boolean;
  disabled?: boolean;
  error?: string | undefined;
}): React.JSX.Element {
  return (
    <label className="text-xs font-semibold text-app-muted">
      <span className="mb-2 block">{label}</span>
      <select
        required={required}
        disabled={disabled}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-lg border border-app-border bg-app-background px-3 py-2.5 text-sm text-app-foreground outline-none focus:border-app-accent disabled:opacity-50"
      >
        <option value="">Select {label.toLowerCase()}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {error && <span className="mt-1 block font-normal text-app-danger" role="alert">{error}</span>}
    </label>
  );
}

export function SearchableSelect({
  label,
  value,
  onChange,
  options,
  placeholder = 'Search…',
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  placeholder?: string;
  disabled?: boolean;
}): React.JSX.Element {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.value === value);
  const filtered = options.filter((option) => option.label.toLowerCase().includes(query.trim().toLowerCase()));
  return (
    <label className="relative text-xs font-semibold text-app-muted">
      <span className="mb-2 block">{label}</span>
      <input
        disabled={disabled}
        value={open ? query : selected?.label ?? ''}
        placeholder={placeholder}
        onFocus={() => { setQuery(''); setOpen(true); }}
        onBlur={() => { window.setTimeout(() => setOpen(false), 0); }}
        onChange={(event) => { setQuery(event.target.value); setOpen(true); }}
        className="w-full rounded-lg border border-app-border bg-app-background px-3 py-2.5 text-sm text-app-foreground outline-none focus:border-app-accent disabled:opacity-50"
      />
      {open && !disabled && <div className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-lg border border-app-border bg-app-surface shadow-xl">
        <button type="button" className="w-full px-3 py-2 text-left text-xs text-app-muted hover:bg-app-background" onMouseDown={(event) => event.preventDefault()} onClick={() => { onChange(''); setQuery(''); setOpen(false); }}>Clear selection</button>
        {filtered.map((option) => <button key={option.value} type="button" className="block w-full px-3 py-2 text-left text-sm hover:bg-app-background" onMouseDown={(event) => event.preventDefault()} onClick={() => { onChange(option.value); setQuery(''); setOpen(false); }}>{option.label}</button>)}
        {filtered.length === 0 && <p className="px-3 py-2 text-xs text-app-muted">No matches.</p>}
      </div>}
    </label>
  );
}
export function Notice({
  error,
  children,
}: {
  error?: boolean;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <div
      role={error ? 'alert' : 'status'}
      className={`rounded-xl border p-4 text-sm ${error ? 'border-[#d86b6b]/30 bg-[#d86b6b]/10 text-app-danger' : 'border-app-accent/30 bg-app-accent/10 text-app-accent'}`}
    >
      {children}
    </div>
  );
}
export function Loading(): React.JSX.Element {
  return <SkeletonCard className="mt-6 h-48" />;
}
export function Empty({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <Card className="mt-6 text-center">
      <p className="text-sm text-app-muted">{children}</p>
    </Card>
  );
}
/** A click on the dimmed backdrop lands on the <dialog> itself, outside its box. */
function isBackdropEvent(event: React.MouseEvent<HTMLDialogElement>): boolean {
  if (event.target !== event.currentTarget) return false;
  const box = event.currentTarget.getBoundingClientRect();
  return (
    event.clientX < box.left ||
    event.clientX > box.right ||
    event.clientY < box.top ||
    event.clientY > box.bottom
  );
}

/** Typing in a field of this window (not a search box, not a window opened on top of it). */
function isEdit(event: React.FormEvent<HTMLDialogElement>): boolean {
  const target = event.target as HTMLElement;
  if (target.closest('dialog') !== event.currentTarget) return false;
  return !(target instanceof HTMLInputElement && target.type === 'search');
}

export function Modal({
  title,
  onClose,
  children,
  footer,
  size = 'md',
  dirty,
}: {
  title: string;
  /**
   * Closes the window. The × button, the Escape key and a click outside the
   * window all come here — after a "discard changes?" check when there are edits.
   */
  onClose: () => void;
  children: ReactNode;
  /** Stays in view under the scrolling content: put the main actions here. */
  footer?: ReactNode;
  size?: 'md' | 'lg';
  /**
   * Whether closing now would lose edits. Left out, the window notices typing
   * in its own fields; pass it when the edits are not plain form fields.
   */
  dirty?: boolean;
}): React.JSX.Element {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const pressedOnBackdrop = useRef(false);
  const typed = useRef(false);
  const [confirming, setConfirming] = useState(false);
  useEffect(() => {
    const element = dialog.current;
    const previous = document.activeElement as HTMLElement | null;
    element?.showModal();
    return () => {
      element?.close();
      previous?.focus();
    };
  }, []);
  function requestClose() {
    if (dirty ?? typed.current) setConfirming(true);
    else onClose();
  }
  return (
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      onKeyDown={(event) => {
        // Handled here rather than left to the browser, which stops letting a
        // page keep the window open after a second Escape in a row.
        if (event.key !== 'Escape' || event.defaultPrevented) return;
        event.preventDefault();
        requestClose();
      }}
      onCancel={(event) => {
        event.preventDefault();
        requestClose();
      }}
      onClose={() => {
        // Closed by the browser anyway: stay on screen until the page says so.
        const element = dialog.current;
        if (element?.isConnected && !element.open) {
          element.showModal();
          requestClose();
        }
      }}
      onInput={(event) => {
        if (isEdit(event)) typed.current = true;
      }}
      onMouseDown={(event) => {
        pressedOnBackdrop.current = isBackdropEvent(event);
      }}
      onClick={(event) => {
        // Pressed and released outside: dragging a text selection out of the
        // window does not close it.
        if (pressedOnBackdrop.current && isBackdropEvent(event)) requestClose();
        pressedOnBackdrop.current = false;
      }}
      className={size === 'lg' ? 'ui-dialog ui-dialog-lg' : 'ui-dialog'}
    >
      <div className="ui-dialog-header">
        <h2 id={titleId} className="font-display text-xl font-bold">
          {title}
        </h2>
        <button
          type="button"
          onClick={requestClose}
          className="grid size-9 place-items-center rounded-lg text-2xl text-app-muted hover:bg-app-background"
          aria-label="Close dialog"
        >
          ×
        </button>
      </div>
      <div className="ui-dialog-body">{children}</div>
      {confirming ? (
        <div role="alert" className="ui-dialog-footer flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm font-semibold">You have unsaved changes. Close without saving them?</p>
          <div className="flex gap-2">
            <Button kind="secondary" onClick={() => setConfirming(false)} autoFocus>
              Keep editing
            </Button>
            <Button kind="danger" onClick={onClose}>
              Discard changes
            </Button>
          </div>
        </div>
      ) : (
        footer !== undefined && <div className="ui-dialog-footer">{footer}</div>
      )}
    </dialog>
  );
}
export function ErrorMessage({ cause }: { cause: unknown }): React.JSX.Element {
  return (
    <Notice error>
      {cause instanceof Error ? cause.message : 'Unable to load Organization data.'}
    </Notice>
  );
}
