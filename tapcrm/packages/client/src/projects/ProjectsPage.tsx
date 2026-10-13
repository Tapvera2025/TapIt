import { useEffect, useState } from 'react';
import { Button, Card, Notice, Page, SkeletonTable } from '../ui/components.js';
import { getProjects, type Project } from './api/projectsApi.js';
import { CreateDiscussionGroupModal } from './CreateDiscussionGroupModal.js';
import { CreateProjectModal } from './CreateProjectModal.js';
import { formatProjectDate } from './formatDate.js';

const PRIORITY_LABEL: Record<Project['priority'], string> = { low: 'Low', medium: 'Medium', high: 'High' };
const STATUS_LABEL: Record<Project['workStatus'], string> = { new: 'New', ongoing: 'Ongoing', ended: 'Ended', expired: 'Expired' };

/**
 * Projects — Phase 4. Creating one is a TWO-STEP wizard: this page shows
 * step 1 (CreateProjectModal); once the project exists, step 2
 * (CreateDiscussionGroupModal) opens automatically but can be skipped —
 * the Discussions tab on the project's own page offers it again later.
 */
export function ProjectsPage({ onOpenProject }: { onOpenProject: (projectId: string) => void }): React.JSX.Element {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [pendingGroupFor, setPendingGroupFor] = useState<Project | null>(null);

  async function load(): Promise<void> {
    setLoading(true);
    try {
      const page = await getProjects();
      setProjects(page.items);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load projects.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  return (
    <Page eyebrow="Projects" title="Projects" description="Every active client engagement." action={<Button onClick={() => setShowCreate(true)}>New project</Button>}>
      {error && <div className="mt-4"><Notice error>{error}</Notice></div>}
      {loading ? (
        <SkeletonTable columns={4} rows={5} />
      ) : projects.length === 0 ? (
        <Card className="mt-6 text-center text-sm text-app-muted">No projects yet.</Card>
      ) : (
        <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {projects.map((project) => (
            <Card key={project.id} className="flex h-full flex-col gap-4 border border-app-border shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="truncate font-display text-lg font-bold">{project.name}</h2>
                  <p className="mt-1 truncate text-sm text-app-muted">{project.businessName}</p>
                </div>
                <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${project.workStatus === 'ongoing' ? 'bg-emerald-500/10 text-emerald-600' : project.workStatus === 'ended' || project.workStatus === 'expired' ? 'bg-red-500/10 text-red-600' : 'bg-amber-500/10 text-amber-600'}`}>{STATUS_LABEL[project.workStatus]}</span>
              </div>
              <div className="grid grid-cols-2 gap-3 rounded-lg bg-app-background p-3 text-sm">
                <ProjectMeta label="Client" value={project.clientName} />
                <ProjectMeta label="Priority" value={PRIORITY_LABEL[project.priority]} />
                <ProjectMeta label="Start date" value={formatProjectDate(project.startDate)} />
                <ProjectMeta label="Discussion" value={project.discussionConversationId ? 'Created' : 'Not yet'} />
              </div>
              <div className="mt-auto flex items-center justify-between gap-3 border-t border-app-border pt-3">
                <p className="truncate text-xs text-app-muted">{project.services.map((service) => service.otherLabel || service.service).join(' · ') || 'No services listed'}</p>
                <Button onClick={() => onOpenProject(project.id)} className="shrink-0 !px-3 !py-1.5 !text-xs">Open project details</Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      {showCreate && (
        <CreateProjectModal
          onClose={() => setShowCreate(false)}
          onCreated={(project) => {
            setShowCreate(false);
            setPendingGroupFor(project); // step 2
            void load();
          }}
        />
      )}

      {pendingGroupFor && (
        <CreateDiscussionGroupModal
          project={pendingGroupFor}
          onClose={() => { setPendingGroupFor(null); onOpenProject(pendingGroupFor.id); }}
          onCreated={() => { setPendingGroupFor(null); void load(); onOpenProject(pendingGroupFor.id); }}
        />
      )}
    </Page>
  );
}

function ProjectMeta({ label, value }: { label: string; value: string }): React.JSX.Element {
  return <div className="min-w-0"><p className="text-[11px] font-semibold uppercase tracking-wide text-app-muted">{label}</p><p className="mt-1 truncate font-medium">{value || '—'}</p></div>;
}
