import { useEffect, useState } from 'react';
import { Button, Card, Loading, Notice, Page } from '../ui/components.js';
import { getProjects, type Project } from './api/projectsApi.js';
import { CreateDiscussionGroupModal } from './CreateDiscussionGroupModal.js';
import { CreateProjectModal } from './CreateProjectModal.js';

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
        <Loading />
      ) : projects.length === 0 ? (
        <Card className="mt-6 text-center text-sm text-app-muted">No projects yet.</Card>
      ) : (
        <Card className="mt-6 overflow-x-auto p-0">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-app-border text-xs uppercase tracking-wide text-app-muted">
              <tr>
                <th className="px-4 py-3">Project</th>
                <th className="px-4 py-3">Client</th>
                <th className="px-4 py-3">Priority</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Start</th>
                <th className="px-4 py-3">Discussion</th>
              </tr>
            </thead>
            <tbody>
              {projects.map((project) => (
                <tr key={project.id} className="border-b border-app-border last:border-b-0 hover:bg-app-surface-raised">
                  <td className="px-4 py-3">
                    <button type="button" onClick={() => onOpenProject(project.id)} className="font-semibold text-app-accent hover:underline">
                      {project.name}
                    </button>
                  </td>
                  <td className="px-4 py-3">{project.businessName}</td>
                  <td className="px-4 py-3">{PRIORITY_LABEL[project.priority]}</td>
                  <td className="px-4 py-3">{STATUS_LABEL[project.workStatus]}</td>
                  <td className="px-4 py-3 text-app-muted">{project.startDate}</td>
                  <td className="px-4 py-3">
                    {project.discussionConversationId ? <span className="text-app-accent">Created</span> : <span className="text-app-muted">Not yet</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
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
