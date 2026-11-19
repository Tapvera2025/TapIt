import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon, WorkspacePageContainer } from '../../ui/index.js';
import { organizationApi } from '../api/organizationApi.js';
import {
  Button,
  Card,
  ErrorMessage,
  Modal,
  Notice,
  Select,
  SkeletonPage,
} from '../components/OrganizationUi.js';
import type {
  OrganizationChart,
  OrganizationDepartment,
  OrganizationDesignation,
  OrganizationEmployee,
  OrganizationTeam,
  ReportingManagerCandidate,
  ReportingPreview,
} from '../types/index.js';

type OverviewData = {
  departments: OrganizationDepartment[];
  teams: OrganizationTeam[];
  designations: OrganizationDesignation[];
  chart: OrganizationChart;
};

type DepartmentStatusFilter = 'all' | 'active' | 'inactive';

const normalizedStatus = (value: string): string => value.trim().toLowerCase();

function isMissingManager(employee: OrganizationEmployee): boolean {
  return employee.missingManager ?? (!employee.reportsTo && !employee.effectiveManagerId);
}

function departmentLead(
  department: OrganizationDepartment,
  data: OverviewData,
): string | null {
  const departmentChart = data.chart.departments.find((item) => item.id === department.id);
  const headPositions = new Set(
    (departmentChart?.headPositionNames ?? []).map((name) => name.trim().toLowerCase()),
  );
  const departmentPeople = data.chart.people.filter((person) => person.departmentId === department.id);
  const head = departmentPeople.find((person) =>
    person.positionName ? headPositions.has(person.positionName.trim().toLowerCase()) : false,
  );
  if (head) return head.fullName;

  const teamLeadIds = new Set(
    data.teams
      .filter((team) => team.departmentId === department.id && team.leadUserId)
      .map((team) => team.leadUserId),
  );
  return data.chart.people.find((person) => teamLeadIds.has(person.id))?.fullName ?? null;
}

export function OrganizationOverview({
  onNavigate,
}: {
  onNavigate: (path: string) => void;
}): React.JSX.Element {
  const [data, setData] = useState<OverviewData | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [departmentQuery, setDepartmentQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<DepartmentStatusFilter>('all');
  const [message, setMessage] = useState('');
  const [assigningEmployee, setAssigningEmployee] = useState<OrganizationEmployee | null>(null);
  const [managerCandidates, setManagerCandidates] = useState<ReportingManagerCandidate[]>([]);
  const [managerId, setManagerId] = useState('');
  const [managerPreview, setManagerPreview] = useState<ReportingPreview | null>(null);
  const [managerLoading, setManagerLoading] = useState(false);
  const [managerBusy, setManagerBusy] = useState(false);
  const [managerError, setManagerError] = useState('');
  const candidateRequest = useRef(0);

  useEffect(() => {
    let current = true;
    setError(null);
    void Promise.all([
      organizationApi.departments(),
      organizationApi.teams(),
      organizationApi.designations(),
      organizationApi.chart(),
    ])
      .then(([departments, teams, designations, chart]) => {
        if (current) setData({ departments, teams, designations, chart });
      })
      .catch((cause: unknown) => {
        if (current) setError(cause);
      });
    return () => {
      current = false;
    };
  }, [refreshKey]);

  const derived = useMemo(() => {
    if (!data) return null;
    const activeDepartments = data.departments.filter(
      (department) => normalizedStatus(department.status) === 'active',
    );
    const inactiveDepartments = data.departments.filter(
      (department) => normalizedStatus(department.status) !== 'active',
    );
    const activeDesignations = data.designations.filter(
      (designation) => normalizedStatus(designation.status) === 'active',
    );
    const assignedDesignationNames = new Set(
      data.chart.people
        .map((person) => person.designationName?.trim().toLowerCase())
        .filter((name): name is string => Boolean(name)),
    );
    const activeDepartmentIds = new Set(activeDepartments.map((department) => department.id));
    const teamsInActiveDepartments = new Set(
      data.teams
        .filter((team) => activeDepartmentIds.has(team.departmentId))
        .map((team) => team.departmentId),
    ).size;
    const missingManagers = data.chart.people.filter(isMissingManager);
    const peopleVisibleDepartments = data.chart.departments.filter((department) => department.peopleVisible);
    const structureOnlyDepartments = data.chart.departments.filter((department) => department.structureOnly);
    const departmentStats = new Map(data.departments.map((department) => [department.id, {
      members: data.chart.people.filter((person) => person.departmentId === department.id).length,
      lead: departmentLead(department, data),
    }]));
    const query = departmentQuery.trim().toLowerCase();
    const filteredDepartments = data.departments.filter((department) => {
      const statusMatches = statusFilter === 'all' || normalizedStatus(department.status) === statusFilter;
      const stats = departmentStats.get(department.id);
      const queryMatches = !query || [department.name, department.code, department.kind, stats?.lead ?? '']
        .some((value) => value.toLowerCase().includes(query));
      return statusMatches && queryMatches;
    });
    const activeAssignedDesignations = activeDesignations.filter((designation) =>
      assignedDesignationNames.has(designation.name.trim().toLowerCase()),
    ).length;
    return {
      activeDepartments,
      inactiveDepartments,
      activeDesignations,
      activeAssignedDesignations,
      teamsInActiveDepartments,
      missingManagers,
      peopleVisibleDepartments,
      structureOnlyDepartments,
      departmentStats,
      filteredDepartments,
    };
  }, [data, departmentQuery, statusFilter]);

  async function openManagerAssignment(employee: OrganizationEmployee): Promise<void> {
    const requestId = ++candidateRequest.current;
    setAssigningEmployee(employee);
    setManagerId('');
    setManagerCandidates([]);
    setManagerPreview(null);
    setManagerError('');
    setManagerLoading(false);
    setManagerBusy(false);
    if (!employee.departmentId || !employee.positionId) {
      setManagerError('Add this employee’s department and position before selecting an eligible manager.');
      return;
    }
    setManagerLoading(true);
    try {
      const candidates = await organizationApi.reportingManagers(
        employee.departmentId,
        employee.positionId,
        employee.id,
        employee.teamId ?? undefined,
      );
      if (requestId === candidateRequest.current) setManagerCandidates(candidates);
    } catch (cause) {
      if (requestId === candidateRequest.current) {
        setManagerError(cause instanceof Error ? cause.message : 'Unable to load eligible managers.');
      }
    } finally {
      if (requestId === candidateRequest.current) setManagerLoading(false);
    }
  }

  function closeManagerAssignment(): void {
    candidateRequest.current += 1;
    setAssigningEmployee(null);
    setManagerPreview(null);
    setManagerError('');
    setManagerLoading(false);
    setManagerBusy(false);
  }

  async function previewManagerAssignment(): Promise<void> {
    if (!assigningEmployee || !managerId) {
      setManagerError('Select a manager to review the assignment.');
      return;
    }
    const requestId = candidateRequest.current;
    setManagerBusy(true);
    setManagerError('');
    try {
      const preview = await organizationApi.previewManagerReassignment(
        assigningEmployee.id,
        managerId,
        'individual',
      );
      if (requestId === candidateRequest.current) setManagerPreview(preview);
    } catch (cause) {
      if (requestId === candidateRequest.current) {
        setManagerError(cause instanceof Error ? cause.message : 'Unable to review this assignment.');
      }
    } finally {
      if (requestId === candidateRequest.current) setManagerBusy(false);
    }
  }

  async function confirmManagerAssignment(): Promise<void> {
    if (!assigningEmployee || !managerId) return;
    const requestId = candidateRequest.current;
    const employee = assigningEmployee;
    const selectedManagerId = managerId;
    setManagerBusy(true);
    setManagerError('');
    try {
      await organizationApi.reassignManager(employee.id, selectedManagerId);
      setMessage(`Reporting manager assigned to ${employee.fullName}.`);
      setRefreshKey((current) => current + 1);
      if (requestId === candidateRequest.current) closeManagerAssignment();
    } catch (cause) {
      if (requestId === candidateRequest.current) {
        setManagerError(cause instanceof Error ? cause.message : 'Unable to assign this manager.');
      }
    } finally {
      if (requestId === candidateRequest.current) setManagerBusy(false);
    }
  }

  return (
    <WorkspacePageContainer className="pb-6 sm:pb-0">
      {message && <div className="mb-4"><Notice>{message}</Notice></div>}
      {Boolean(error) && <div className="mb-4"><ErrorMessage cause={error} /></div>}
      {!data && !error && <SkeletonPage cards={4} rows={4} />}
      {data && derived && (
        <>
          <section aria-label="Organization summary" className="overflow-hidden rounded-2xl border border-app-border bg-app-surface shadow-sm">
            <div className="grid grid-cols-2">
              <SummaryMetric
                label="Departments"
                value={data.departments.length}
                detail={<><span className="text-emerald-600 dark:text-emerald-400">{derived.activeDepartments.length} active</span><span className="px-1.5 text-app-muted">·</span><span>{derived.inactiveDepartments.length} inactive</span></>}
                onClick={() => onNavigate('/company/organization/departments')}
                cellClassName="border-b border-r border-app-border"
              />
              <SummaryMetric
                label="Teams"
                value={data.teams.length}
                detail={<>Across {derived.teamsInActiveDepartments} active {derived.teamsInActiveDepartments === 1 ? 'department' : 'departments'}</>}
                onClick={() => onNavigate('/company/organization/teams')}
                cellClassName="border-b border-app-border"
              />
              <SummaryMetric
                label="Designations"
                value={data.designations.length}
                detail={<><span>{derived.activeDesignations.length} active</span><span className="px-1.5 text-app-muted">·</span><span>{derived.activeAssignedDesignations} assigned</span></>}
                onClick={() => onNavigate('/company/organization/designations')}
                cellClassName="border-r border-app-border"
              />
              <SummaryMetric
                label="Visible employees"
                value={data.chart.people.length}
                detail={<span>{derived.peopleVisibleDepartments.length} people-visible {derived.peopleVisibleDepartments.length === 1 ? 'department' : 'departments'}</span>}
                onClick={() => onNavigate('/company/organization/org-chart')}
                cellClassName=""
              />
            </div>
          </section>

          <div className="mt-5 grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1.25fr)_minmax(300px,0.9fr)]">
            <Card className="!p-0 min-w-0 overflow-hidden">
              <div className="flex flex-col gap-3 border-b border-app-border px-4 py-4 sm:px-5 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex items-center gap-2">
                  <h2 className="font-display text-base font-bold text-app-foreground">Structure</h2>
                  <span className="rounded-md border border-app-border bg-app-surface-raised px-1.5 py-0.5 text-xs font-semibold text-app-muted">{data.departments.length}</span>
                </div>
                <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
                  <label className="relative min-w-0 flex-1 sm:w-44 sm:flex-none lg:w-48">
                    <span className="sr-only">Filter departments</span>
                    <Icon name="search" className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-app-muted" />
                    <input
                      type="search"
                      value={departmentQuery}
                      onChange={(event) => setDepartmentQuery(event.target.value)}
                      placeholder="Filter departments..."
                      className="ui-form-control h-9 w-full pl-8 pr-3 text-xs"
                    />
                  </label>
                  <div role="group" aria-label="Filter department status" className="inline-flex w-fit items-center rounded-lg border border-app-border bg-app-surface-raised p-0.5">
                    {(['all', 'active', 'inactive'] as const).map((status) => (
                      <button
                        key={status}
                        type="button"
                        aria-pressed={statusFilter === status}
                        onClick={() => setStatusFilter(status)}
                        className={`rounded-md px-2 py-1 text-[11px] font-medium capitalize transition-colors ${statusFilter === status ? 'bg-app-surface text-app-foreground shadow-sm' : 'text-app-muted hover:text-app-foreground'}`}
                      >
                        {status === 'all' ? 'All' : status}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="hidden grid-cols-[minmax(0,1.45fr)_minmax(0,1.05fr)_72px_84px_20px] gap-3 border-b border-app-border bg-app-surface-raised/60 px-4 py-2.5 text-[10px] font-bold uppercase tracking-[0.08em] text-app-muted sm:grid sm:px-5">
                <span>Department / code</span><span>Head / lead</span><span className="text-center">Members</span><span>Status</span><span />
              </div>
              <div className="divide-y divide-app-border">
                {derived.filteredDepartments.map((department) => {
                  const stats = derived.departmentStats.get(department.id);
                  const active = normalizedStatus(department.status) === 'active';
                  return (
                    <button
                      key={department.id}
                      type="button"
                      onClick={() => onNavigate('/company/organization/departments')}
                      className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 px-4 py-3 text-left transition-colors hover:bg-app-accent/[0.045] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-app-accent sm:grid-cols-[minmax(0,1.45fr)_minmax(0,1.05fr)_72px_84px_20px] sm:gap-3 sm:px-5"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-[13px] font-semibold text-app-foreground">{department.name}</span>
                        <span className="mt-0.5 block truncate text-[11px] text-app-muted">{department.code} · {department.kind.replaceAll('-', ' ')}</span>
                      </span>
                      <span className="hidden truncate text-xs text-app-foreground sm:block">{stats?.lead ?? <span className="italic text-app-muted">Unassigned</span>}</span>
                      <span className="hidden text-center text-xs tabular-nums text-app-foreground sm:block">{stats?.members ?? 0}</span>
                      <span className={`inline-flex justify-self-end items-center gap-1.5 rounded-full border px-2 py-1 text-[10px] font-semibold sm:justify-self-start ${active ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/25 dark:text-emerald-300' : 'border-slate-200 bg-slate-100 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'}`}>
                        <span className={`size-1.5 rounded-full ${active ? 'bg-emerald-500' : 'bg-slate-400'}`} />
                        {active ? 'Active' : 'Inactive'}
                      </span>
                      <span className="col-span-2 min-w-0 truncate text-[11px] text-app-muted sm:hidden">
                        Lead: <span className={stats?.lead ? 'font-medium text-app-foreground' : 'italic'}>{stats?.lead ?? 'Unassigned'}</span>
                        <span className="px-1.5">·</span>{stats?.members ?? 0} {stats?.members === 1 ? 'member' : 'members'}
                      </span>
                      <Icon name="chevron-right" className="hidden size-4 text-app-muted sm:block" />
                    </button>
                  );
                })}
                {derived.filteredDepartments.length === 0 && (
                  <div className="px-5 py-10 text-center">
                    <p className="text-sm font-medium text-app-foreground">No departments match</p>
                    <p className="mt-1 text-xs text-app-muted">Try a different name, code, or status.</p>
                  </div>
                )}
              </div>
              <div className="border-t border-app-border px-4 py-2.5 text-[11px] text-app-muted sm:px-5">
                Showing {derived.filteredDepartments.length} of {data.departments.length} departments
              </div>
            </Card>

            <Card className="!p-0 min-w-0 overflow-hidden">
              <div className="flex items-start justify-between gap-3 border-b border-app-border px-4 py-4 sm:px-5">
                <div className="min-w-0">
                  <h2 className="font-display text-base font-bold text-app-foreground">People signals</h2>
                  <p className="mt-1 text-xs text-app-muted">Directory hygiene and structural coverage checks</p>
                </div>
                <span className={`shrink-0 rounded-md border px-2 py-1 text-[10px] font-semibold ${derived.missingManagers.length ? 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300' : 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/25 dark:text-emerald-300'}`}>
                  {derived.missingManagers.length} {derived.missingManagers.length === 1 ? 'action item' : 'action items'}
                </span>
              </div>

              {derived.missingManagers.length > 0 && (
                <section className="border-b border-app-border p-4 sm:px-5">
                  <div className="mb-2 flex items-center justify-between gap-3 text-[10px] font-bold uppercase tracking-[0.08em] text-amber-800 dark:text-amber-300">
                    <span>Attention needed</span><span>Governance</span>
                  </div>
                  <div className="space-y-2">
                    {derived.missingManagers.map((employee) => (
                      <div key={employee.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-300/80 bg-amber-50/50 p-3 dark:border-amber-900 dark:bg-amber-950/15">
                        <div className="flex min-w-0 flex-1 items-start gap-2">
                          <span className="mt-1.5 size-2 shrink-0 rounded-full bg-amber-500" />
                          <div className="min-w-0">
                            <p className="text-xs font-semibold text-app-foreground">Employees without manager</p>
                            <p className="mt-0.5 truncate text-[11px] text-app-muted">{employee.fullName}{employee.departmentName ? ` (${employee.departmentName})` : ''} lacks a direct reporting line</p>
                          </div>
                        </div>
                        <Button className="shrink-0 px-3 py-1.5 text-[11px]" onClick={() => void openManagerAssignment(employee)}>
                          Assign <span aria-hidden="true">→</span>
                        </Button>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              <div className="divide-y divide-app-border">
                <SignalRow
                  icon="building"
                  label="Structure-only departments"
                  description="Units hidden from the employee directory"
                  value={derived.structureOnlyDepartments.length}
                  badge={derived.structureOnlyDepartments.length === 0 ? 'Clean' : 'Review'}
                  badgeTone={derived.structureOnlyDepartments.length === 0 ? 'good' : 'neutral'}
                  onClick={() => onNavigate('/company/organization/departments')}
                />
                <SignalRow
                  icon="users"
                  label="People-visible departments"
                  description="Departments included in the employee directory"
                  value={derived.peopleVisibleDepartments.length}
                  total={data.chart.departments.length}
                  badge="View"
                  badgeTone="good"
                  onClick={() => onNavigate('/company/organization/org-chart')}
                />
                <SignalRow
                  icon="briefcase"
                  label="Active designations"
                  description={`${derived.activeAssignedDesignations} currently assigned to employees`}
                  value={derived.activeDesignations.length}
                  badge="View"
                  badgeTone="good"
                  onClick={() => onNavigate('/company/organization/designations')}
                />
              </div>
            </Card>
          </div>
        </>
      )}

      {assigningEmployee && (
        <Modal
          title="Assign reporting manager"
          onClose={closeManagerAssignment}
          footer={(
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button kind="secondary" onClick={closeManagerAssignment}>Cancel</Button>
              {managerPreview ? (
                <Button onClick={() => void confirmManagerAssignment()} disabled={managerBusy || !managerId}>
                  {managerBusy ? 'Assigning…' : 'Confirm assignment'}
                </Button>
              ) : (
                <Button onClick={() => void previewManagerAssignment()} disabled={managerBusy || managerLoading || !managerId}>
                  {managerBusy ? 'Reviewing…' : 'Review assignment'}
                </Button>
              )}
            </div>
          )}
        >
          <div className="space-y-4">
            <div className="rounded-xl border border-app-border bg-app-surface-raised/50 p-3">
              <p className="text-[10px] font-bold uppercase tracking-wide text-app-muted">Employee</p>
              <p className="mt-1 text-sm font-semibold text-app-foreground">{assigningEmployee.fullName}</p>
              <p className="mt-0.5 text-xs text-app-muted">{assigningEmployee.departmentName ?? 'No department'} · {assigningEmployee.positionName ?? 'No position'}</p>
            </div>
            {assigningEmployee.departmentId && assigningEmployee.positionId && (
              <Select
                label="New manager"
                value={managerId}
                onChange={(value) => { candidateRequest.current += 1; setManagerId(value); setManagerPreview(null); setManagerError(''); setManagerBusy(false); }}
                options={managerCandidates.map((candidate) => ({
                  value: candidate.id,
                  label: candidate.accountType === 'super-admin' ? `${candidate.fullName} (Company Super Admin)` : candidate.fullName,
                }))}
                placeholder={managerLoading ? 'Loading eligible managers…' : 'Select a manager'}
                disabled={managerLoading || managerBusy || managerCandidates.length === 0}
              />
            )}
            {!managerLoading && assigningEmployee.departmentId && assigningEmployee.positionId && managerCandidates.length === 0 && !managerError && (
              <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
                No eligible managers are available for this employee. Review the reporting structure before assigning a manager.
              </p>
            )}
            {managerError && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-300">{managerError}</p>}
            {managerPreview && (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-3 dark:border-emerald-900 dark:bg-emerald-950/20">
                <p className="text-xs font-semibold text-app-foreground">Review reporting change</p>
                <p className="mt-1 text-xs text-app-muted">
                  {managerPreview.currentManager?.fullName ?? 'No current manager'} <span aria-hidden="true">→</span>{' '}
                  {managerPreview.proposedManager?.fullName ?? managerCandidates.find((candidate) => candidate.id === managerId)?.fullName ?? 'Selected manager'}
                </p>
                {managerPreview.affectedCount > 1 && <p className="mt-2 text-[11px] text-app-muted">{managerPreview.affectedCount} reporting relationships will be affected.</p>}
              </div>
            )}
          </div>
        </Modal>
      )}
    </WorkspacePageContainer>
  );
}

function SummaryMetric({
  label,
  value,
  detail,
  onClick,
  cellClassName,
}: {
  label: string;
  value: number;
  detail: React.ReactNode;
  onClick: () => void;
  cellClassName: string;
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group flex min-h-[86px] min-w-0 flex-col justify-between p-3.5 text-left transition-colors hover:bg-app-accent/[0.035] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-app-accent sm:min-h-[94px] sm:p-4 ${cellClassName}`}
    >
      <span className="flex items-center justify-between gap-3">
        <span className="truncate text-xs font-medium text-app-muted">{label}</span>
        <span className="inline-flex shrink-0 items-center gap-1 text-[11px] font-medium text-emerald-600 opacity-90 transition group-hover:opacity-100 dark:text-emerald-400">View <Icon name="chevron-right" className="size-3" /></span>
      </span>
      <span className="flex items-end justify-between gap-3">
        <span className="font-display text-2xl font-bold leading-none tabular-nums text-app-foreground">{value}</span>
        <span className="max-w-[72%] truncate text-right text-[11px] text-app-muted">{detail}</span>
      </span>
    </button>
  );
}

function SignalRow({
  icon,
  label,
  description,
  value,
  total,
  badge,
  badgeTone,
  onClick,
}: {
  icon: string;
  label: string;
  description: string;
  value: number;
  total?: number;
  badge: string;
  badgeTone: 'good' | 'neutral';
  onClick: () => void;
}): React.JSX.Element {
  const progress = total && total > 0 ? Math.min(100, (value / total) * 100) : null;
  return (
    <button type="button" onClick={onClick} className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-app-accent/[0.035] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-app-accent sm:px-5">
      <span className="grid size-8 shrink-0 place-items-center rounded-lg border border-app-border bg-app-surface-raised text-app-muted"><Icon name={icon} className="size-4" /></span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-medium text-app-foreground">{label}</span>
        <span className="mt-0.5 block truncate text-[10px] text-app-muted">{description}</span>
      </span>
      {progress !== null && <span className="hidden w-12 shrink-0 overflow-hidden rounded-full bg-app-border sm:block"><span className="block h-1.5 rounded-full bg-emerald-500" style={{ width: `${progress}%` }} /></span>}
      {progress !== null && <span className="hidden shrink-0 text-[10px] tabular-nums text-app-muted sm:block">{value}/{total}</span>}
      <span className={`shrink-0 rounded-md border px-2 py-1 text-[10px] font-semibold ${badgeTone === 'good' ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/25 dark:text-emerald-300' : 'border-app-border bg-app-surface-raised text-app-muted'}`}>{badge}</span>
      <span className="min-w-3 text-right text-xs font-semibold tabular-nums text-app-foreground">{value}</span>
    </button>
  );
}
