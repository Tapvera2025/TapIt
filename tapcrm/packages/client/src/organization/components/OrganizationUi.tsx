import type { ReactNode } from 'react';

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
        <div className="flex flex-wrap items-end justify-between gap-4">
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
  return (
    <section
      className={`rounded-2xl border border-app-border bg-app-surface p-5 ${className}`}
    >
      {children}
    </section>
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
      ? 'bg-app-accent text-[#061412]'
      : kind === 'danger'
        ? 'border border-[#d86b6b]/40 text-[#d86b6b] hover:bg-[#d86b6b]/10'
        : 'border border-app-border text-app-foreground hover:border-app-accent';
  return (
    <button
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
export function Notice({
  error,
  children,
}: {
  error?: boolean;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <div
      className={`rounded-xl border p-4 text-sm ${error ? 'border-[#d86b6b]/30 bg-[#d86b6b]/10 text-[#d86b6b]' : 'border-app-accent/30 bg-app-accent/10 text-app-accent'}`}
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
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-app-border bg-app-surface p-6 shadow-2xl">
        <div className="flex items-center justify-between gap-4">
          <h2 className="font-display text-xl font-bold">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-2xl text-app-muted"
            aria-label="Close dialog"
          >
            ×
          </button>
        </div>
        <div className="mt-5">{children}</div>
      </div>
    </div>
  );
}
export function ErrorMessage({ cause }: { cause: unknown }): React.JSX.Element {
  return (
    <Notice error>
      {cause instanceof Error ? cause.message : 'Unable to load Organization data.'}
    </Notice>
  );
}

interface TreePosition {
  id: string;
  name: string;
  code: string;
  organizationalLevel: number;
  holderCount?: number;
  status: string;
  children?: TreePosition[];
}

export function PositionTree({
  nodes,
  onSelect,
}: {
  nodes: TreePosition[];
  onSelect?: (id: string) => void;
}): React.JSX.Element {
  return (
    <div className="space-y-2">
      {nodes.map((node) => (
        <div key={node.id} className="border-l border-app-border pl-4">
          <button
            type="button"
            onClick={() => onSelect?.(node.id)}
            className="w-full rounded-lg p-3 text-left hover:bg-app-background"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-semibold">{node.name}</span>
              <span className="text-xs text-app-muted">
                L{node.organizationalLevel} · {node.holderCount ?? 0} holder
                {node.holderCount === 1 ? '' : 's'} · {node.status}
              </span>
            </div>
            <p className="mt-1 text-xs text-app-muted">{node.code}</p>
          </button>
          {node.children && node.children.length > 0 && (
            <div className="mt-2 space-y-2">
              <PositionTree nodes={node.children} {...(onSelect ? { onSelect } : {})} />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
