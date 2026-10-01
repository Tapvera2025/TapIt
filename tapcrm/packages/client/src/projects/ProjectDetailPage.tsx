import { useEffect, useState } from 'react';
import { TasksPage } from '../company/tasks/index.js';
import { Card, Loading, Notice } from '../ui/components.js';
import { getProject, type Project } from './api/projectsApi.js';
import { ProjectDiscussionTab } from './ProjectDiscussionTab.js';

type Tab = 'details' | 'discussions' | 'tasks' | 'reports';
const TABS: Array<[Tab, string]> = [
  ['details', 'Project Details'],
  ['discussions', 'Project Discussions'],
  ['tasks', 'Task Assignment'],
  ['reports', 'Reports'],
];

const PRIORITY_LABEL: Record<Project['priority'], string> = { low: 'Low', medium: 'Medium', high: 'High' };
const STATUS_LABEL: Record<Project['workStatus'], string> = { new: 'New', ongoing: 'Ongoing', ended: 'Ended', expired: 'Expired' };
const SERVICE_LABEL: Record<string, string> = { website: 'Website', seo: 'SEO', ads: 'Ads', smo: 'SMO', google_marketing: 'Google Marketing' };

export function ProjectDetailPage({
  projectId,
  currentUserId,
  isSuperAdmin,
  onBack,
}: {
  projectId: string;
  currentUserId: string;
  isSuperAdmin: boolean;
  onBack: () => void;
}): React.JSX.Element {
  const [project, setProject] = useState<Project | null>(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<Tab>('details');

  useEffect(() => {
    void getProject(projectId)
      .then(setProject)
      .catch((cause) => setError(cause instanceof Error ? cause.message : 'Unable to load project.'));
  }, [projectId]);

  if (error) return <div className="p-6"><Notice error>{error}</Notice></div>;
  if (!project) return <Loading />;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between gap-3 border-b border-app-border p-4">
        <div>
          <button type="button" onClick={onBack} className="text-xs font-semibold text-app-muted hover:text-app-accent">← Back to Projects</button>
          <h1 className="font-display text-xl font-bold">{project.name}</h1>
          <p className="text-sm text-app-muted">{project.businessName}</p>
        </div>
      </div>

      <div className="flex gap-1 border-b border-app-border px-4 pt-3">
        {TABS.map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setTab(value)}
            className={`rounded-t-lg px-3 py-2 text-sm font-semibold ${tab === value ? 'border-b-2 border-app-accent text-app-accent' : 'text-app-muted hover:text-app-foreground'}`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === 'details' && (
          <div className="p-5">
            <Card className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Field label="Client" value={project.clientName} />
              <Field label="Business" value={project.businessName} />
              <Field label="Priority" value={PRIORITY_LABEL[project.priority]} />
              <Field label="Work status" value={STATUS_LABEL[project.workStatus]} />
              <Field label="Start date" value={project.startDate} />
              <Field label="Expected end date" value={project.expectedEndDate ?? '—'} />
              <Field label="Budget" value={project.budget ? `${project.currency} ${project.budget}` : '—'} />
              <Field label="Services" value={project.services.map((s) => (s.service === 'other' ? s.otherLabel : SERVICE_LABEL[s.service]) ?? '').join(', ') || '—'} />
            </Card>
            <Card className="mt-4">
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-app-muted">Description</p>
              <p className="text-sm">{project.description || '—'}</p>
              <p className="mb-1 mt-4 text-xs font-semibold uppercase tracking-wide text-app-muted">Remarks</p>
              <p className="text-sm">{project.remarks || '—'}</p>
            </Card>
            <Card className="mt-4">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-app-muted">Assigned employees</p>
              {project.assignees.length === 0 ? (
                <p className="text-sm text-app-muted">No one assigned yet.</p>
              ) : (
                <ul className="flex flex-wrap gap-2">
                  {project.assignees.map((a) => (
                    <li key={a.userId} className="rounded-full border border-app-border px-3 py-1 text-xs">{a.fullName}</li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        )}

        {tab === 'discussions' && (
          <ProjectDiscussionTab project={project} currentUserId={currentUserId} onProjectUpdated={setProject} />
        )}

        {tab === 'tasks' && (
          <TasksPage isSuperAdmin={isSuperAdmin} currentUserId={currentUserId} initialProjectId={project.id} />
        )}

        {tab === 'reports' && (
          <div className="grid h-64 place-items-center text-sm text-app-muted">Reports are coming soon.</div>
        )}
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-app-muted">{label}</p>
      <p className="mt-1 text-sm">{value}</p>
    </div>
  );
}
