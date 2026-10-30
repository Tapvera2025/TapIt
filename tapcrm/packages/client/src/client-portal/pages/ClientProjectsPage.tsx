import { useEffect, useState } from 'react';
import { Empty, ErrorMessage, Loading, Page } from '../../ui/components.js';
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
        <div className="grid min-w-0 gap-3">
          {projects.map((project) => (
            <PortalLink
              key={project.id}
              href={`/client/projects/${project.id}`}
              onNavigate={onNavigate}
              className="ui-card group block min-w-0 p-4 transition hover:border-app-accent/40 hover:shadow-md focus-visible:outline-2 focus-visible:outline-app-accent focus-visible:outline-offset-2 sm:p-5"
            >
              <div className="grid min-w-0 gap-4 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,0.9fr)] sm:items-center xl:grid-cols-[minmax(0,1.5fr)_minmax(170px,0.8fr)_minmax(220px,1fr)]">
                <div className="min-w-0">
                  <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
                    <h2 className="min-w-0 break-words font-display text-lg font-bold text-app-foreground transition-colors group-hover:text-app-accent">{project.name}</h2>
                    <StatusBadge status={project.workStatus} />
                  </div>
                  {project.services.length > 0 && (
                    <p className="mt-1 break-words text-sm text-app-muted">
                      {project.services.map((s) => (s.service === 'other' ? s.otherLabel : PORTAL_SERVICE_LABELS[s.service] ?? s.service)).join(' · ')}
                    </p>
                  )}
                </div>

                <div className="min-w-0 text-sm">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-app-muted">Schedule</p>
                  <p className="mt-1 text-app-foreground">{formatProjectDate(project.startDate)} <span className="text-app-muted">→</span> {formatProjectDate(project.expectedEndDate)}</p>
                </div>

                <div className="min-w-0 sm:col-span-2 xl:col-span-1">
                  <ProgressBar progress={project.progress} />
                </div>
              </div>
            </PortalLink>
          ))}
        </div>
      )}
    </Page>
  );
}
