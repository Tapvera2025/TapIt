import { useEffect, useState } from 'react';
import { getClient } from '../clients/api/clientsApi.js';
import { getCompanyEmployees, type CompanyEmployee } from '../company/api/companyApi.js';
import { Button, Loading, Modal, Notice } from '../ui/components.js';
import { createDiscussionGroup, getProject, type Project } from './api/projectsApi.js';

/**
 * The wizard's SECOND step (product decision — separate from project
 * creation): a suggested name and the project's current team + client are
 * preselected, but every bit of it is editable before the group is made.
 * Also reachable later from the Discussions tab if this step was skipped.
 */
export function CreateDiscussionGroupModal({
  project,
  onClose,
  onCreated,
}: {
  project: Project;
  onClose: () => void;
  onCreated: (project: Project) => void;
}): React.JSX.Element {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState(`${project.name} – ${project.businessName}`);
  const [colleagues, setColleagues] = useState<CompanyEmployee[]>([]);
  const [clientLoginUserId, setClientLoginUserId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set(project.assignees.map((a) => a.userId)));

  useEffect(() => {
    void Promise.all([getCompanyEmployees(), getClient(project.clientId)])
      .then(([employees, client]) => {
        setColleagues(employees);
        setClientLoginUserId(client.loginUserId);
        if (client.loginUserId) setSelected((current) => new Set([...current, client.loginUserId!]));
      })
      .catch((cause) => setError(cause instanceof Error ? cause.message : 'Unable to load the team.'))
      .finally(() => setLoading(false));
  }, [project.clientId]);

  const toggle = (id: string): void => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const submit = async (): Promise<void> => {
    if (!name.trim() || selected.size === 0 || saving) return;
    setSaving(true);
    setError('');
    try {
      await createDiscussionGroup(project.id, name.trim(), [...selected]);
      onCreated(await getProject(project.id));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to create the discussion group.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="Create discussion group" onClose={onClose}>
      {loading ? (
        <Loading />
      ) : (
        <div className="space-y-4">
          {error && <Notice error>{error}</Notice>}
          <label className="text-xs font-semibold text-app-muted">
            <span className="mb-2 block">Group name</span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="w-full rounded-lg border border-app-border bg-app-background px-3 py-2.5 text-sm outline-none focus:border-app-accent"
            />
          </label>

          <div>
            <p className="mb-2 text-xs font-semibold text-app-muted">Members</p>
            <div className="max-h-56 overflow-y-auto rounded-lg border border-app-border">
              {clientLoginUserId && (
                <label className="flex items-center gap-2 border-b border-app-border bg-app-surface-raised px-3 py-2 text-sm">
                  <input type="checkbox" checked={selected.has(clientLoginUserId)} onChange={() => toggle(clientLoginUserId)} />
                  {project.clientName} <span className="text-xs text-app-muted">(client)</span>
                </label>
              )}
              {colleagues.map((person) => (
                <label key={person.id} className="flex items-center gap-2 border-b border-app-border px-3 py-2 text-sm last:border-b-0">
                  <input type="checkbox" checked={selected.has(person.id)} onChange={() => toggle(person.id)} />
                  {person.fullName}
                  {project.assignees.some((a) => a.userId === person.id) && <span className="text-xs text-app-muted">(assigned)</span>}
                </label>
              ))}
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button kind="secondary" onClick={onClose}>Skip for now</Button>
            <Button onClick={() => void submit()} disabled={saving || !name.trim() || selected.size === 0}>
              {saving ? 'Creating…' : 'Create group'}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
