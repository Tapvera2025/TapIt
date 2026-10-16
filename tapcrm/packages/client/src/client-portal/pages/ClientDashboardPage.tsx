import { useEffect, useState } from 'react';
import { formatProjectDate } from '../../projects/formatDate.js';
import { Card, Empty, ErrorMessage, Loading, WorkspacePageContainer } from '../../ui/components.js';
import { Icon } from '../../ui/Icon.js';
import { getPortalDashboard, PORTAL_STATUS_LABELS, type PortalDashboard, type PortalWorkStatus } from '../api/portalApi.js';
import { PortalLink, ProgressBar, StatusBadge } from '../components.js';

const STATUS_ORDER: PortalWorkStatus[] = ['ongoing', 'new', 'ended', 'expired'];

const STATUS_PRESENTATION: Record<PortalWorkStatus, { icon: string; color: string; dot: string; surface: string }> = {
  ongoing: { icon: 'clock', color: 'text-app-accent', dot: 'bg-app-accent', surface: 'bg-app-accent/10 ring-app-accent/15' },
  new: { icon: 'plus', color: 'text-sky-600 dark:text-sky-400', dot: 'bg-sky-500', surface: 'bg-sky-500/10 ring-sky-500/15' },
  ended: { icon: 'check', color: 'text-emerald-600 dark:text-emerald-400', dot: 'bg-emerald-500', surface: 'bg-emerald-500/10 ring-emerald-500/15' },
  expired: { icon: 'history', color: 'text-amber-600 dark:text-amber-400', dot: 'bg-amber-500', surface: 'bg-amber-500/10 ring-amber-500/15' },
};

export function ClientDashboardPage({ onNavigate, onError }: { onNavigate: (path: string) => void; onError: (cause: unknown) => void }): React.JSX.Element {
  const [data, setData] = useState<PortalDashboard | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    let live = true;
    getPortalDashboard().then((result) => { if (live) setData(result); }, (cause: unknown) => { if (live) { setError(cause); onError(cause); } });
    return () => { live = false; };
  }, [onError]);

  if (error) return <WorkspacePageContainer><div className="pt-5"><ErrorMessage cause={error} /></div></WorkspacePageContainer>;
  if (!data) return <WorkspacePageContainer><div className="pt-5"><Loading /></div></WorkspacePageContainer>;

  return (
    <WorkspacePageContainer className="pb-6 pt-4 sm:pt-5">
      <div className="space-y-4 sm:space-y-5">
        <section aria-label="Client overview" className="relative isolate overflow-hidden rounded-2xl border border-app-border bg-app-surface p-5 shadow-sm sm:p-7">
          <div aria-hidden="true" className="pointer-events-none absolute -right-14 -top-20 size-64 rounded-full bg-app-accent/10 blur-3xl" />
          <header className="relative max-w-3xl">
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-app-accent">{data.profile.businessName}</p>
            <h1 className="mt-2 font-display text-2xl font-bold tracking-[-0.04em] text-app-foreground sm:text-3xl lg:text-4xl">
              Welcome, {data.profile.clientName}
            </h1>
            <p className="mt-2 text-sm leading-6 text-app-muted sm:text-base">
              A snapshot of your projects with {data.profile.organizationName}.
            </p>
          </header>

          <div aria-label="Project counts" className="relative mt-5 grid min-w-0 grid-cols-1 border-t border-app-border min-[420px]:grid-cols-2 xl:grid-cols-4">
            {STATUS_ORDER.map((status, index) => {
              const presentation = STATUS_PRESENTATION[status];
              return (
                <div key={status} className={`flex min-w-0 items-center gap-3 py-4 ${index < STATUS_ORDER.length - 1 ? 'border-b border-app-border' : ''} min-[420px]:border-b-0 ${index < 2 ? 'min-[420px]:border-b min-[420px]:border-app-border' : ''} min-[420px]:even:border-l min-[420px]:even:pl-4 xl:border-b-0 xl:border-l xl:pl-5 xl:first:border-l-0 xl:first:pl-0`}>
                  <span className={`grid size-10 shrink-0 place-items-center rounded-full ring-1 ${presentation.surface}`}>
                    <Icon name={presentation.icon} className={`size-5 ${presentation.color}`} />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-[11px] font-bold uppercase tracking-[0.1em] text-app-muted">{PORTAL_STATUS_LABELS[status]}</p>
                    <p className="mt-1 font-display text-2xl font-bold leading-none text-app-foreground sm:text-3xl">{data.counts[status]}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <div className="grid min-w-0 gap-4 xl:grid-cols-12">
          <Card className="min-w-0 xl:col-span-8">
            <div className="flex min-w-0 items-start justify-between gap-3">
              <div className="flex min-w-0 items-start gap-3">
                <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-app-accent/10 text-app-accent">
                  <Icon name="briefcase" className="size-5" />
                </span>
                <div className="min-w-0">
                  <h2 className="font-display text-lg font-bold">Recent projects</h2>
                  <p className="mt-0.5 text-sm text-app-muted">Your latest shared project updates.</p>
                </div>
              </div>
              <PortalLink href="/client/projects" onNavigate={onNavigate} className="inline-flex shrink-0 items-center gap-1 pt-1 text-sm font-semibold text-app-accent hover:underline">
                View all <Icon name="arrow" className="size-4" />
              </PortalLink>
            </div>

            {data.recentProjects.length === 0 ? (
              <Empty>No projects have been shared with you yet.</Empty>
            ) : (
              <div className="mt-5 space-y-3">
                {data.recentProjects.map((project) => (
                  <article key={project.id} className="min-w-0 rounded-xl border border-app-border bg-app-background/30 p-3.5 sm:p-4">
                    <div className="flex min-w-0 items-start gap-3">
                      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-app-accent/10 text-app-accent">
                        <Icon name="briefcase" className="size-5" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-2">
                          <PortalLink href={`/client/projects/${project.id}`} onNavigate={onNavigate} className="min-w-0 break-words font-semibold text-app-foreground hover:text-app-accent">
                            {project.name}
                          </PortalLink>
                          <StatusBadge status={project.workStatus} />
                        </div>
                        <p className="mt-1 text-xs text-app-muted">Target: {formatProjectDate(project.expectedEndDate)}</p>
                        <div className="mt-3"><ProgressBar progress={project.progress} /></div>
                      </div>
                      <PortalLink href={`/client/projects/${project.id}`} onNavigate={onNavigate} className="mt-1 shrink-0 rounded-lg p-1 text-app-muted hover:bg-app-surface-raised hover:text-app-accent" aria-label={`Open ${project.name}`}>
                        <Icon name="chevron-right" className="size-5" />
                      </PortalLink>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </Card>

          <Card className="min-w-0 xl:col-span-4">
            <div className="flex items-start gap-3">
              <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-app-accent/10 text-app-accent">
                <Icon name="chart" className="size-5" />
              </span>
              <div>
                <h2 className="font-display text-lg font-bold">Project status overview</h2>
                <p className="mt-0.5 text-sm text-app-muted">A summary of your project pipeline.</p>
              </div>
            </div>
            <dl className="mt-5 divide-y divide-app-border">
              {STATUS_ORDER.map((status) => {
                const presentation = STATUS_PRESENTATION[status];
                return (
                  <div key={status} className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
                    <dt className="flex min-w-0 items-center gap-2.5 text-sm text-app-muted">
                      <span className={`size-2 shrink-0 rounded-full ${presentation.dot}`} />
                      <span className="truncate">{PORTAL_STATUS_LABELS[status]}</span>
                    </dt>
                    <dd className="font-display text-lg font-bold tabular-nums text-app-foreground">{data.counts[status]}</dd>
                  </div>
                );
              })}
            </dl>
          </Card>
        </div>
      </div>
    </WorkspacePageContainer>
  );
}
