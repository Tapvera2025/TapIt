import type { ReactNode } from 'react';
import { Card } from '../components.js';

export interface ProfileDetail {
  label: string;
  value: ReactNode;
}

export interface ProfileCardProps {
  name: string;
  role?: string;
  avatarUrl?: string;
  details: ProfileDetail[];
  actions?: ReactNode;
  className?: string;
}

export function ProfileCard({
  name,
  role,
  details,
  actions,
  className = '',
}: ProfileCardProps): React.JSX.Element {
  return (
    <Card className={`p-4 sm:p-6 ${className}`}>
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-app-border/70 pb-4">
        <div>
          <h2 className="font-display text-lg font-bold text-app-foreground">{name}</h2>
          {role && <p className="text-xs font-semibold text-app-muted">{role}</p>}
        </div>
        {actions && <div>{actions}</div>}
      </div>
      <dl className="mt-4 grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2">
        {details.map(({ label, value }) => (
          <div key={label} className="min-w-0">
            <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-app-muted">{label}</dt>
            <dd className="mt-1 break-words text-sm font-medium text-app-foreground">{value}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}
