import { useEffect, useState } from 'react';
import { Card, Page, Notice } from '../../ui/components.js';
import { RingChart, BarChart, Progress } from '../../ui/charts.js';
import { Icon } from '../../ui/Icon.js';
import { getGeofenceNotice, type GeofenceNotice } from '../../identity/api/authApi.js';
import { getMySessions, type IdentitySession } from '../../identity/api/sessionsApi.js';
import {
  getCompanyEmployees,
  type CompanyEmployee,
  type CompanyIdentity,
} from '../api/companyApi.js';

export function DashboardPage({
  identity,
  onNavigate,
}: {
  identity: CompanyIdentity;
  onNavigate: (path: string) => void;
}): React.JSX.Element {
  const [employees, setEmployees] = useState<CompanyEmployee[]>([]);
  const [sessions, setSessions] = useState<IdentitySession[]>([]);
  const [notice, setNotice] = useState<GeofenceNotice | null>(null);
  const [employeesAvailable, setEmployeesAvailable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    void Promise.allSettled([getCompanyEmployees(), getMySessions(), getGeofenceNotice()])
      .then(([employeesResult, sessionsResult, noticeResult]) => {
        if (employeesResult.status === 'fulfilled') {
          setEmployees(employeesResult.value);
          setEmployeesAvailable(true);
        }
        if (sessionsResult.status === 'fulfilled') setSessions(sessionsResult.value);
        if (noticeResult.status === 'fulfilled') setNotice(noticeResult.value);

        // Employee Directory and geofencing are optional modules. Their
        // authorization failure must not prevent the core workspace from
        // loading. Sessions are core and remain the required dashboard data.
        if (sessionsResult.status === 'rejected')
          setError('Unable to load workspace data.');
      })
      .finally(() => setLoading(false));
  }, []);

  const assigned = employees.filter((person) => person.departmentId).length;
  const departments = Object.entries(
    employees.reduce<Record<string, number>>((groups, person) => {
      const name = person.departmentName || 'Unassigned';
      groups[name] = (groups[name] ?? 0) + 1;
      return groups;
    }, {}),
  ).sort((a, b) => b[1] - a[1]);
  const chartData =
    departments.length > 6
      ? [
          ...departments.slice(0, 5),
          ['Other', departments.slice(5).reduce((sum, item) => sum + item[1], 0)] as [
            string,
            number,
          ],
        ]
      : departments;

  return (
    <Page
      eyebrow="Your workspace, at a glance"
      title="Workspace overview"
      description={`Good to see you, ${identity.user.fullName}. Here's where things stand.`}
      action={
        <button
          type="button"
          onClick={() => onNavigate('/company/sessions')}
          className="ui-primary inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold"
        >
          Review sessions <Icon name="arrow" className="size-4" />
        </button>
      }
    >
      {error && (
        <div className="mt-5">
          <Notice error>{error}</Notice>
        </div>
      )}
      {loading ? (
        <div
          role="status"
          aria-label="Loading workspace"
          className="mt-5 grid gap-4 md:grid-cols-3"
        >
          {[1, 2, 3].map((item) => (
            <div key={item} className="h-36 animate-pulse rounded-2xl bg-app-surface" />
          ))}
        </div>
      ) : (
        <div className="dashboard-content">
          <div className="mt-5 grid gap-4 sm:grid-cols-3">
            <StatCard
              icon="users"
              label="Visible employees"
              value={employeesAvailable ? employees.length : '—'}
              detail={
                employeesAvailable
                  ? 'In your employee directory'
                  : 'Employee data unavailable'
              }
            />
            <StatCard
              icon="monitor"
              label="Your active sessions"
              value={error ? '—' : sessions.length}
              detail="Across signed-in devices"
            />
            <StatCard
              icon="pin"
              label="Assigned locations"
              value={notice ? notice.locations.length : '—'}
              detail={notice ? 'Your sign-in locations' : 'Location data unavailable'}
            />
          </div>
          <div className="mt-5 grid gap-4 xl:grid-cols-[.85fr_1.65fr_1fr]">
            <Card className="flex flex-col justify-between">
              <h2 className="text-base font-semibold">Department coverage</h2>
              <div className="py-5">
                <RingChart
                  value={assigned}
                  max={employees.length}
                  label="Employees assigned to a department"
                />
              </div>
              <div className="text-center">
                <p className="font-semibold">
                  {employeesAvailable
                    ? `${assigned} of ${employees.length} employees`
                    : 'Data unavailable'}
                </p>
                <p className="mt-1 text-xs text-app-muted">Assigned to a department</p>
              </div>
              <div className="mt-5 border-t border-app-border pt-4 text-xs text-app-muted">
                {employeesAvailable
                  ? `${employees.length - assigned} employees without a department`
                  : 'Employee access is needed for this overview.'}
              </div>
            </Card>
            <Card>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-base font-semibold">Team distribution</h2>
                  <p className="mt-1 text-xs text-app-muted">
                    Visible employees by department
                  </p>
                </div>
                <span className="rounded-lg bg-app-accent/10 px-2.5 py-1 text-[11px] font-semibold text-app-accent">
                  Current snapshot
                </span>
              </div>
              <BarChart
                label="Employees by department"
                data={chartData.map(([label, value]) => ({ label, value }))}
              />
              <p className="mt-4 flex items-center gap-2 text-xs text-app-muted">
                <span className="size-2 rounded-full bg-app-accent" /> Employee count ·{' '}
                {departments.length} groups
              </p>
            </Card>
            <Card>
              <h2 className="text-base font-semibold">Organization readiness</h2>
              <p className="mt-1 text-xs text-app-muted">
                Assignment coverage for visible employees
              </p>
              <div className="mt-8 space-y-7">
                <Progress label="Departments" value={assigned} max={employees.length} />
                <Progress
                  label="Positions"
                  value={employees.filter((p) => p.positionId).length}
                  max={employees.length}
                />
                <Progress
                  label="Teams"
                  value={employees.filter((p) => p.teamId).length}
                  max={employees.length}
                />
                <Progress
                  label="Reporting manager"
                  value={employees.filter((p) => p.reportsTo && !p.missingManager).length}
                  max={employees.length}
                />
              </div>
              {!employeesAvailable && (
                <p className="mt-5 text-xs text-app-muted">Employee data unavailable.</p>
              )}
            </Card>
          </div>
          <div className="mt-5 grid gap-4 lg:grid-cols-[1.1fr_1fr]">
            <Card>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs text-app-muted">Company workspace</p>
                  <h2 className="mt-1 text-xl font-semibold">
                    {identity.organization?.name ?? 'Company workspace'}
                  </h2>
                </div>
                <span className="rounded-full border border-app-border px-3 py-1 text-xs capitalize">
                  {identity.organization?.status ?? 'Unavailable'}
                </span>
              </div>
              <dl className="mt-6 grid gap-5 border-t border-app-border pt-5 sm:grid-cols-2">
                <Info
                  label="Company code"
                  value={identity.organization?.code ?? 'Not available'}
                />
                <Info label="Account type" value={identity.user.accountType} />
                <Info
                  label="Signed-in user"
                  value={identity.user.fullName}
                  capitalize={false}
                />
                <Info
                  label="Email address"
                  value={identity.user.email}
                  capitalize={false}
                />
              </dl>
            </Card>
            <Card>
              <div className="flex items-center justify-between">
                <h2 className="text-base font-semibold">Sessions & devices</h2>
                <button
                  type="button"
                  onClick={() => onNavigate('/company/sessions')}
                  className="text-xs font-semibold text-app-accent hover:underline"
                >
                  View all →
                </button>
              </div>
              <p className="mt-1 text-xs text-app-muted">
                Keep track of your workspace access
              </p>
              <div className="mt-5 space-y-3">
                {sessions.slice(0, 3).map((session) => (
                  <div
                    key={session.id}
                    className="flex items-center gap-3 rounded-xl border border-app-border bg-app-background/40 p-3"
                  >
                    <span className="rounded-lg bg-app-accent/10 p-2 text-app-accent">
                      <Icon name="monitor" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {session.deviceLabel ?? 'Web browser'}
                      </p>
                      <p className="mt-1 truncate text-xs text-app-muted">
                        {session.approxLocation ?? 'Location unavailable'}
                      </p>
                    </div>
                    <span className="rounded-full bg-app-success/10 px-2 py-1 text-[10px] font-semibold text-app-success">
                      {session.current ? 'Current' : 'Active'}
                    </span>
                  </div>
                ))}
                {!sessions.length && (
                  <p className="py-6 text-sm text-app-muted">
                    {error
                      ? 'Session data unavailable.'
                      : 'No active sessions to display.'}
                  </p>
                )}
              </div>
            </Card>
          </div>
        </div>
      )}
    </Page>
  );
}
function StatCard({
  label,
  value,
  detail,
  icon,
}: {
  label: string;
  value: number | string;
  detail: string;
  icon: string;
}): React.JSX.Element {
  return (
    <Card className="metric-card">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-app-muted">{label}</p>
        <span className="rounded-lg bg-app-accent/10 p-2 text-app-accent">
          <Icon name={icon} />
        </span>
      </div>
      <p className="mt-1 text-4xl font-semibold tracking-tight tabular-nums">{value}</p>
      <p className="mt-3 text-xs text-app-muted">{detail}</p>
    </Card>
  );
}
function Info({
  label,
  value,
  capitalize = true,
}: {
  label: string;
  value: string;
  capitalize?: boolean;
}): React.JSX.Element {
  return (
    <div>
      <dt className="text-xs text-app-muted">{label}</dt>
      <dd
        className={`mt-1 break-words text-sm font-medium${capitalize ? ' capitalize' : ''}`}
      >
        {value}
      </dd>
    </div>
  );
}
