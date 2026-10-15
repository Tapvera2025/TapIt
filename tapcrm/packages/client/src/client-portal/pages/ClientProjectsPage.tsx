import { useEffect, useState } from 'react';
import { Card, Empty, ErrorMessage, Loading, Page } from '../../ui/components.js';
import { formatProjectDate } from '../../projects/formatDate.js';
import { listPortalProjects, PORTAL_SERVICE_LABELS, type PortalProject } from '../api/portalApi.js';
import { PortalLink, ProgressBar, StatusBadge } from '../components.js';

export function ClientProjectsPage({ onNavigate, onError }: { onNavigate: (path: string) => void; onError: (cause: unknown) => void }): React.JSX.Element {
  const [projects, setProjects] = useState<PortalProject[] | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    let live = true;
    listPortalProjects().then((result) => { if (live) setProjects(result); }, (cause: unknown) => { if (live) { setError(cause); onError(cause); } });
    return () => { live = false; };
  }, [onError]);

  if (error) return <Page title="My projects"><ErrorMessage cause={error} /></Page>;
  if (!projects) return <Page title="My projects"><Loading /></Page>;

  return (
    <Page eyebrow="Projects" title="My projects" description="Every project we are working on with you.">
      {projects.length === 0 ? (
        <Empty>No projects have been shared with you yet.</Empty>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {projects.map((project) => (
            <Card key={project.id}>
              <div className="flex items-start justify-between gap-3">
                <PortalLink href={`/client/projects/${project.id}`} onNavigate={onNavigate} className="font-semibold hover:text-app-accent">{project.name}</PortalLink>
                <StatusBadge status={project.workStatus} />
              </div>
              {project.services.length > 0 && (
                <p className="mt-2 text-xs text-app-muted">
                  {project.services.map((s) => (s.service === 'other' ? s.otherLabel : PORTAL_SERVICE_LABELS[s.service] ?? s.service)).join(' · ')}
                </p>
              )}
              <p className="mt-2 text-xs text-app-muted">{formatProjectDate(project.startDate)} → {formatProjectDate(project.expectedEndDate)}</p>
              <div className="mt-4"><ProgressBar progress={project.progress} /></div>
            </Card>
          ))}
        </div>
      )}
    </Page>
  );
}
