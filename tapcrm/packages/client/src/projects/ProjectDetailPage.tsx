import { useEffect, useState } from 'react';
import { getChatColleagues } from '../chat/index.js';
import { TasksPage } from '../company/tasks/index.js';
import { Button, Card, Loading, Notice } from '../ui/components.js';
import { getProject, setProjectTeam, type Project } from './api/projectsApi.js';
import { EditProjectModal } from './EditProjectModal.js';
import { formatProjectDate } from './formatDate.js';
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
  const [showEdit, setShowEdit] = useState(false);
  const [editingTeam, setEditingTeam] = useState(false);
  const [colleagues, setColleagues] = useState<{ id: string; fullName: string }[]>([]);
  const [teamSelection, setTeamSelection] = useState<Set<string>>(new Set());
  const [savingTeam, setSavingTeam] = useState(false);

  useEffect(() => {
    void getProject(projectId)
      .then(setProject)
      .catch((cause) => setError(cause instanceof Error ? cause.message : 'Unable to load project.'));
  }, [projectId]);

  if (error) return <div className="p-6"><Notice error>{error}</Notice></div>;
  if (!project) return <Loading />;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-app-border px-4 py-2.5">
        <div className="flex min-w-0 items-baseline gap-2">
          <button type="button" onClick={onBack} className="shrink-0 text-xs font-semibold text-app-muted hover:text-app-accent">← Back</button>
          <h1 className="truncate font-display text-base font-bold">{project.name}</h1>
          <p className="shrink-0 text-xs text-app-muted">{project.businessName}</p>
        </div>
        <Button kind="secondary" onClick={() => setShowEdit(true)} className="!shrink-0 !px-3 !py-1.5 !text-xs">Edit project</Button>
      </div>

      <div className="flex shrink-0 gap-1 border-b border-app-border px-4 pt-1.5">
        {TABS.map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setTab(value)}
            className={`rounded-t-lg px-3 py-1.5 text-sm font-semibold ${tab === value ? 'border-b-2 border-app-accent text-app-accent' : 'text-app-muted hover:text-app-foreground'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'discussions' ? (
        <div className="min-h-0 flex-1">
          <ProjectDiscussionTab project={project} currentUserId={currentUserId} onProjectUpdated={setProject} />
        </div>
      ) : (
      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === 'details' && (
          <div className="p-5">
            <Card className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Field label="Client" value={project.clientName} />
              <Field label="Business" value={project.businessName} />
              <Field label="Priority" value={PRIORITY_LABEL[project.priority]} />
              <Field label="Work status" value={STATUS_LABEL[project.workStatus]} />
              <Field label="Start date" value={formatProjectDate(project.startDate)} />
              <Field label="Expected end date" value={formatProjectDate(project.expectedEndDate)} />
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
              <div className="mb-2 flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-wide text-app-muted">Assigned employees</p>
                {!editingTeam && (
                  <button
                    type="button"
                    onClick={() => {
                      setTeamSelection(new Set(project.assignees.map((a) => a.userId)));
                      setEditingTeam(true);
                      if (colleagues.length === 0) void getChatColleagues().then(setColleagues).catch(() => setColleagues([]));
                    }}
                    className="text-xs font-semibold text-app-accent hover:underline"
                  >
                    Edit
                  </button>
                )}
              </div>

              {!editingTeam ? (
                project.assignees.length === 0 ? (
                  <p className="text-sm text-app-muted">No one assigned yet.</p>
                ) : (
                  <ul className="flex flex-wrap gap-2">
                    {project.assignees.map((a) => (
                      <li key={a.userId} className="rounded-full border border-app-border px-3 py-1 text-xs">{a.fullName}</li>
                    ))}
                  </ul>
                )
              ) : (
                <>
                  {colleagues.length === 0 ? (
                    <Loading />
                  ) : (
                    <div className="max-h-48 overflow-y-auto rounded-lg border border-app-border">
                      {colleagues.map((person) => (
                        <label key={person.id} className="flex items-center gap-2 border-b border-app-border px-3 py-2 text-sm last:border-b-0">
                          <input
                            type="checkbox"
                            checked={teamSelection.has(person.id)}
                            onChange={() => {
                              setTeamSelection((current) => {
                                const next = new Set(current);
                                if (next.has(person.id)) next.delete(person.id);
                                else next.add(person.id);
                                return next;
                              });
                            }}
                          />
                          {person.fullName}
                        </label>
                      ))}
                    </div>
                  )}
                  <div className="mt-3 flex justify-end gap-2">
                    <Button kind="secondary" onClick={() => setEditingTeam(false)} className="!px-3 !py-1.5 !text-xs">Cancel</Button>
                    <Button
                      onClick={() => {
                        setSavingTeam(true);
                        void setProjectTeam(project.id, [...teamSelection])
                          .then((updated) => { setProject(updated); setEditingTeam(false); })
                          .catch((cause) => setError(cause instanceof Error ? cause.message : 'Unable to update the team.'))
                          .finally(() => setSavingTeam(false));
                      }}
                      disabled={savingTeam}
                      className="!px-3 !py-1.5 !text-xs"
                    >
                      {savingTeam ? 'Saving…' : 'Save team'}
                    </Button>
                  </div>
                </>
              )}
            </Card>
          </div>
        )}

        {tab === 'tasks' && (
          <TasksPage isSuperAdmin={isSuperAdmin} currentUserId={currentUserId} initialProjectId={project.id} />
        )}

        {tab === 'reports' && (
          <div className="grid h-64 place-items-center text-sm text-app-muted">Reports are coming soon.</div>
        )}
      </div>
      )}

      {error && (
        <p role="alert" className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-lg border border-[#d86b6b]/30 bg-app-surface px-4 py-2 text-sm text-app-danger shadow-lg">
          {error}
        </p>
      )}

      {showEdit && (
        <EditProjectModal
          project={project}
          onClose={() => setShowEdit(false)}
          onSaved={(updated) => { setProject(updated); setShowEdit(false); }}
        />
      )}
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
