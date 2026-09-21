import { useEffect, useState } from 'react';
import { organizationApi } from '../api/organizationApi.js';
import {
  Button,
  Card,
  Empty,
  ErrorMessage,
  Field,
  Loading,
  Modal,
  Notice,
  Page,
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
    (team) => selectedEmployee !== undefined && team.departmentId === selectedEmployee.departmentId,
  );
  return (
    <Page
      eyebrow="Organization"
      title="Teams"
      description="Manage teams and move active employees only within their department."
      action={<Button onClick={startCreate}>Add team</Button>}
    >
      {message && (
        <div className="mt-5">
          <Notice>{message}</Notice>
        </div>
      )}
      {Boolean(error) && (
        <div className="mt-5">
          <ErrorMessage cause={error} />
        </div>
      )}
      {loading ? (
        <Loading />
      ) : (
        <>
          <Card className="mt-6">
            <h2 className="font-display text-xl font-bold">Move an employee</h2>
            <p className="mt-1 text-sm text-app-muted">
              The backend verifies department consistency and records the movement.
            </p>
            <form
              onSubmit={(event) => {
                void moveMember(event);
              }}
              className="mt-4 grid gap-4 md:grid-cols-3"
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
                  label: person.fullName,
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
              {memberUser && eligibleDestinationTeams.length === 0 && (
                <p className="text-xs text-app-muted md:col-span-3">
                  No teams are available in this employee&apos;s department.
                </p>
              )}
              <Button type="submit" disabled={busy}>
                Move employee
              </Button>
            </form>
          </Card>
          {teams.length === 0 ? (
            <Empty>No teams are visible to this account.</Empty>
          ) : (
            <Card className="mt-6 overflow-hidden p-0">
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
            </Card>
          )}
        </>
      )}
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
    </Page>
  );
}
