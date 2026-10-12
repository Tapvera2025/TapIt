import { useEffect, useState } from 'react';
import { Icon } from '../../ui/Icon.js';
import { WorkspacePageContainer } from '../../ui/components.js';
import { organizationApi } from '../api/organizationApi.js';
import {
  Button,
  Card,
  ErrorMessage,
  Field,
  SkeletonTable,
  Modal,
  Notice,
  Select,
} from '../components/OrganizationUi.js';
import type {
  OrganizationChart,
  OrganizationDepartment,
  OrganizationTeam,
} from '../types/index.js';

const blank = {
  departmentId: '',
  kind: '',
  name: '',
  leadUserId: '',
  parentTeamId: '',
  sharedVisibility: false,
};
const TEAM_KINDS = [
  { value: 'sales-team', label: 'Sales team' },
  { value: 'sales-pool', label: 'Sales pool' },
  { value: 'dev-subteam', label: 'Development sub-team' },
];
export function TeamsPage(): React.JSX.Element {
  const [teams, setTeams] = useState<OrganizationTeam[]>([]);
  const [departments, setDepartments] = useState<OrganizationDepartment[]>([]);
  const [chart, setChart] = useState<OrganizationChart | null>(null);
  const [form, setForm] = useState(blank);
  const [editing, setEditing] = useState<OrganizationTeam | null>(null);
  const [memberTeam, setMemberTeam] = useState('');
  const [memberUser, setMemberUser] = useState('');
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [message, setMessage] = useState('');
  async function load() {
    setLoading(true);
    try {
      const [nextTeams, nextDepartments, nextChart] = await Promise.all([
        organizationApi.teams(),
        organizationApi.departments(),
        organizationApi.chart(),
      ]);
      setTeams(nextTeams);
      setDepartments(nextDepartments);
      setChart(nextChart);
      setError(null);
    } catch (cause) {
      setError(cause);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  function startCreate() {
    setEditing(null);
    setForm(blank);
    setOpen(true);
  }
  function startEdit(item: OrganizationTeam) {
    setEditing(item);
    setForm({
      departmentId: item.departmentId,
      kind: item.kind,
      name: item.name,
      leadUserId: item.leadUserId ?? '',
      parentTeamId: item.parentTeamId ?? '',
      sharedVisibility: item.sharedVisibility ?? false,
    });
    setOpen(true);
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = {
        departmentId: form.departmentId,
        kind: form.kind,
        name: form.name,
        leadUserId: form.leadUserId || null,
        parentTeamId: form.parentTeamId || null,
        sharedVisibility: form.sharedVisibility,
      };
      if (editing) await organizationApi.updateTeam(editing.id, body);
      else await organizationApi.createTeam(body);
      setOpen(false);
      setMessage('Team saved.');
      await load();
    } catch (cause) {
      setError(cause);
    } finally {
      setBusy(false);
    }
  }
  async function moveMember(event: React.FormEvent) {
    event.preventDefault();
    if (!memberTeam || !memberUser) return;
    setBusy(true);
    setError(null);
    try {
      await organizationApi.addTeamMember(memberTeam, memberUser);
      setMessage(
        'Employee moved. Visibility will follow the new team on the next request.',
      );
      await load();
    } catch (cause) {
      setError(cause);
    } finally {
      setBusy(false);
    }
  }
  const departmentName = (id: string) =>
    departments.find((item) => item.id === id)?.name ?? id;
  const eligibleParentTeams = teams.filter(
    (team) =>
      team.departmentId === form.departmentId &&
      (form.kind !== 'sales-pool' || team.kind === 'sales-team') &&
      team.id !== editing?.id,
  );
  const eligibleLeads = (chart?.people ?? []).filter(
    (person) => person.departmentId === form.departmentId,
  );
  const selectedEmployee = (chart?.people ?? []).find((person) => person.id === memberUser);
  const eligibleDestinationTeams = teams.filter(
    (team) => selectedEmployee !== undefined && team.status === 'active' && team.departmentId === selectedEmployee.departmentId && team.id !== selectedEmployee.teamId,
  );
  const currentTeamName = selectedEmployee?.teamId
    ? teams.find((team) => team.id === selectedEmployee.teamId)?.name ?? selectedEmployee.teamName ?? selectedEmployee.teamId
    : null;
  return (
    <WorkspacePageContainer>
      {message && (
        <div className="mb-5">
          <Notice>{message}</Notice>
        </div>
      )}
      {Boolean(error) && (
        <div className="mb-5">
          <ErrorMessage cause={error} />
        </div>
      )}
      <div className="space-y-5">
        <Card className="overflow-hidden p-0">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-b-[color:var(--app-border)] px-5 py-5 sm:px-6">
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-app-accent/10 text-app-accent">
                <Icon name="users" className="size-5" />
              </span>
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-app-muted">
                  Organization
                </p>
                <p className="mt-0.5 text-base font-bold text-app-foreground">Team directory</p>
                <p className="mt-0.5 text-xs text-app-muted">
                  {loading ? 'Loading teams…' : `${teams.length} team${teams.length === 1 ? '' : 's'} in your organization`}
                </p>
              </div>
            </div>
            <Button onClick={startCreate}>
              <span aria-hidden="true">+</span> Add team
            </Button>
          </div>
          {loading ? (
            <div className="p-5">
              <SkeletonTable columns={4} rows={5} />
            </div>
          ) : teams.length === 0 ? (
            <div className="p-8 text-center">
              <p className="text-sm text-app-muted">No teams are visible to this account.</p>
            </div>
          ) : (
            <div className="divide-y divide-app-border">
              {teams.map((team) => (
                <div
                  key={team.id}
                  className="flex flex-wrap items-center justify-between gap-4 p-5"
                >
                  <div>
                    <p className="font-semibold">{team.name}</p>
                    <p className="mt-1 text-xs text-app-muted">
                      {team.kind} · {departmentName(team.departmentId)}
                    </p>
                  </div>
                  <Button kind="secondary" onClick={() => startEdit(team)}>
                    Edit
                  </Button>
                </div>
              ))}
            </div>
          )}
        </Card>

        {!loading && (
          <Card className="overflow-hidden p-0">
            <div className="flex flex-wrap items-center gap-3 border-b border-b-[color:var(--app-border)] px-5 py-4 sm:px-6">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-app-accent/10 text-app-accent">
                <Icon name="users" className="size-4" />
              </span>
              <div>
                <h2 className="text-sm font-bold text-app-foreground">Move an employee</h2>
                <p className="mt-0.5 text-xs text-app-muted">
                  Move active employees only within their department.
                </p>
              </div>
            </div>
            <form
              onSubmit={(event) => {
                void moveMember(event);
              }}
              className="grid gap-3 p-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] md:items-end sm:p-6"
            >
              <Select
                label="Employee"
                value={memberUser}
                onChange={(value) => {
                  setMemberUser(value);
                  const employee = (chart?.people ?? []).find((person) => person.id === value);
                  if (!employee || !teams.some((team) =>
                    team.id === memberTeam && team.departmentId === employee.departmentId,
                  )) setMemberTeam('');
                }}
                options={(chart?.people ?? []).map((person) => ({
                  value: person.id,
                  label: `${person.fullName} · ${person.teamId ? (teams.find((team) => team.id === person.teamId)?.name ?? person.teamName ?? 'Current team') : 'Unassigned'}`,
                }))}
                required
              />
              <Select
                label="Destination team"
                value={memberTeam}
                onChange={setMemberTeam}
                options={eligibleDestinationTeams.map((team) => ({
                  value: team.id,
                  label: `${team.name} · ${departmentName(team.departmentId)}`,
                }))}
                required
              />
              <Button type="submit" disabled={busy} className="w-full md:w-auto">
                {selectedEmployee?.teamId ? 'Move employee' : 'Assign employee'}
              </Button>
              {selectedEmployee && <p className="text-xs text-app-muted md:col-span-3">
                Current team: <span className="font-semibold text-app-foreground">{currentTeamName ?? 'Unassigned'}</span>
              </p>}
              {memberUser && eligibleDestinationTeams.length === 0 && (
                <p className="text-xs text-app-muted md:col-span-3">
                  No teams are available in this employee&apos;s department.
                </p>
              )}
            </form>
          </Card>
        )}
      </div>
      {open && (
        <Modal
          title={editing ? 'Edit team' : 'Create team'}
          onClose={() => setOpen(false)}
        >
          <form
            onSubmit={(event) => {
              void submit(event);
            }}
            className="grid gap-4"
          >
            <Select
              label="Department"
              value={form.departmentId}
              onChange={(value) =>
                setForm({ ...form, departmentId: value, parentTeamId: '' })
              }
              options={departments.map((item) => ({ value: item.id, label: item.name }))}
              required
            />
            <Select
              label="Team type / kind"
              value={form.kind}
              onChange={(value) => setForm({ ...form, kind: value, parentTeamId: '' })}
              options={TEAM_KINDS}
              required
            />
            <Field
              label="Name"
              value={form.name}
              onChange={(value) => setForm({ ...form, name: value })}
              required
            />
            <Select
              label="Team lead (optional during bootstrap)"
              value={form.leadUserId}
              onChange={(value) => setForm({ ...form, leadUserId: value })}
              options={eligibleLeads.map((person) => ({ value: person.id, label: person.fullName }))}
            />
            {eligibleLeads.length === 0 && (
              <p className="text-xs text-app-muted">
                No employees are available in this department yet. You can save
                the team without a lead and assign one later.
              </p>
            )}
            <Select
              label="Parent team (optional for a root team)"
              value={form.parentTeamId}
              onChange={(value) => setForm({ ...form, parentTeamId: value })}
              options={eligibleParentTeams.map((team) => ({ value: team.id, label: team.name }))}
            />
            {form.kind !== 'sales-pool' && eligibleParentTeams.length === 0 && (
              <p className="text-xs text-app-muted">
                No parent teams are available — this will be a root team.
              </p>
            )}
            <Button type="submit" disabled={busy}>
              {busy ? 'Saving…' : 'Save team'}
            </Button>
          </form>
        </Modal>
      )}
    </WorkspacePageContainer>
  );
}
