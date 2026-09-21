import { useEffect, useState } from 'react';
import { createEmployee } from '../api/employeesApi.js';
import {
  getCompanyDepartments,
  getCompanyDesignations,
  getCompanyEmployees,
  getCompanyLadder,
  getCompanyPositionPolicies,
  getCompanyTeams,
  type CompanyDepartment,
  type CompanyDesignation,
  getCompanyReportingManagers,
  type CompanyEmployee,
  type CompanyLadder,
  type CompanyLadderPosition,
  type CompanyReportingManager,
  type CompanyTeam,
} from '../api/companyApi.js';

const blank = {
  fullName: '',
  email: '',
  password: '',
  confirmPassword: '',
  departmentId: '',
  positionId: '',
  teamId: '',
  designationId: '',
  specialization: '',
  reportsTo: '',
};

export function EmployeesPage(): React.JSX.Element {
  const [employees, setEmployees] = useState<CompanyEmployee[]>([]);
  const [departments, setDepartments] = useState<CompanyDepartment[]>([]);
  const [teams, setTeams] = useState<CompanyTeam[]>([]);
  const [designations, setDesignations] = useState<CompanyDesignation[]>([]);
  const [reportingManagers, setReportingManagers] = useState<CompanyReportingManager[]>(
    [],
  );
  const [ladder, setLadder] = useState<CompanyLadder | null>(null);
  const [accessPreview, setAccessPreview] = useState<
    Awaited<ReturnType<typeof getCompanyPositionPolicies>>
  >([]);
  const [form, setForm] = useState(blank);
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function load(): Promise<void> {
    setLoading(true);
    try {
      const [nextEmployees, nextDepartments, nextTeams, nextDesignations] =
        await Promise.all([
          getCompanyEmployees(),
          getCompanyDepartments(),
          getCompanyTeams(),
          getCompanyDesignations(),
        ]);
      setEmployees(nextEmployees);
      setDepartments(nextDepartments.filter((item) => item.status === 'active'));
      setTeams(nextTeams);
      setDesignations(nextDesignations.filter((item) => item.status === 'active'));
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load employees.');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  useEffect(() => {
    const department = departments.find((item) => item.id === form.departmentId);
    if (!department) {
      setLadder(null);
      return;
    }
    void getCompanyLadder(department.code)
      .then(setLadder)
      .catch(() => setError('Unable to load positions for this department.'));
  }, [form.departmentId, departments]);

  useEffect(() => {
    if (!form.departmentId || !form.positionId) {
      setReportingManagers([]);
      return;
    }
    void getCompanyReportingManagers(
      form.departmentId,
      form.positionId,
      undefined,
      form.teamId || undefined,
    )
      .then(setReportingManagers)
      .catch(() => setError('Unable to load reporting managers.'));
  }, [form.departmentId, form.positionId, form.teamId]);

  const departmentTeams = teams.filter((team) => team.departmentId === form.departmentId);
  const designation = designations.find((item) => item.id === form.designationId);
  const visible = employees.filter((employee) =>
    employee.fullName.toLowerCase().includes(search.toLowerCase()),
  );
  const positionOptions = flattenPositions(ladder?.positions ?? []);
  function setDepartment(departmentId: string): void {
    setForm({ ...form, departmentId, positionId: '', teamId: '', reportsTo: '' });
    setLadder(null);
  }
  useEffect(() => {
    if (!form.positionId) {
      setAccessPreview([]);
      return;
    }
    void getCompanyPositionPolicies(form.positionId)
      .then(setAccessPreview)
      .catch(() => setError('Unable to load position access preview.'));
  }, [form.positionId]);

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const result = await createEmployee({
        fullName: form.fullName,
        email: form.email,
        password: form.password,
        confirmPassword: form.confirmPassword,
        departmentId: form.departmentId,
        positionId: form.positionId,
        ...(form.teamId ? { teamId: form.teamId } : {}),
        ...(form.designationId ? { designationId: form.designationId } : {}),
        ...(form.specialization ? { specialization: form.specialization } : {}),
        reportsTo: form.reportsTo || null,
      });
      setMessage(
        `Employee ${result.employee.fullName} created. Credentials were sent by email.`,
      );
      setForm(blank);
      setShowCreate(false);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to create employee.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="p-5 md:p-8">
      <div className="mx-auto max-w-7xl">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-app-accent">
              People
            </p>
            <h1 className="mt-2 font-display text-3xl font-bold tracking-[-0.05em]">
              Employees
            </h1>
            <p className="mt-2 text-sm text-app-muted">
              Manage employee accounts in your organization.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowCreate((open) => !open)}
            className="rounded-lg bg-app-accent px-4 py-2.5 text-sm font-bold text-[#061412]"
          >
            {showCreate ? 'Close form' : 'Create employee'}
          </button>
        </div>
        {message && (
          <p className="mt-5 rounded-xl border border-app-accent/30 bg-app-accent/10 p-4 text-sm text-app-accent">
            {message}
          </p>
        )}
        {error && (
          <p className="mt-5 rounded-xl border border-[#d86b6b]/30 bg-[#d86b6b]/10 p-4 text-sm text-[#d86b6b]">
            {error}
          </p>
        )}
        {showCreate && (
          <form
            onSubmit={(event) => {
              void submit(event);
            }}
            className="mt-6 grid gap-4 rounded-2xl border border-app-border bg-app-surface p-6 md:grid-cols-2"
          >
            <Field
              label="Full name"
              value={form.fullName}
              onChange={(value) => setForm({ ...form, fullName: value })}
              required
            />
            <Field
              label="Email"
              type="email"
              value={form.email}
              onChange={(value) => setForm({ ...form, email: value })}
              required
            />
            <Field
              label="Password"
              type="password"
              value={form.password}
              onChange={(value) => setForm({ ...form, password: value })}
              required
            />
            <Field
              label="Confirm password"
              type="password"
              value={form.confirmPassword}
              onChange={(value) => setForm({ ...form, confirmPassword: value })}
              required
            />
            <Select
              label="Department"
              value={form.departmentId}
              onChange={setDepartment}
              options={departments.map((item) => ({ value: item.id, label: item.name }))}
              required
            />
            <Select
              label="Position"
              value={form.positionId}
              onChange={(value) => setForm({ ...form, positionId: value })}
              options={positionOptions}
              required
            />
            <Select
              label="Team (optional)"
              value={form.teamId}
              onChange={(value) => setForm({ ...form, teamId: value })}
              options={departmentTeams.map((item) => ({
                value: item.id,
                label: item.name,
              }))}
            />
            <Select
              label="Designation (optional)"
              value={form.designationId}
              onChange={(value) =>
                setForm({ ...form, designationId: value, specialization: '' })
              }
              options={designations.map((item) => ({ value: item.id, label: item.name }))}
            />
            {designation && (
              <Select
                label="Specialization (optional)"
                value={form.specialization}
                onChange={(value) => setForm({ ...form, specialization: value })}
                options={designation.specializations.map((item) => ({
                  value: item,
                  label: item,
                }))}
              />
            )}
            <Select
              label="Reporting manager (optional)"
              value={form.reportsTo}
              onChange={(value) => setForm({ ...form, reportsTo: value })}
              options={reportingManagers.map((item) => ({
                value: item.id,
                label:
                  item.accountType === 'super-admin'
                    ? `${item.fullName} (Company Super Admin)`
                    : item.fullName,
              }))}
            />
            {form.positionId && (
              <section className="rounded-xl border border-app-border bg-app-background p-4 md:col-span-2">
                <p className="text-sm font-semibold">Access preview</p>
                <p className="mt-1 text-xs text-app-muted">
                  Derived from this position&apos;s current policies. This preview does
                  not grant or save access.
                </p>
                {accessPreview.length === 0 ? (
                  <p className="mt-3 text-xs text-app-muted">
                    No position policies are currently configured.
                  </p>
                ) : (
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    {accessPreview.map((policy) => (
                      <div
                        key={policy.action}
                        className="rounded-lg border border-app-border px-3 py-2 text-xs"
                      >
                        <span className="font-semibold">{policy.action}</span>
                        <span className="ml-2 text-app-muted">
                          {policy.allowed ? policy.scope : 'Denied'}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            )}
            <button
              type="submit"
              disabled={busy}
              className="rounded-lg bg-app-accent px-4 py-2.5 text-sm font-bold text-[#061412] disabled:opacity-50 md:col-span-2"
            >
              {busy ? 'Creating...' : 'Create employee and send credentials'}
            </button>
          </form>
        )}
        {loading ? (
          <div className="mt-6 h-56 animate-pulse rounded-2xl border border-app-border bg-app-surface" />
        ) : visible.length === 0 ? (
          <div className="mt-6 rounded-2xl border border-app-border bg-app-surface p-8 text-center">
            <h2 className="font-display text-xl font-bold">No employees found</h2>
            <p className="mt-2 text-sm text-app-muted">
              Try another search or create an employee account.
            </p>
          </div>
        ) : (
          <section className="mt-6 overflow-hidden rounded-2xl border border-app-border bg-app-surface">
            <div className="border-b border-app-border p-4">
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search employees"
                className="w-full rounded-lg border border-app-border bg-app-background px-3 py-2.5 text-sm outline-none focus:border-app-accent"
                aria-label="Search employees"
              />
            </div>
            <div className="divide-y divide-app-border">
              {visible.map((employee) => (
                <div
                  key={employee.id}
                  className="grid gap-3 px-5 py-4 md:grid-cols-[1.3fr_1fr_1fr_1fr_1fr] md:items-center"
                >
                  <div>
                    <p className="font-semibold">{employee.fullName}</p>
                    <p className="text-xs text-app-muted">
                      {employee.email ?? 'Employee account'}
                    </p>
                  </div>
                  <Detail label="Department" value={employee.departmentName} />
                  <Detail
                    label="Position"
                    value={
                      employee.positionName
                        ? `${employee.positionName}${employee.positionCode ? ` (${employee.positionCode})` : ''}`
                        : null
                    }
                  />
                  <Detail label="Team" value={employee.teamName} />
                  <Detail label="Designation" value={employee.designationName} />
                  <div className="text-xs text-app-muted md:col-span-5">
                    <span className="font-semibold text-app-foreground">
                      Specialization:
                    </span>{' '}
                    {employee.specialization ?? '—'} ·{' '}
                    <span className="font-semibold text-app-foreground">
                      Reporting Manager:
                    </span>{' '}
                    {employee.reportsToName ?? '—'}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = 'text',
  required = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  required?: boolean;
}): React.JSX.Element {
  return (
    <label className="text-xs font-semibold text-app-muted">
      <span className="mb-2 block">{label}</span>
      <input
        required={required}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-lg border border-app-border bg-app-background px-3 py-2.5 text-sm text-app-foreground outline-none focus:border-app-accent"
      />
    </label>
  );
}
function Select({
  label,
  value,
  onChange,
  options,
  required = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  required?: boolean;
}): React.JSX.Element {
  return (
    <label className="text-xs font-semibold text-app-muted">
      <span className="mb-2 block">{label}</span>
      <select
        required={required}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-lg border border-app-border bg-app-background px-3 py-2.5 text-sm text-app-foreground outline-none focus:border-app-accent"
      >
        <option value="">Select {label.toLowerCase()}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
function Detail({
  label,
  value,
}: {
  label: string;
  value?: string | null | undefined;
}): React.JSX.Element {
  return (
    <p className="text-xs text-app-muted">
      <span className="block font-semibold text-app-foreground">{label}</span>
      {value ?? '—'}
    </p>
  );
}
function flattenPositions(
  positions: CompanyLadderPosition[],
  depth = 0,
): Array<{ value: string; label: string }> {
  return positions.flatMap((position) => [
    {
      value: position.id,
      label: `${'— '.repeat(depth)}${position.name} (${position.code})`,
    },
    ...flattenPositions(position.children ?? [], depth + 1),
  ]);
}
