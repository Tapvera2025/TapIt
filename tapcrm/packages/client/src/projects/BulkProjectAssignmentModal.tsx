import { useEffect, useMemo, useState } from 'react';
import { getChatColleagues } from '../chat/index.js';
import { Button, Modal, Notice } from '../ui/components.js';
import { bulkAssignProjects, getProjects, type Project } from './api/projectsApi.js';

type Person = { id: string; fullName: string };

export function BulkProjectAssignmentModal({ onClose, onCompleted }: { onClose: () => void; onCompleted: () => void }): React.JSX.Element {
  const [people, setPeople] = useState<Person[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [employeeIds, setEmployeeIds] = useState<string[]>([]);
  const [projectIds, setProjectIds] = useState<string[]>([]);
  const [employeeSearch, setEmployeeSearch] = useState('');
  const [projectSearch, setProjectSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    void Promise.all([getChatColleagues(), getProjects({ page: 1, pageSize: 100 })])
      .then(([nextPeople, page]) => {
        if (cancelled) return;
        setPeople(nextPeople);
        setProjects(page.items);
      })
      .catch((cause) => { if (!cancelled) setError(cause instanceof Error ? cause.message : 'Unable to load assignment options.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const filteredPeople = useMemo(() => {
    const term = employeeSearch.trim().toLowerCase();
    return people.filter((person) => !term || person.fullName.toLowerCase().includes(term));
  }, [employeeSearch, people]);
  const filteredProjects = useMemo(() => {
    const term = projectSearch.trim().toLowerCase();
    return projects.filter((project) => !term || project.name.toLowerCase().includes(term));
  }, [projectSearch, projects]);
  const selectedEmployeeNames = people.filter((person) => employeeIds.includes(person.id));
  const selectedProjectNames = projects.filter((project) => projectIds.includes(project.id));

  const projectAlreadyAssigned = (project: Project): boolean =>
    employeeIds.some((employeeId) => project.assignees.some((assignee) => assignee.userId === employeeId));
  const employeeAlreadyAssigned = (employeeId: string): boolean =>
    projectIds.some((projectId) => projects.find((project) => project.id === projectId)?.assignees.some((assignee) => assignee.userId === employeeId) === true);

  function toggle(id: string, selected: string[], setSelected: (value: string[]) => void): void {
    setSelected(selected.includes(id) ? selected.filter((item) => item !== id) : [...selected, id]);
  }

  async function save(): Promise<void> {
    if (employeeIds.length === 0 || projectIds.length === 0) {
      setError('Select at least one employee and one project.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await bulkAssignProjects(employeeIds, projectIds);
      setSaving(false);
      onCompleted();
      onClose();
    } catch (cause) {
      setSaving(false);
      setError(cause instanceof Error ? cause.message : 'Unable to assign projects.');
    }
  }

  return (
    <Modal title="Bulk Project Assignment" onClose={saving ? () => undefined : onClose} size="lg">
      <div className="space-y-4">
        <p className="text-sm text-app-muted">Select employees and projects to assign multiple projects in one operation.</p>
        {error && <Notice error>{error}</Notice>}
        {loading ? <p className="text-sm text-app-muted">Loading employees and projects…</p> : (
          <>
            <Picker title="Select Employees" search={employeeSearch} onSearch={setEmployeeSearch} selected={selectedEmployeeNames.map((person) => ({ id: person.id, label: person.fullName }))} onRemove={(id) => toggle(id, employeeIds, setEmployeeIds)}>
              {filteredPeople.length === 0 ? <p className="px-3 py-3 text-xs text-app-muted">No employees found.</p> : filteredPeople.map((person) => { const disabled = employeeAlreadyAssigned(person.id); return <Option key={person.id} label={person.fullName} checked={employeeIds.includes(person.id)} disabled={disabled} onClick={() => toggle(person.id, employeeIds, setEmployeeIds)} />; })}
            </Picker>
            <Picker title="Select Projects" search={projectSearch} onSearch={setProjectSearch} selected={selectedProjectNames.map((project) => ({ id: project.id, label: project.name }))} onRemove={(id) => toggle(id, projectIds, setProjectIds)}>
              {filteredProjects.length === 0 ? <p className="px-3 py-3 text-xs text-app-muted">No projects found in your accessible scope.</p> : filteredProjects.map((project) => { const disabled = projectAlreadyAssigned(project); return <Option key={project.id} label={project.name} detail={`${project.clientName} · ${project.workStatus}`} checked={projectIds.includes(project.id)} disabled={disabled} onClick={() => toggle(project.id, projectIds, setProjectIds)} />; })}
            </Picker>
          </>
        )}
        <div className="rounded-lg border border-app-border bg-app-background px-3 py-2 text-sm text-app-muted">
          <span>Employees selected: <strong className="text-app-foreground">{employeeIds.length}</strong></span>
          <span className="mx-2">·</span>
          <span>Projects selected: <strong className="text-app-foreground">{projectIds.length}</strong></span>
          <span className="mx-2">·</span>
          <span>Assignments: <strong className="text-app-foreground">{employeeIds.length * projectIds.length}</strong></span>
        </div>
        <div className="flex justify-end gap-2 border-t border-app-border pt-4">
          <Button kind="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={() => { void save(); }} disabled={saving || loading}>{saving ? 'Assigning…' : 'Save'}</Button>
        </div>
      </div>
    </Modal>
  );
}

function Picker({ title, search, onSearch, selected, onRemove, children }: { title: string; search: string; onSearch: (value: string) => void; selected: Array<{ id: string; label: string }>; onRemove: (id: string) => void; children: React.ReactNode }): React.JSX.Element {
  return <div><div className="mb-1.5 flex items-center justify-between"><span className="text-xs font-semibold text-app-muted">{title}</span><span className="text-xs text-app-muted">{selected.length} selected</span></div>{selected.length > 0 && <div className="mb-2 flex flex-wrap gap-1.5">{selected.map((item) => <span key={item.id} className="inline-flex max-w-full items-center gap-1 rounded-md border border-app-border bg-app-background px-2 py-1 text-xs"><span className="truncate">{item.label}</span><button type="button" className="text-app-muted hover:text-app-danger" onClick={() => onRemove(item.id)} aria-label={`Remove ${item.label}`}>×</button></span>)}</div>}<input value={search} onChange={(event) => onSearch(event.target.value)} placeholder={`Search ${title.toLowerCase()}…`} className="mb-1.5 w-full rounded-lg border border-app-border bg-app-background px-3 py-2 text-sm outline-none focus:border-app-accent" /><div className="max-h-40 overflow-y-auto rounded-lg border border-app-border">{children}</div></div>;
}

function Option({ label, detail, checked, disabled, onClick }: { label: string; detail?: string; checked: boolean; disabled: boolean; onClick: () => void }): React.JSX.Element {
  return <button type="button" onClick={onClick} disabled={disabled} className={`flex w-full items-center gap-3 border-b border-app-border/60 px-3 py-2 text-left text-sm last:border-b-0 ${disabled ? 'cursor-not-allowed text-app-muted/60 opacity-60' : 'hover:bg-app-accent/5'}`}><input type="checkbox" checked={checked} disabled={disabled} readOnly className="shrink-0" /><span className="min-w-0"><span className="block truncate font-medium">{label}</span>{detail && <span className="block truncate text-xs text-app-muted">{detail}</span>}</span></button>;
}
