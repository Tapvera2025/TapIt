import { useEffect, useState } from 'react';
import { Card, ErrorMessage, Loading, Notice, Page } from '../../ui/components.js';
import { IdentityApiError } from '../../identity/api/authApi.js';
import { formatProjectDate } from '../../projects/formatDate.js';
import { getPortalProject, PORTAL_SERVICE_LABELS, type PortalProject } from '../api/portalApi.js';
import { PortalLink, ProgressBar, StatusBadge } from '../components.js';

export function ClientProjectPage({ id, onNavigate, onError }: { id: string; onNavigate: (path: string) => void; onError: (cause: unknown) => void }): React.JSX.Element {
  const [project, setProject] = useState<PortalProject | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    let live = true;
    setProject(null);
    setError(null);
    getPortalProject(id).then((result) => { if (live) setProject(result); }, (cause: unknown) => { if (live) { setError(cause); onError(cause); } });
    return () => { live = false; };
  }, [id, onError]);

  const back = (
    <PortalLink href="/client/projects" onNavigate={onNavigate} className="text-sm font-semibold text-app-accent hover:underline">← All projects</PortalLink>
  );

  if (error) {
    const notFound = error instanceof IdentityApiError && error.status === 404;
    return (
      <Page title={notFound ? 'Project not found' : 'Project'} action={back}>
        {notFound ? <Notice error>We couldn’t find that project. It may have been removed from your account.</Notice> : <ErrorMessage cause={error} />}
      </Page>
    );
  }
  if (!project) return <Page title="Project" action={back}><Loading /></Page>;

  return (
    <Page eyebrow="Project" title={project.name} action={back}>
      <Card className="p-4 sm:p-6">
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-lg font-bold">Overview</h2>
          <StatusBadge status={project.workStatus} />
        </div>
        <p className="mt-3 whitespace-pre-line break-words text-sm leading-6 text-app-muted">{project.description || 'No description has been added yet.'}</p>
        <div className="mt-5">
          <ProgressBar progress={project.progress} />
        </div>

        <div className="mt-6 grid gap-4 border-t border-app-border pt-5 sm:grid-cols-2 xl:grid-cols-3">
          <div className="min-w-0">
            <dt className="text-[11px] font-semibold uppercase tracking-[0.1em] text-app-muted">Start date</dt>
            <dd className="mt-1 break-words text-sm font-medium text-app-foreground">{formatProjectDate(project.startDate)}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-[11px] font-semibold uppercase tracking-[0.1em] text-app-muted">Expected end</dt>
            <dd className="mt-1 break-words text-sm font-medium text-app-foreground">{formatProjectDate(project.expectedEndDate)}</dd>
          </div>
          <div className="min-w-0 sm:col-span-2 xl:col-span-1">
            <dt className="text-[11px] font-semibold uppercase tracking-[0.1em] text-app-muted">Services</dt>
            <dd className="mt-1 break-words text-sm font-medium text-app-foreground">
              {project.services.length === 0 ? '—' : project.services.map((s) => (s.service === 'other' ? s.otherLabel : PORTAL_SERVICE_LABELS[s.service] ?? s.service)).join(', ')}
            </dd>
          </div>
        </div>
      </Card>
    </Page>
  );
}
