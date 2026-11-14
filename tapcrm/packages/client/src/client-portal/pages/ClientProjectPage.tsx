import { useEffect, useState } from 'react';
import { Button, Card, ErrorMessage, Loading, Notice, Page } from '../../ui/index.js';
import { IdentityApiError } from '../../identity/api/authApi.js';
import { formatProjectDate } from '../../projects/formatDate.js';
import { ProjectDetailNavigation } from '../../projects/ProjectDetailNavigation.js';
import { downloadPortalProjectReport, getPortalProject, PORTAL_SERVICE_LABELS, PORTAL_STATUS_LABELS, type PortalProject } from '../api/portalApi.js';
import { PortalLink, ProgressBar } from '../components.js';
import { ClientSocialConnectCard } from '../components/ClientSocialConnectCard.js';
import { ClientProjectReportSections } from '../components/ClientProjectReportSections.js';

type ClientProjectTab = 'details' | 'reports';
const CLIENT_PROJECT_TABS = [
  { value: 'details', label: 'Project Details', shortLabel: 'Details' },
  { value: 'reports', label: 'Reports', shortLabel: 'Reports' },
] as const;

export function ClientProjectPage({ id, onNavigate, onError }: { id: string; onNavigate: (path: string) => void; onError: (cause: unknown) => void }): React.JSX.Element {
  const [project, setProject] = useState<PortalProject | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [downloading, setDownloading] = useState(false);
  const [tab, setTab] = useState<ClientProjectTab>('details');

  useEffect(() => {
    let live = true;
    setProject(null);
    setError(null);
    setTab('details');
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
  const projectId = project.id;
  const projectName = project.name;

  async function downloadReport(): Promise<void> {
    setDownloading(true);
    try {
      const blob = await downloadPortalProjectReport(projectId);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${projectName.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'project'}-report.pdf`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (cause) {
      setError(cause);
      onError(cause);
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="client-project-page flex h-full min-h-0 flex-col">
      <ProjectDetailNavigation
        projectName={project.name}
        businessName={project.businessName}
        onBack={() => onNavigate('/client/projects')}
        tabs={CLIENT_PROJECT_TABS}
        value={tab}
        onChange={(next) => setTab(next as ClientProjectTab)}
      />

      <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
      {tab === 'details' && <>
        {project.services.some((s) => s.service === 'smo') && <ClientSocialConnectCard onNavigate={onNavigate} variant="project" emphasis />}
        <Card className="grid grid-cols-1 gap-5 p-4 sm:grid-cols-2 sm:p-6">
          <Field label="Client" value={project.clientName} />
          <Field label="Business" value={project.businessName} />
          <Field label="Work status" value={PORTAL_STATUS_LABELS[project.workStatus]} />
          <Field label="Start date" value={formatProjectDate(project.startDate)} />
          <Field label="Expected end date" value={formatProjectDate(project.expectedEndDate)} />
          <Field label="Services" value={project.services.length === 0 ? '—' : project.services.map((s) => (s.service === 'other' ? s.otherLabel : PORTAL_SERVICE_LABELS[s.service] ?? s.service)).join(', ')} />
        </Card>
        <Card className="mt-4">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-app-muted">Description</p>
          <p className="whitespace-pre-line break-words text-sm">{project.description || '—'}</p>
          <div className="mt-5 border-t border-app-border pt-5">
            <ProgressBar progress={project.progress} />
          </div>
        </Card>
        <Card className="mt-4">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-app-muted">Assigned team</p>
          {project.assignedEmployees.length === 0 ? (
            <p className="text-sm text-app-muted">No team members have been assigned yet.</p>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {project.assignedEmployees.map((employee) => (
                <li key={employee.fullName} className="rounded-full border border-app-border px-3 py-1 text-sm">
                  {employee.fullName}
                </li>
              ))}
            </ul>
          )}
        </Card>
        {!project.services.some((s) => s.service === 'smo') && <div className="mt-4"><ClientSocialConnectCard onNavigate={onNavigate} variant="project" /></div>}
      </>}

      {tab === 'reports' && <div className="space-y-4"><Card className="p-4 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="font-display text-lg font-bold">Project reports</h2>
            <p className="mt-1 max-w-2xl text-sm text-app-muted">Read-only project performance and content updates.</p>
          </div>
          <Button kind="secondary" onClick={() => void downloadReport()} disabled={downloading}>{downloading ? 'Preparing…' : 'Download report'}</Button>
        </div>
      </Card><ClientProjectReportSections projectId={project.id} /></div>}
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string | null }): React.JSX.Element {
  return <div className="min-w-0"><p className="text-xs font-semibold uppercase tracking-wide text-app-muted">{label}</p><p className="mt-1 break-words text-sm">{value || '—'}</p></div>;
}
