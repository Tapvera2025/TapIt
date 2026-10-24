import { PORTAL_STATUS_LABELS, progressPercent, type PortalProject, type PortalWorkStatus } from './api/portalApi.js';

const STATUS_STYLES: Record<PortalWorkStatus, string> = {
  new: 'border-app-border text-app-muted',
  ongoing: 'border-app-accent/40 bg-app-accent/10 text-app-accent',
  ended: 'border-app-border bg-app-surface text-app-foreground',
  expired: 'border-[#d86b6b]/40 bg-[#d86b6b]/10 text-app-danger',
};

export function StatusBadge({ status }: { status: PortalWorkStatus }): React.JSX.Element {
  return (
    <span className={`inline-flex rounded-full border px-2.5 py-0.5 text-xs font-semibold ${STATUS_STYLES[status]}`}>
      {PORTAL_STATUS_LABELS[status]}
    </span>
  );
}

export function ProgressBar({ progress }: { progress: PortalProject['progress'] }): React.JSX.Element {
  const percent = progressPercent(progress);
  if (percent === null) return <p className="text-xs text-app-muted">Progress will appear once work is scheduled.</p>;
  return (
    <div>
      <div className="mb-1 flex justify-between text-xs text-app-muted">
        <span>Progress</span>
        <span>{percent}%</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-app-border" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} aria-label="Project progress">
        <div className="h-full rounded-full bg-app-accent transition-[width]" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

export function PortalLink({
  href, onNavigate, className = '', children,
}: { href: string; onNavigate: (path: string) => void; className?: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <a
      href={href}
      className={className}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
        event.preventDefault();
        onNavigate(href);
      }}
    >
      {children}
    </a>
  );
}
