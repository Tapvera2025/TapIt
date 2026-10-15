import { useEffect, useState } from 'react';
import { Card, Empty, ErrorMessage, Loading, Page } from '../../ui/components.js';
import { formatProjectDate } from '../../projects/formatDate.js';
import { getPortalDashboard, PORTAL_STATUS_LABELS, type PortalDashboard, type PortalWorkStatus } from '../api/portalApi.js';
import { PortalLink, ProgressBar, StatusBadge } from '../components.js';

const STATUS_ORDER: PortalWorkStatus[] = ['ongoing', 'new', 'ended', 'expired'];

export function ClientDashboardPage({ onNavigate, onError }: { onNavigate: (path: string) => void; onError: (cause: unknown) => void }): React.JSX.Element {
  const [data, setData] = useState<PortalDashboard | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    let live = true;
    getPortalDashboard().then((result) => { if (live) setData(result); }, (cause: unknown) => { if (live) { setError(cause); onError(cause); } });
    return () => { live = false; };
  }, [onError]);

  if (error) return <Page title="Dashboard"><ErrorMessage cause={error} /></Page>;
  if (!data) return <Page title="Dashboard"><Loading /></Page>;

  return (
    <Page eyebrow={data.profile.businessName} title={`Welcome, ${data.profile.clientName}`} description={`A snapshot of your projects with ${data.profile.organizationName}.`}>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {STATUS_ORDER.map((status) => (
          <Card key={status}>
            <p className="text-xs font-semibold uppercase tracking-[0.1em] text-app-muted">{PORTAL_STATUS_LABELS[status]}</p>
            <p className="mt-2 font-display text-3xl font-bold">{data.counts[status]}</p>
          </Card>
        ))}
      </div>

      <div className="mt-8 flex items-center justify-between">
        <h2 className="font-display text-lg font-bold">Recent projects</h2>
        <PortalLink href="/client/projects" onNavigate={onNavigate} className="text-sm font-semibold text-app-accent hover:underline">View all</PortalLink>
      </div>
      {data.recentProjects.length === 0 ? (
        <Empty>No projects have been shared with you yet.</Empty>
      ) : (
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {data.recentProjects.map((project) => (
            <Card key={project.id}>
              <div className="flex items-start justify-between gap-3">
                <PortalLink href={`/client/projects/${project.id}`} onNavigate={onNavigate} className="font-semibold hover:text-app-accent">{project.name}</PortalLink>
                <StatusBadge status={project.workStatus} />
              </div>
              <p className="mt-1 text-xs text-app-muted">Target: {formatProjectDate(project.expectedEndDate)}</p>
              <div className="mt-4"><ProgressBar progress={project.progress} /></div>
            </Card>
          ))}
        </div>
      )}
    </Page>
  );
}
