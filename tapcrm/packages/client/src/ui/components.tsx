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
        {children}
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
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  required?: boolean;
  placeholder?: string;
  disabled?: boolean;
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
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  required?: boolean;
  disabled?: boolean;
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
  return (
    <div className="mt-6 h-48 animate-pulse rounded-2xl border border-app-border bg-app-surface" />
  );
}
export function Empty({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <Card className="mt-6 text-center">
      <p className="text-sm text-app-muted">{children}</p>
    </Card>
  );
}
export function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}): React.JSX.Element {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const element = dialog.current;
    const previous = document.activeElement as HTMLElement | null;
    element?.showModal();
    return () => {
      element?.close();
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      className="ui-dialog"
    >
      <div className="flex items-center justify-between gap-4">
        <h2 id={titleId} className="font-display text-xl font-bold">
          {title}
        </h2>
        <button
          type="button"
          onClick={onClose}
          className="grid size-9 place-items-center rounded-lg text-2xl text-app-muted hover:bg-app-background"
          aria-label="Close dialog"
        >
          ×
        </button>
      </div>
      <div className="mt-5">{children}</div>
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
